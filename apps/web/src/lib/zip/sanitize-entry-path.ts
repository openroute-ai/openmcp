/**
 * ZIP entry name sanitisation.
 *
 * `unzipTextFiles` 会把 entry 名字原样存进 `skills.metadata.sourceFiles`，
 * 再由 `buildSkillPackage` 重新打包发给买家。如果名字里能带 `../`，那么
 * 任何后续把它当路径用的代码（解压到磁盘、`cd` 进目录、拼 shell 命令）
 * 都会被带出目标根目录 —— 这就是 zip slip。
 *
 * 这里集中做名字规整，读取和写入两侧都用它，保证"写进去的路径"和"读出来的
 * 路径"是同一个规整结果：只在读侧过滤是不够的，因为 `sourceFiles` 里已经
 * 存在历史数据。
 */

/** 规范化后的名字仍然可疑时的上限。 */
const MAX_PATH_LENGTH = 200

export type SanitizeResult =
  { ok: true; path: string } | { ok: false; reason: string }

/**
 * 把一个 ZIP entry 名字规整成安全的相对路径。
 *
 * 规则：
 * - 反斜杠转正斜杠（Windows 打包器会用 `\`）
 * - 去掉开头的 `/`（ZIP 规范允许绝对路径，`/etc/passwd` 这种）
 * - 拒绝 Windows 盘符绝对路径（`C:/Windows/System32`）：它没有前导斜杠，
 *   上面的"去斜杠"处理不到，但 Windows 上它同样指向目标根之外
 * - 拒绝任何 `..` 段（无论它出现在哪一层，也无论它指向最终仍在根内的路径：
 *   `a/../../b` 是可绕过的写法，不要试图规范化后再判断）
 * - 拒绝 NUL 与控制字符（会破坏下游的路径处理与日志）
 * - 拒绝 Windows 保留设备名（`CON`、`NUL`、`COM1`…），这类名字在 Windows 上
 *   指向设备而非文件，解压行为与预期完全不同
 * - 限制长度，避免超长路径撑爆下游的文件系统调用
 */
export function sanitizeZipEntryPath(raw: string): SanitizeResult {
  if (!raw) return { ok: false, reason: "entry 名为空" }

  // NUL 必须在切分前查：Node 的字符串允许内嵌 NUL，传给 fs 会直接抛错。
  // 按码点判断而不是写正则 `[\u0000-\u001f]`：后者会被 `no-control-regex` 判为
  // 警告，而这里查控制字符正是本函数的意图，不是误用。
  for (let i = 0; i < raw.length; i += 1) {
    const code = raw.charCodeAt(i)
    if (code <= 0x1f || code === 0x7f) {
      return { ok: false, reason: "entry 名含控制字符" }
    }
  }

  const unified = raw.replace(/\\/g, "/").replace(/^\/+/, "")
  if (!unified) return { ok: false, reason: "entry 名为空" }

  if (unified.length > MAX_PATH_LENGTH) {
    return { ok: false, reason: `entry 名过长（>${MAX_PATH_LENGTH}）` }
  }

  // 盘符必须在反斜杠归一化**之后**判：`C:\Windows\System32` 是 Windows 上
  // 最常见的绝对路径写法，前面那步会把它变成 `C:/Windows/System32`。判早了
  // 看不到盘符，判在归一化之后才拦得住。单个盘符字符（如 `c:notes/x.md`）
  // 在 POSIX 上不是绝对路径，但它在 Windows 上是，且冒号本身是非法文件名字符，
  // 两条路都指向"不要放行"。
  if (/^[a-zA-Z]:/.test(unified)) {
    return { ok: false, reason: `entry 名是 Windows 盘符绝对路径：${raw}` }
  }

  const segments = unified.split("/")
  for (const segment of segments) {
    if (segment === "..")
      return { ok: false, reason: `entry 名含路径穿越段：${raw}` }
    // 末尾的 `/` 表示目录，由调用方按 `endsWith('/')` 处理；中间的空段（`a//b`）
    // 压成单段，避免同一文件出现两种拼法导致去重失效。
  }

  const base = segments[segments.length - 1] ?? ""
  const stem = base.split(".")[0] ?? ""
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem)) {
    return { ok: false, reason: `entry 名是保留设备名：${raw}` }
  }

  const cleaned = segments.filter((s) => s !== "" && s !== ".").join("/")
  if (!cleaned) return { ok: false, reason: "entry 名规整后为空" }

  return { ok: true, path: cleaned }
}

/** 便捷包装：只要安全就返回规整后的名字，否则 `null`。 */
export function safeZipEntryPath(raw: string): string | null {
  const result = sanitizeZipEntryPath(raw)
  return result.ok ? result.path : null
}
