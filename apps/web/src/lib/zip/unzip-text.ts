import { inflateRawSync } from "node:zlib"
import { sanitizeZipEntryPath } from "./sanitize-entry-path"

const LOCAL_SIG = 0x04034b50
const CENTRAL_SIG = 0x02014b50
const EOCD_SIG = 0x06054b50
/** 数据描述符签名；紧随其后是 CRC/压缩前后大小（12 或 16 字节）。 */
const DATA_DESCRIPTOR_SIG = 0x08074b50

/**
 * Unix 文件类型位。符号链接的 st_mode 高 4 位是 `S_IFLNK`（0xA000）。
 *
 * 这些位**只存在于中央目录**的 external attributes 高 16 位，本地文件头里
 * 根本没有对应字段。所以下面必须读中央目录才能拦住符号链接 —— 只扫本地头
 * 的话，一个指向 `/etc/passwd` 的链接和一个 3 字节的普通文件在字节层面
 * 长得一模一样。
 */
const S_IFMT = 0xf000
const S_IFLNK = 0xa000

const TEXT_EXT = new Set([
  ".md",
  ".txt",
  ".yml",
  ".yaml",
  ".json",
  ".js",
  ".ts",
  ".mjs",
  ".cjs",
  ".py",
  ".sh",
  ".bash",
  ".zsh",
  ".toml",
  ".xml",
  ".html",
  ".css",
  ".env",
  ".example",
  ".gitignore",
])

export type ZipTextFile = { path: string; content: string }

/**
 * 解压上限。这些值是安全边界，不是性能调优项：
 *
 * - `maxEntries` 限制**扫描**过的 entry 数，不是保留下来的文本文件数。旧实现
 *   只在 `files.length < maxFiles` 时停下循环，而跳过的 entry（`.exe` 等）
 *   不计数，所以一个塞满非白名单文件的压缩包会让循环跑完整个包。
 * - `maxTotalUncompressedBytes` 是所有 entry 解压后总和的预算。缺了它，一个
 *   50MB 的全零压缩包能在进程内 inflate 出几十 GB，是最容易被利用的一类
 *   拒绝服务（zip bomb）。
 * - `maxRatio` 是单 entry 的压缩比上限，用来抓"极小压缩尺寸 + 极大解压尺寸"
 *   的经典炸弹形态。设 200 而不是 1000：真实的文本/源码压缩比通常在 10 以内，
 *   超过 200 基本可以判定为构造出来的。
 * - `maxEntryUncompressedBytes` 给单文件封顶，避免一个 entry 吃掉全部预算，
 *   让其他 entry 在没有预算的情况下被静默跳过。
 */
const DEFAULTS = {
  maxFiles: 200,
  maxEntries: 2000,
  maxEntryUncompressedBytes: 8 * 1024 * 1024,
  maxTotalUncompressedBytes: 64 * 1024 * 1024,
  maxRatio: 200,
}

export type UnzipLimits = Partial<typeof DEFAULTS>

function isTextFile(name: string): boolean {
  const base = name.split("/").pop() ?? ""
  if (/^(skill\.ya?ml|skill\.md|claude\.md|agents\.md)$/i.test(base))
    return true
  const ext = name.includes(".")
    ? name.slice(name.lastIndexOf(".")).toLowerCase()
    : ""
  return TEXT_EXT.has(ext)
}

export type UnzipRejection = {
  kind:
    | "path-traversal"
    | "symlink"
    | "duplicate-entry"
    | "unverifiable-entry"
    | "malformed-central-directory"
    | "too-many-entries"
    | "total-size"
    | "entry-size"
    | "ratio"
  detail: string
}

type CentralEntry = { name: string; symlink: boolean }

/**
 * 解析中央目录，返回 `本地文件头偏移 → entry 元信息`。
 *
 * 为什么必须读中央目录而不是只扫本地头：
 *
 * - **符号链接**：Unix 打包器把 `st_mode` 写进中央目录的 external attributes
 *   高 16 位。一个 `pkg/passwd -> /etc/passwd` 的链接，本地头里的名字和
 *   压缩尺寸都完全正常，不查外部属性就会当成 11 字节的普通文本收进来，
 *   再由下游写到磁盘时把目标替换成宿主机的 `/etc/passwd`。
 * - **计数一致性**：EOCD 声明的 entry 数可以与本地头实际数量对不上。不校验
 *   的话，构造者可以把炸弹塞进"中央目录声称不存在"的本地头里。
 *
 * 任何一处解析不出来就整体拒绝（fail closed），而不是"尽力而为"地退回到只扫
 * 本地头 —— 退回等于把上面两个洞重新打开。
 */
