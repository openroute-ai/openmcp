import { crc32 } from "node:zlib"
import { sanitizeZipEntryPath } from "./sanitize-entry-path"

/**
 * Minimal ZIP (store / method 0) writer — no extra dependency.
 * Suitable for small Skill source bundles delivered to buyers.
 */
export type ZipStoreFile = { path: string; content: string | Buffer }

/**
 * 规整写入端的 entry 名。
 *
 * 读取侧已经拦了 `..`，但 `sourceFiles` 是数据库里的历史数据 —— 在写入端
 * 再拦一次，才能保证"发出去的包"里不会混进一条穿越路径。买家在本地
 * `unzip` 后就落在解压目录外，这正是 zip slip。
 *
 * 返回 `null` 表示这个 entry 不可信，调用方应当跳过而不是写入。
 */
function normalizePath(p: string): string | null {
  const result = sanitizeZipEntryPath(p)
  return result.ok ? result.path : null
}

function toDosDateTime(d = new Date()): { time: number; date: number } {
  const year = Math.max(1980, d.getFullYear())
  const month = d.getMonth() + 1
  const day = d.getDate()
  const hours = d.getHours()
  const minutes = d.getMinutes()
  const seconds = Math.floor(d.getSeconds() / 2)
  return {
    time: (hours << 11) | (minutes << 5) | seconds,
    date: ((year - 1980) << 9) | (month << 5) | day,
  }
}

export function createZipStore(files: ZipStoreFile[]): Buffer {
  const { time, date } = toDosDateTime()
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  const skipped: string[] = []
  let offset = 0

  for (const file of files) {
    const safePath = normalizePath(file.path)
    if (!safePath) {
      skipped.push(file.path)
      continue
    }
    const name = Buffer.from(safePath, "utf8")
    const data =
      typeof file.content === "string"
        ? Buffer.from(file.content, "utf8")
        : file.content
    const checksum = crc32(data)

    const localHeader = Buffer.alloc(30)
    localHeader.writeUInt32LE(0x04034b50, 0)
    localHeader.writeUInt16LE(20, 4) // version needed
    localHeader.writeUInt16LE(0, 6) // flags
    localHeader.writeUInt16LE(0, 8) // method store
    localHeader.writeUInt16LE(time, 10)
    localHeader.writeUInt16LE(date, 12)
    localHeader.writeUInt32LE(checksum >>> 0, 14)
    localHeader.writeUInt32LE(data.length, 18)
    localHeader.writeUInt32LE(data.length, 22)
    localHeader.writeUInt16LE(name.length, 26)
    localHeader.writeUInt16LE(0, 28) // extra len

    const local = Buffer.concat([localHeader, name, data])
    localParts.push(local)

    const centralHeader = Buffer.alloc(46)
    centralHeader.writeUInt32LE(0x02014b50, 0)
    centralHeader.writeUInt16LE(20, 4) // version made by
    centralHeader.writeUInt16LE(20, 6) // version needed
    centralHeader.writeUInt16LE(0, 8)
    centralHeader.writeUInt16LE(0, 10)
    centralHeader.writeUInt16LE(time, 12)
    centralHeader.writeUInt16LE(date, 14)
    centralHeader.writeUInt32LE(checksum >>> 0, 16)
    centralHeader.writeUInt32LE(data.length, 20)
    centralHeader.writeUInt32LE(data.length, 24)
    centralHeader.writeUInt16LE(name.length, 28)
    centralHeader.writeUInt16LE(0, 30)
    centralHeader.writeUInt16LE(0, 32)
    centralHeader.writeUInt16LE(0, 34)
    centralHeader.writeUInt16LE(0, 36)
    centralHeader.writeUInt32LE(0, 38)
    centralHeader.writeUInt32LE(offset, 42)

    centralParts.push(Buffer.concat([centralHeader, name]))
    offset += local.length
  }

  const central = Buffer.concat(centralParts)
  const written = localParts.length
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(written, 8)
  end.writeUInt16LE(written, 10)
  end.writeUInt32LE(central.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)

  if (skipped.length > 0) {
    // 不能静默丢弃：历史 `sourceFiles` 里如果有穿越路径，买家拿到的包会少文件，
    // 而调用方需要知道少了什么才能报错而不是发一个残缺的包。
    console.warn("[zip] skipped unsafe entry names while writing archive", {
      count: skipped.length,
      samples: skipped.slice(0, 5),
    })
  }

  return Buffer.concat([...localParts, central, end])
}
