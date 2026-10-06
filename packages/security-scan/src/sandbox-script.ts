/**
 * 生成在 Vercel Sandbox **内部**运行的那份独立扫描脚本。
 *
 * 要求是一套规则表，而手写脚本就是第二套。所以这份脚本是用活模块拼出来的：
 *
 * - **规则表与上限**以 JSON 从 `patterns.ts` 和 `file-picker.ts` 序列化而来。每
 *   一个名字、严重度、正则源码和 flag 都来自本地扫描器遍历的同一个对象。
 * - **匹配器、可信分层与评级**来自 `match-file.ts` 与 `file-picker.ts` 里那些函数
 *   的 `Function.prototype.toString()`。编译产物是合法 JavaScript，所以 sandbox
 *   跑的就是这个进程本来会跑的那份代码。
 *
 * 第二点是脆的，而且是真的脆：生成出来的源码是编译器吐出来的样子。
 * {@link parseSandboxScanOutput} 和 `apps/console` 里的调用方是照着「脚本坏了就
 * 退化成更慢的『把文件读回来在本地扫』」写的，所以坏了不会退化成不扫。见
 * `docs/design/SKILL_SECURITY_SCAN_PIPELINE.md` §4.3。
 */
import {
  acceptFile,
  DEFAULT_FILE_PICKER_LIMITS,
  extensionOf,
  isBinaryBytes,
  isScannablePath,
  SCAN_EXCLUDED_DIRS,
  SCAN_EXTENSIONS,
  type FilePickerLimits,
} from './file-picker'
import {
  citedOrNegated,
  computeTrustTier,
  dedupeFlags,
  extractHost,
  FENCE_RE,
  gradeFromFlags,
  inCodeFence,
  isTrustedHost,
  lineNumberAt,
  looksLikeRealSecret,
  matchPattern,
  NEGATION_RE,
  snippetAround,
} from './match-file'
import {
  HIGH_RISK_PATTERNS,
  MEDIUM_RISK_PATTERNS,
  PIPE_TO_SHELL_PATTERNS,
  PLACEHOLDER_SECRET_RE,
  REJECT_PATTERNS,
  SECRET_PATTERNS,
  TIER1_ORGS,
  TIER2_ORGS,
  TRUSTED_INSTALL_HOSTS,
  type PatternDef,
} from './patterns'
import { SCAN_RULES_VERSION } from './types'

/**
 * 脚本输出里属于我们的那一行的前缀。
 *
 * 靠「最后一行是 JSON」来解析 sandbox 命令的 stdout，会在 git 成功时打一行提示
 * 的那一刻坏掉——而它会打。有个标记之后，周边噪声就可以是任何东西。
 */
export const SANDBOX_SCAN_MARKER = '__OPENMCP_SCAN__'

/** 脚本在标记之后打印的东西。 */
export interface SandboxScanOutput {
  grade: string
  trustTier: number
  fileCount: number
  truncated: boolean
  truncatedReason?: string
  flags: unknown[]
  /**
   * 只有 `includeContent` 为真时才有内容；否则这里只有 `{ path, size }`。
   *
   * 走 manifest 分支时这份 payload 和 `fileCount` 成正比但与仓库体积无关——200 个
   * 路径大约几 KB，而同样的 200 个文件内容可以是 10 MB。这就是默认不取内容的原因。
   */
  files?: Array<{ path: string; size: number; content?: string }>
}

/** `RegExp` 不是 JSON，所以一条规则以它的两半出行。 */
function serialisePattern(def: PatternDef) {
  return {
    name: def.name,
    severity: def.severity,
    description: def.description,
    source: def.regex.source,
    flags: def.regex.flags,
    kind: def.kind,
    skipCodeBlock: def.skipCodeBlock === true,
  }
}

/** 同上：正则以 `{ source, flags }` 出行，而不是一段源码。 */
function serialiseRegex(re: RegExp) {
  return { source: re.source, flags: re.flags }
}

/**
 * 源码被借走的那些函数。
 *
 * 顺序无所谓——它们全是函数声明，会提升——但这份清单是刻意穷尽的：
 * {@link matchPattern} 可达却漏在这里的辅助函数，在本地编译通过，在 sandbox 里
 * 抛 `ReferenceError`。
 */