function readCentralDirectory(
  buffer: Buffer,
  rejections: UnzipRejection[]
): Map<number, CentralEntry> | null {
  // EOCD 签名 0x06054b50 小端字节序下是 `50 4b 05 06`。
  const eocdSig = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  if (eocdSig < 0 || eocdSig + 22 > buffer.length) {
    rejections.push({
      kind: "malformed-central-directory",
      detail: "找不到 EOCD 记录，无法校验 entry 元信息",
    })
    return null
  }

  const totalEntries = buffer.readUInt16LE(eocdSig + 10)
  const entries = new Map<number, CentralEntry>()
  let offset = buffer.readUInt32LE(eocdSig + 16)

  for (let i = 0; i < totalEntries; i += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== CENTRAL_SIG) {
      rejections.push({
        kind: "malformed-central-directory",
        detail: `中央目录第 ${i} 条记录缺失或损坏`,
      })
      return null
    }
    // "version made by" 高字节是打包主机系统。3 = Unix。只有 Unix 打包器会写
    // st_mode；DOS/Windows 的 external attributes 高位是 DOS 属性位，按 mode
    // 解读会误判出符号链接。
    const hostSystem = buffer.readUInt16LE(offset + 4) >>> 8
    const externalAttrs = buffer.readUInt32LE(offset + 38)
    const nameLen = buffer.readUInt16LE(offset + 28)
    const extraLen = buffer.readUInt16LE(offset + 30)
    const commentLen = buffer.readUInt16LE(offset + 32)
    const localOffset = buffer.readUInt32LE(offset + 42)

    if (offset + 46 + nameLen > buffer.length) {
      rejections.push({
        kind: "malformed-central-directory",
        detail: `中央目录第 ${i} 条记录的名字越界`,
      })
      return null
    }

    const mode = (externalAttrs >>> 16) & 0xffff
    entries.set(localOffset, {
      name: buffer.subarray(offset + 46, offset + 46 + nameLen).toString("utf8"),
      symlink: hostSystem === 3 && (mode & S_IFMT) === S_IFLNK,
    })
    offset += 46 + nameLen + extraLen + commentLen
  }

  return entries
}

export function unzipTextFiles(
  buffer: Buffer,
  limitsOrMaxFiles: number | UnzipLimits = {}
): ZipTextFile[] {
  return unzipTextFilesWithReport(buffer, limitsOrMaxFiles).files
}

/**
 * 与 {@link unzipTextFiles} 相同，但同时回报被拒绝的 entry。
 *
 * 上传接口需要这个：拒绝原因是安全事件的一部分，日志里没有它就无法判断
 * 一次上传是"正常的未压缩文件"还是"构造的穿越/炸弹尝试"。
 */
