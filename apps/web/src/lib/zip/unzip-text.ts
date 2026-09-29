import { inflateRawSync } from 'node:zlib'

const LOCAL_SIG = 0x04034b50
const TEXT_EXT = new Set([
  '.md',
  '.txt',
  '.yml',
  '.yaml',
  '.json',
  '.js',
  '.ts',
  '.mjs',
  '.cjs',
  '.py',
  '.sh',
  '.bash',
  '.zsh',
  '.toml',
  '.xml',
  '.html',
  '.css',
  '.env',
  '.example',
  '.gitignore',
])

export type ZipTextFile = { path: string; content: string }

function isTextFile(name: string): boolean {
  const base = name.split('/').pop() ?? ''
  if (/^(skill\.ya?ml|skill\.md|claude\.md|agents\.md)$/i.test(base)) return true
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')).toLowerCase() : ''
  return TEXT_EXT.has(ext)
}

export function unzipTextFiles(buffer: Buffer, maxFiles = 200): ZipTextFile[] {
  const files: ZipTextFile[] = []
  let offset = 0

  while (offset + 30 <= buffer.length && files.length < maxFiles) {
    const sig = buffer.readUInt32LE(offset)
    if (sig === 0x02014b50 || sig === 0x06054b50) break
    if (sig !== LOCAL_SIG) {
      offset += 1
      continue
    }

    const flags = buffer.readUInt16LE(offset + 6)
    const method = buffer.readUInt16LE(offset + 8)
    let compressedSize = buffer.readUInt32LE(offset + 18)
    const nameLen = buffer.readUInt16LE(offset + 26)
    const extraLen = buffer.readUInt16LE(offset + 28)
    const nameStart = offset + 30
    const name = buffer
      .subarray(nameStart, nameStart + nameLen)
      .toString('utf8')
      .replace(/^\/+/, '')
    const dataStart = nameStart + nameLen + extraLen

    if (flags & 0x08) {
      const nextLocal = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]), dataStart)
      const nextCentral = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), dataStart)
      const candidates = [nextLocal, nextCentral].filter((n) => n > dataStart)
      if (candidates.length === 0) break
      compressedSize = Math.min(...candidates) - dataStart
    }

    const compressed = buffer.subarray(dataStart, Math.min(buffer.length, dataStart + compressedSize))
    offset = dataStart + compressedSize
    if (flags & 0x08) {
      if (offset + 4 <= buffer.length && buffer.readUInt32LE(offset) === 0x08074b50) offset += 16
      else offset += 12
    }

    if (!name || name.endsWith('/')) continue
    if (!isTextFile(name)) continue

    try {
      const raw = method === 0 ? compressed : method === 8 ? inflateRawSync(compressed) : null
      if (!raw) continue
      files.push({ path: name, content: raw.toString('utf8') })
    } catch {}
  }

  return files
}

export function parseSkillMeta(files: ZipTextFile[]): {
  name: string
  description: string
  version: string
  license: string
} {
  const yaml = files.find((file) => /(^|\/)skill\.ya?ml$/i.test(file.path))
  const skillMd = files.find((file) => /(^|\/)skill\.md$/i.test(file.path))
  const source = yaml?.content ?? skillMd?.content ?? ''
  const pick = (key: string) => {
    const match = source.match(new RegExp(`^${key}:\\s*["']?(.+?)["']?\\s*$`, 'mi'))
    return match?.[1]?.trim() ?? ''
  }
  const fallback = files[0]?.path.split('/')[0]?.replace(/\.[^.]+$/, '') || 'untitled'
  return {
    name: pick('name') || fallback,
    description: pick('description'),
    version: pick('version'),
    license: pick('license'),
  }
}