const BORROWED_SOURCES: ReadonlyArray<(...args: any[]) => unknown> = [
  lineNumberAt,
  snippetAround,
  inCodeFence,
  citedOrNegated,
  looksLikeRealSecret,
  extractHost,
  isTrustedHost,
  matchPattern,
  computeTrustTier,
  gradeFromFlags,
  dedupeFlags,
  extensionOf,
  isScannablePath,
  isBinaryBytes,
  acceptFile,
]

/** 驱动脚本从常量里读自己的参数（环境变量只留给运维覆盖体积上限）。 */
export interface SandboxScriptOptions {
  /** sandbox 内遍历的起始路径。缺省是 sandbox 的 cwd。 */
  basePath?: string
  limits?: FilePickerLimits
  /**
   * 是否把文件**内容**一并回传。
   *
   * 规则阶段不需要内容，manifest 就够，所以缺省 `false`：那样只回传路径和字节数，
   * 仓库源码根本不过网。阶段 2 需要内容，而复核器在 serverless 侧跑、sandbox 里没有
   * 模型 key——所以请求 LLM 阶段时这个开关会被打开，而这次搬运的字节本来就受
   * `limits.maxTotalBytes` 约束。
   */
  includeContent?: boolean
}

/**
 * 脚本文本。
 *
 * 刻意写成无依赖、无 CommonJS 以外的前提：sandbox 镜像里有 Node，其他东西都不
 * 保证有。整个调用就是 `node <file>`。
 *
 * 文件后缀要带 `.cjs`：脚本里用了 `require`，而 sandbox 镜像的 Node 版本不固定，
 * 写成 `.js` 时 `"type": "module"` 的祖先 `package.json` 会让它在解析阶段就报错。
 */
export function buildSandboxScanScript(options: SandboxScriptOptions = {}): string {
  const limits = options.limits || DEFAULT_FILE_PICKER_LIMITS
  const basePath = options.basePath || '/vercel/sandbox'
  const includeContent = options.includeContent === true

  const tables = {
    rulesVersion: SCAN_RULES_VERSION,
    allPatterns: [
      ...REJECT_PATTERNS,
      ...HIGH_RISK_PATTERNS,
      ...MEDIUM_RISK_PATTERNS,
      ...PIPE_TO_SHELL_PATTERNS,
      ...SECRET_PATTERNS,
    ].map(serialisePattern),
    trustedInstallHosts: TRUSTED_INSTALL_HOSTS,
    tier1Orgs: TIER1_ORGS,
    tier2Orgs: TIER2_ORGS,
    placeholderSecretRe: serialiseRegex(PLACEHOLDER_SECRET_RE),
    fenceRe: serialiseRegex(FENCE_RE),
    negationRe: serialiseRegex(NEGATION_RE),
    scanExtensions: SCAN_EXTENSIONS,
    scanExcludedDirs: SCAN_EXCLUDED_DIRS,
    limits,
    includeContent,
  }

  return [
    '"use strict"',
    `var TABLES = ${JSON.stringify(tables)};`,
    `var SCAN_BASE = ${JSON.stringify(basePath)};`,
    'var fs = require("fs");',
    'var path = require("path");',
    'var MAX_FILE_CHARS = Number(process.env.SCAN_FILE_MAX_SIZE || 5242880);',
    'var FENCE_RE = new RegExp(TABLES.fenceRe.source, TABLES.fenceRe.flags);',
    'var NEGATION_RE = new RegExp(TABLES.negationRe.source, TABLES.negationRe.flags);',
    'var PLACEHOLDER_SECRET_RE = new RegExp(TABLES.placeholderSecretRe.source, TABLES.placeholderSecretRe.flags);',
    'var TRUSTED_INSTALL_HOSTS = TABLES.trustedInstallHosts;',
    'var TIER1_ORGS = TABLES.tier1Orgs;',
    'var TIER2_ORGS = TABLES.tier2Orgs;',
    'var SCAN_EXTENSIONS = TABLES.scanExtensions;',
    'var SCAN_EXCLUDED_DIRS = TABLES.scanExcludedDirs;',
    'var ALL_PATTERNS = TABLES.allPatterns.map(function (def) {',
    '  def.regex = new RegExp(def.source, def.flags);',
    '  return def;',
    '});',
    '',
    ...BORROWED_SOURCES.map((fn) => fn.toString()),
    '',
    DRIVER,
  ].join('\n')
}