export function unzipTextFilesWithReport(
  buffer: Buffer,
  limitsOrMaxFiles: number | UnzipLimits = {}
): {
  files: ZipTextFile[]
  rejections: UnzipRejection[]
  entriesScanned: number
} {
  const limits: UnzipLimits =
    typeof limitsOrMaxFiles === "number"
      ? { maxFiles: limitsOrMaxFiles }
      : limitsOrMaxFiles
  const {
    maxFiles,
    maxEntries,
    maxEntryUncompressedBytes,
    maxTotalUncompressedBytes,
    maxRatio,
  } = { ...DEFAULTS, ...limits }

  const files: ZipTextFile[] = []
  const rejections: UnzipRejection[] = []
  let offset = 0
  let entriesScanned = 0
  let totalUncompressed = 0
  const seenPaths = new Set<string>()

  const centralEntries = readCentralDirectory(buffer, rejections)
  if (!centralEntries) return { files, rejections, entriesScanned }

  while (offset + 30 <= buffer.length) {
    if (entriesScanned >= maxEntries) {
      rejections.push({
        kind: "too-many-entries",
        detail: `扫描 entry 数超过上限 ${maxEntries}`,
      })
      break
    }
    if (files.length >= maxFiles) break

    const sig = buffer.readUInt32LE(offset)
    if (sig === CENTRAL_SIG || sig === EOCD_SIG) break
    if (sig !== LOCAL_SIG) {
      offset += 1
      continue
    }
    entriesScanned += 1
    // 中央目录以"本地文件头的绝对偏移"索引 entry，这个偏移在下面会被复用成
    // payload 的结束位置，所以必须在这里留一份。
    const localOffset = offset

    const flags = buffer.readUInt16LE(offset + 6)
    const method = buffer.readUInt16LE(offset + 8)
    let compressedSize = buffer.readUInt32LE(offset + 18)
    let uncompressedSize = buffer.readUInt32LE(offset + 22)
    const nameLen = buffer.readUInt16LE(offset + 26)
    const extraLen = buffer.readUInt16LE(offset + 28)
    const nameStart = offset + 30
    const rawName = buffer
      .subarray(nameStart, nameStart + nameLen)
      .toString("utf8")

    const dataStart = nameStart + nameLen + extraLen

    if (flags & 0x08) {
      // 数据描述符：压缩尺寸在本地头里是 0，只能靠找下一个签名推断。
      // 构造过的压缩包可以让这个启发式指到错误的偏移，所以推断出的尺寸
      // 之后还要过一遍下面的尺寸校验。
      const nextLocal = buffer.indexOf(
        Buffer.from([0x50, 0x4b, 0x03, 0x04]),
        dataStart
      )
      const nextCentral = buffer.indexOf(
        Buffer.from([0x50, 0x4b, 0x01, 0x02]),
        dataStart
      )
      const candidates = [nextLocal, nextCentral].filter((n) => n > dataStart)
      if (candidates.length === 0) break
      compressedSize = Math.min(...candidates) - dataStart
      if (uncompressedSize === 0) uncompressedSize = compressedSize
    }

    const dataEnd = Math.min(buffer.length, dataStart + compressedSize)
    const compressed = buffer.subarray(dataStart, dataEnd)
    offset = dataEnd
    if (flags & 0x08) {
      if (
        offset + 4 <= buffer.length &&
        buffer.readUInt32LE(offset) === DATA_DESCRIPTOR_SIG
      ) {
        offset += 16
      } else {
        offset += 12
      }
    }

    const isDirectory = rawName.endsWith("/")
    const sanitized = sanitizeZipEntryPath(rawName)

    if (!sanitized.ok) {
      // 目录条目也检查：一个名为 `../` 的目录本身无害，但它会让下游
      // "mkdir -p dirname(path)" 之类的逻辑写出去。所以一律拦。
      rejections.push({ kind: "path-traversal", detail: sanitized.reason })
      continue
    }

    // 符号链接必须在解压前拦。链接的 payload 就是"目标路径"这一串文本，
    // 读进来无害，但一旦下游按它写盘就会覆盖宿主机上的真实文件。
    const central = centralEntries.get(localOffset)
    if (central?.symlink) {
      rejections.push({
        kind: "symlink",
        detail: `${sanitized.path} 是符号链接，拒绝导入`,
      })
      continue
    }

    // 本地头在中央目录里查不到对应记录，说明这条 entry 不属于这个包 —— 也就是
    // 构造者可以往中央目录声称的 entry 之外再塞一条本地头，而 EOCD 的计数校验
    // 拦不住这种情况（计数只约束中央目录自己那几行）。
    //
    // 更实际的影响是 symlink 检查被跳过：`central` 是 undefined 时上面那个
    // `central?.symlink` 静默为 false，于是一个 Unix symlink 只要不在中央目录
    // 里登记就会以普通文本通过。用"缺记录即不可信"关掉这个洞。
    if (!central) {
      rejections.push({
        kind: "unverifiable-entry",
        detail: `${sanitized.path} 在中央目录中缺少对应记录，无法校验`,
      })
      continue
    }

    // 重复 entry：`foo.md` 和 `pkg/../foo.md` 规整后是同一个路径，`a//b.md` 与
    // `a/b.md` 也是。不去重的话下游按数组顺序写入，最后一条会静默覆盖前面
    // 那条 —— 买家拿到的文件内容和平台展示的不一致，而且这取决于顺序，是个
    // 隐形的"谁赢"规则。整包拒绝比猜意图安全。
    if (seenPaths.has(sanitized.path)) {
      rejections.push({
        kind: "duplicate-entry",
        detail: `entry 路径重复：${sanitized.path}`,
      })
      continue
    }
    seenPaths.add(sanitized.path)

    if (isDirectory) continue

    // 非文本 entry 也要计入 `entriesScanned` 与尺寸预算，但不保留内容。
    // 旧实现直接 `continue`，等于给攻击者一条"塞任意多 entry"的免费通道。
    if (!isTextFile(sanitized.path)) {
      totalUncompressed += compressedSize
      continue
    }

    // 尺寸预算在解压**之前**检查，这样炸弹不会先被 inflate 进内存。
    const projected = totalUncompressed + (uncompressedSize || 0)
    if (uncompressedSize > maxEntryUncompressedBytes) {
      rejections.push({
        kind: "entry-size",
        detail: `${sanitized.path} 解压后 ${uncompressedSize} 字节，超过单文件上限 ${maxEntryUncompressedBytes}`,
      })
      continue
    }
    if (projected > maxTotalUncompressedBytes) {
      rejections.push({
        kind: "total-size",
        detail: `累计解压体积将达 ${projected} 字节，超过上限 ${maxTotalUncompressedBytes}`,
      })
      continue
    }
    // method 0（store）压缩比恒为 1，不需要查比值。
    if (method === 8 && compressedSize > 0) {
      const ratio = (uncompressedSize || 0) / compressedSize
      if (ratio > maxRatio) {
        rejections.push({
          kind: "ratio",
          detail: `${sanitized.path} 压缩比 ${ratio.toFixed(0)}:1，超过上限 ${maxRatio}:1`,
        })
        continue
      }
    }

    // method 只有 0（store）和 8（deflate）是这里支持的；其他（bzip2、xz 等）
    // 直接跳过，不去猜。
    let raw: Buffer | null = null
    try {
      if (method === 0) {
        raw = compressed
      } else if (method === 8) {
        // `maxOutputLength` 让 zlib 在超出预算时立刻抛错，而不是先把整块分配
        // 出来再检查。这是防 zip bomb 唯一可靠的检查点。
        raw = inflateRawSync(compressed, { maxOutputLength: maxEntryUncompressedBytes })
      }
    } catch {
      // Corrupt or unsupported deflate stream: skip this entry.
      continue
    }
    if (!raw) continue

    totalUncompressed += raw.length
    files.push({ path: sanitized.path, content: raw.toString("utf8") })
  }

  return { files, rejections, entriesScanned }
}

