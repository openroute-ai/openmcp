/**
 * 哪些文件值得读——一次决定，所有获取路径共用。
 *
 * 这里以前被写了两遍（本地 `git clone` 一遍、Vercel Sandbox 一遍），而且两份已经
 * 漂移：Sandbox 那份的扩展名过滤是个空 `if`，隐藏文件的判断没有函数体。两套读
 * 不同文件的规则会给同一个提交两个不同的评级，而这种失败长得完全不像规则 bug——
 * 它长得像一个时好时坏的扫描器。
 *
 * 所以只有一份实现，两侧 adapter 都 import 它、并把它序列化进 sandbox 脚本。
 * 它是纯数据进出、不碰任何 Node API：{@link isBinaryBytes} 收 `Uint8Array`，因为
 * sandbox 交回 Buffer、本地路径也交回 Buffer，但谁都不是必需的。
 */

/** 可能藏着命中的扩展名。其余的一律不读。 */
export const SCAN_EXTENSIONS: readonly string[] = [
  '.json',
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.jsx',
  '.yaml',
  '.yml',
  '.md',
  '.txt',
  '.py',
  '.go',
  '.rs',
  '.java',
  '.sh',
  '.bash',
  '.zsh',
  '.sql',
  '.html',
  '.css',
  '.svg',
  '.toml',
  '.ini',
  '.cfg',
  '.env.example',
  '.lock',
]

/**
 * 一律不下探的目录。
 *
 * `node_modules` 和 `.git` 是显然的两个；其余是构建产物，否则它们会吃掉文件
 * 预算里的大部分，而且除了 minified 版的同一条规则之外什么都不贡献——而那条规则
 * 已经在源码上触发过了。
 */
export const SCAN_EXCLUDED_DIRS: readonly string[] = [
  '.git',
  'node_modules',
  'dist',
  'build',
  'out',
  'coverage',
  '.next',
  '.nuxt',
  '.turbo',
  '.vercel',
  '__pycache__',
  'vendor',
  'venv',
  '.venv',
  'target',
]

export interface FilePickerLimits {
  maxFiles: number
  maxTotalBytes: number
  maxFileBytes: number
}

export const DEFAULT_FILE_PICKER_LIMITS: FilePickerLimits = {
  maxFiles: 200,
  maxTotalBytes: 10 * 1024 * 1024,
  maxFileBytes: 1024 * 1024,
}

/** `path` 的小写扩展名，没有则 `''`。 */
export function extensionOf(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  // 开头的点是隐藏文件而不是扩展名：`.gitignore` 没有扩展名。
  if (dot <= 0) return ''
  return base.slice(dot).toLowerCase()
}

/**
 * `path` 是不是一个候选。
 *
 * 与体积检查分开，是为了让调用方能在不 stat 任何东西的前提下枚举候选——用来判断
 * 一个仓库值不值得克隆。
 */
export function isScannablePath(path: string): boolean {
  const segments = path.split('/')
  for (const segment of segments) {
    if (SCAN_EXCLUDED_DIRS.includes(segment)) return false
  }
  const name = segments[segments.length - 1] || ''
  // 隐藏文件是 dotfile、编辑器状态和 CI 配置。它们也是 `形状像 .env 的密钥` 最常见的
  // 藏身处，但一条对**值**触发的规则分不清被提交的是示例还是真密钥——所以真密钥
  // 必须由 `SECRET_PATTERNS` 找出来，而不是靠读一堆我们没有理由信任的 dotfile。
  if (name.startsWith('.')) return name === '.env.example'
  return SCAN_EXTENSIONS.includes(extensionOf(path))
}

/**
 * 字节是不是二进制。
 *
 * 前 8 KiB 里有没有 NUL 字节。整个启发式就是这一条：它足以抓住所有真二进制
 * （PNG、ELF、wasm、大多数压缩包开头都是 NUL），又足够短，于是「大文本文件里在
 * 8 KiB 之后才有个 NUL」这种情况仍会被当文本读完——而它本来就是文本。
 */
export function isBinaryBytes(bytes: Uint8Array): boolean {
  const limit = bytes.length < 8000 ? bytes.length : 8000
  for (let i = 0; i < limit; i++) {
    if (bytes[i] === 0) return true
  }
  return false
}

/** 应用 {@link isScannablePath} 加体积上限之后的结果。 */
export type FilePickerDecision =
  | { ok: true }
  | { ok: false; reason: 'max_files' | 'max_total_bytes' | 'file_too_large' }

/**
 * 再多收一个文件行不行。
 *
 * 单个就超大的文件会**停下**整个遍历而不是被跳过：一份 40 MB 的 `bundle.js` 通常
 * 是碰巧躺在被扫目录里的构建产物，静默继续会把「我们遇到了拒绝读取的东西」这件事
 * 藏起来。调用方会把 `reason` 报出去，而那次扫描是 `truncated` 的。
 */
export function acceptFile(
  limits: FilePickerLimits,
  seen: { count: number; bytes: number },
  path: string,
  size: number
): FilePickerDecision {
  if (size > limits.maxFileBytes) {
    return { ok: false, reason: 'file_too_large' }
  }
  if (seen.count + 1 > limits.maxFiles) return { ok: false, reason: 'max_files' }
  if (seen.bytes + size > limits.maxTotalBytes) {
    return { ok: false, reason: 'max_total_bytes' }
  }
  return { ok: true }
}