/**
 * 那次遍历。
 *
 * 留成纯字符串而不是一个模块，是因为它是唯一不能借来的部分：它做 IO，而这个包
 * 不做 IO。
 */
const DRIVER = `
function relativePosix(from, to) {
  return path.relative(from, to).split(path.sep).join('/');
}

function collectFiles(root, out) {
  var entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch (error) {
    return out;
  }
  for (var i = 0; i < entries.length; i++) {
    var entry = entries[i];
    var full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (SCAN_EXCLUDED_DIRS.indexOf(entry.name) !== -1) continue;
      collectFiles(full, out);
      if (out.stopped) return out;
      continue;
    }
    if (!entry.isFile()) continue;
    var rel = relativePosix(root, full);
    if (!isScannablePath(rel)) continue;
    var stats;
    try {
      stats = fs.statSync(full);
    } catch (error) {
      continue;
    }
    var decision = acceptFile(
      TABLES.limits,
      { count: out.files.length, bytes: out.bytes },
      rel,
      stats.size
    );
    if (!decision.ok) {
      out.truncated = true;
      out.truncatedReason = decision.reason;
      out.stopped = true;
      return out;
    }
    var bytes;
    try {
      bytes = fs.readFileSync(full);
    } catch (error) {
      continue;
    }
    if (isBinaryBytes(bytes)) continue;
    out.files.push({ path: rel, content: bytes.toString('utf8'), size: bytes.length });
    out.bytes += bytes.length;
  }
  return out;
}

function main() {
  var ctx = {};
  try {
    ctx = process.env.SCAN_CONTEXT ? JSON.parse(process.env.SCAN_CONTEXT) : {};
  } catch (error) {
    ctx = {};
  }

  var gathered = collectFiles(SCAN_BASE, { files: [], bytes: 0, truncated: false, stopped: false });
  var flags = [];
  var fileCount = 0;
  for (var i = 0; i < gathered.files.length; i++) {
    var file = gathered.files[i];
    if (file.content.length > MAX_FILE_CHARS) {
      file.content = file.content.slice(0, MAX_FILE_CHARS);
    }
    fileCount++;
    for (var r = 0; r < ALL_PATTERNS.length; r++) {
      var found = matchPattern(file, ALL_PATTERNS[r], ctx);
      for (var h = 0; h < found.length; h++) flags.push(found[h]);
    }
  }
  var unique = dedupeFlags(flags);
  var trustTier = computeTrustTier(ctx);
  var emitted = [];
  for (var f = 0; f < gathered.files.length; f++) {
    emitted.push(
      TABLES.includeContent
        ? {
            path: gathered.files[f].path,
            size: gathered.files[f].size,
            content: gathered.files[f].content,
          }
        : { path: gathered.files[f].path, size: gathered.files[f].size }
    );
  }
  process.stdout.write(
    '${SANDBOX_SCAN_MARKER}' +
      JSON.stringify({
        grade: gradeFromFlags(unique, trustTier),
        trustTier: trustTier,
        fileCount: fileCount,
        truncated: gathered.truncated,
        truncatedReason: gathered.truncatedReason || null,
        flags: unique,
        files: emitted,
      }) +
      '\\n'
  );
}

main();
`

/**
 * 从 sandbox 命令的 stdout 里读出那一行。
 *
 * 取**最后一个**带标记的行：git 和 node 往同一个流里写，而如果将来某个 sandbox
 * 镜像把脚本本身回显出来，回显在前。内容不合预期时抛错而不是返回 `null`——
 * 调用方把异常当作「退化成把文件读回来在本地扫」，一个静默的 `null` 会把这件事
 * 变成一次「零文件、safe」的扫描。
 */
export function parseSandboxScanOutput(stdout: string): SandboxScanOutput {
  const lines = stdout.split(/\r?\n/)
  let payload: string | undefined
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i] ?? ''
    const at = line.indexOf(SANDBOX_SCAN_MARKER)
    if (at !== -1) {
      payload = line.slice(at + SANDBOX_SCAN_MARKER.length)
      break
    }
  }
  if (payload === undefined) {
    throw new Error('sandbox scanner produced no result line')
  }
  const parsed = JSON.parse(payload) as SandboxScanOutput
  if (!parsed || typeof parsed.grade !== 'string' || !Array.isArray(parsed.flags)) {
    throw new Error('sandbox scanner result is not a scan')
  }
  return parsed
}