/**
 * 需要**拒绝整包**的拒绝原因，和"跳过单个 entry 就够了"的区分开。
 *
 * 这三类不是包太大、不是文件太多，而是包本身在说谎或试图指向包外：
 *
 * - `path-traversal`：entry 名指向目标根之外。
 * - `symlink`：符号链接，下游按它写盘就会覆盖宿主机文件。
 * - `duplicate-entry` / `malformed-central-directory`：包的结构本身不可信
 *   （路径歧义、目录与本地头对不上），此时继续"尽力解析"等于猜攻击者的意图。
 *
 * 体积、压缩比、entry 数这类属于防滥用，逐条跳过并记日志即可，不该把正常
 * 上传整个打回。
 *
 * 抽成函数而不是让两个 route 各写一遍筛选条件：这两个路由已经因为"少一层
 * 解析就少一处有人会顺手加逻辑"而共用过判断，再复制一次筛选条件只会让它
 * 再次分叉。
 */
const UNSAFE_ARCHIVE_KINDS = new Set<UnzipRejection["kind"]>([
  "path-traversal",
  "symlink",
  "duplicate-entry",
  "malformed-central-directory",
  "unverifiable-entry",
])

export function hasUnsafeArchive(rejections: UnzipRejection[]): boolean {
  return unsafeRejections(rejections).length > 0
}

/** 只返回需要拒绝整包的那几条，用于日志与错误提示。 */
export function unsafeRejections(rejections: UnzipRejection[]): UnzipRejection[] {
  return rejections.filter((r) => UNSAFE_ARCHIVE_KINDS.has(r.kind))
}

export function parseSkillMeta(files: ZipTextFile[]): {
  name: string
  description: string
  version: string
  license: string
} {
  const yaml = files.find((file) => /(^|\/)skill\.ya?ml$/i.test(file.path))
  const skillMd = files.find((file) => /(^|\/)skill\.md$/i.test(file.path))
  const source = yaml?.content ?? skillMd?.content ?? ""
  const pick = (key: string) => {
    const match = source.match(
      new RegExp(`^${key}:\\s*["']?(.+?)["']?\\s*$`, "mi")
    )
    return match?.[1]?.trim() ?? ""
  }
  const fallback =
    files[0]?.path.split("/")[0]?.replace(/\.[^.]+$/, "") || "untitled"
  return {
    name: pick("name") || fallback,
    description: pick("description"),
    version: pick("version"),
    license: pick("license"),
  }
}
