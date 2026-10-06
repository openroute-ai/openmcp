/**
 * 单文件匹配、可信度分层与评级——Skills 扫描器的全部决策核心，没有别的东西。
 *
 * **这个文件里的所有函数都会被序列化进 Vercel Sandbox 脚本**（见
 * `sandbox-script.ts`），因此它有两条 `packages/security-scan` 里其他文件都没有的
 * 约束：
 *
 * 1. 从 {@link matchFileHits} 可达的每个函数都必须 export，且必须列进
 *    `sandbox-script.ts` 的清单。某个漏掉的私有辅助函数在本地能跑，在 Sandbox
 *    里会在读第一个文件时抛 `ReferenceError`——错误被捕获后会回落，所以它的
 *    真实表现是「默认那条快路径悄无声息地不再是快路径」。
 * 2. 这些函数只能引用脚本同样会发出的名字：规则表（以 JSON 序列化）和
 *    {@link FENCE_RE} / {@link NEGATION_RE}。不能 import，不能引用无法序列化的
 *    模块常量，也不能用会被编译器降级成共享辅助函数的语法（对象/数组展开最常见，
 *    它会变成 `__spreadValues`）。
 *
 * 这个代价是真的：这个模块不能从同级文件 import 辅助函数。这是「一套规则、
 * 三种执行环境」的定价，写在 `docs/design/SKILL_SECURITY_SCAN_PIPELINE.md` §4.3。
 */
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
import type { ScanContext, ScanFileInput, SecurityFlagHit, SecurityGrade, TrustTier } from './types'

/** 围栏代码块。带 `skipCodeBlock` 的规则不在其中触发。 */
export const FENCE_RE = /```[\s\S]*?```/g

/**
 * 标记「这是在引用，不是在下指令」的词。
 *
 * `e.g.` 之类之所以在列表里，是因为 Skill 文档经常把那条危险命令**作为示例**写
 * 出来。但它同时也让这层判断相当粗糙——所以窗口开得很短，并且是按每一次匹配
 * 判断，而不是按整个文件判断。
 */
export const NEGATION_RE = /\b(never|do not|don't|dont|avoid|instead of|such as|e\.g\.|for example)\b/i

/**
 * 全部规则表，按扫描应用顺序拼接。
 *
 * 顺序是唯一重要的事，而它是稳定的：`critical` 在 `high` 前、`high` 在 `medium`
 * 前，所以读者在一个文件上看到的第一个命中就是最严重的那个。本地扫描器与
 * Sandbox 脚本消费的是这同一份列表，所以任何地方新增一条规则，两边都会出现。
 */
export const ALL_PATTERNS: PatternDef[] = [
  ...REJECT_PATTERNS,
  ...HIGH_RISK_PATTERNS,
  ...MEDIUM_RISK_PATTERNS,
  ...PIPE_TO_SHELL_PATTERNS,
  ...SECRET_PATTERNS,
]

/** `index` 在 `content` 里的 1 基行号。 */
export function lineNumberAt(content: string, index: number): number {
  return content.slice(0, index).split('\n').length
}

/** `index` 所在整行，trim 后截断——不让单条命中拖走一个文件的内容。 */
export function snippetAround(content: string, index: number): string {
  const start = content.lastIndexOf('\n', index)
  const end = content.indexOf('\n', index)
  const line = content.slice(start + 1, end === -1 ? undefined : end).trim()
  return line.slice(0, 240)
}

/** `index` 是否落在某个围栏代码块内。 */
export function inCodeFence(content: string, index: number): boolean {
  const fences = content.matchAll(FENCE_RE)
  for (const match of fences) {
    const at = match.index
    if (typeof at === 'number' && index >= at && index < at + match[0].length) return true
  }
  return false
}

/**
 * 命中处的上下文读起来是引用而不是指令。
 *
 * 前后窗口刻意不对称：命中前 120 字符是「不要 X」会出现的地方，后 80 字符是
 * 「例如」会出现的地方；不对称也让前向回溯不会伸进上一条语句。
 */
export function citedOrNegated(content: string, index: number): boolean {
  const start = Math.max(0, index - 120)
  const window = content.slice(start, index + 80)
  return NEGATION_RE.test(window)
}

/**
 * 一条 `secret` 类命中是否看起来像真凭据。
 *
 * 两道过滤，缺一不可：占位符过滤（`YOUR_API_KEY` 不是泄漏），以及熵下限——
 * 因为那些「形状像密钥」的正则同样会匹配 `sk-` 后面跟一个长单词的散文。
 */
export function looksLikeRealSecret(value: string): boolean {
  if (PLACEHOLDER_SECRET_RE.test(value)) return false
  const unique = new Set(value.replace(/[^A-Za-z0-9]/g, '')).size
  return unique >= 10
}

/** `match` 里第一个绝对 URL 的 host，小写。 */
export function extractHost(match: string): string | null {
  const url = match.match(/https?:\/\/([^/\s'"]+)/i)
  return url?.[1]?.toLowerCase() ?? null
}

/**
 * 把管道执行喂给 `host` 这件事本身是否不算命中。
 *
 * `curl … | sh` 从 `github.com` 来就是 Skill 的安装方式；同一条命令换个随机 host
 * 就是命中。仓库自己的 owner 和它自己声明的 homepage 按同样的理由算可信。
 */
export function isTrustedHost(host: string | null, ctx: ScanContext): boolean {
  if (!host) return false
  for (const trusted of TRUSTED_INSTALL_HOSTS) {
    if (host === trusted || host.endsWith('.' + trusted)) return true
  }
  const owner = ctx.owner ? ctx.owner.toLowerCase() : ''
  if (owner && host.includes(owner)) return true
  if (ctx.homepage) {
    try {
      const homepageHost = new URL(ctx.homepage).host.toLowerCase()
      if (host === homepageHost || host.endsWith('.' + homepageHost)) return true
    } catch {
      // 一个不是 URL 的 homepage 什么都证明不了。
      return false
    }
  }
  return false
}

/** 一条规则对一个文件产生的命中，尚未跨文件去重。 */
export function matchPattern(file: ScanFileInput, def: PatternDef, ctx: ScanContext): SecurityFlagHit[] {
  const hits: SecurityFlagHit[] = []
  const content = file.content
  const flags = def.regex.flags
  const regex = new RegExp(def.regex.source, flags.includes('g') ? flags : flags + 'g')

  for (const match of content.matchAll(regex)) {
    const index = match.index === undefined ? 0 : match.index
    const fenced = inCodeFence(content, index)
    if (def.skipCodeBlock && fenced) continue
    if (citedOrNegated(content, index)) continue
    if (def.kind === 'secret' && !looksLikeRealSecret(match[0])) continue
    if (def.kind === 'pipe' && isTrustedHost(extractHost(match[0]), ctx)) continue

    hits.push({
      name: def.name,
      severity: def.severity,
      description: def.description,
      file: file.path,
      line: lineNumberAt(content, index),
      snippet: snippetAround(content, index),
      inCodeBlock: fenced,
      // `citedOrNegated` 对每个走到这里的命中都已经判过假了，所以这一栏记录的
      // 是「抑制逻辑跑过了」，不是「它救下了这次匹配」。
      citedOrNegated: false,
    })
  }
  return hits
}

/** 每条规则对每个文件，按文件序再按规则序。 */
export function matchFileHits(files: ScanFileInput[], ctx: ScanContext = {}): SecurityFlagHit[] {
  const hits: SecurityFlagHit[] = []
  for (const file of files) {
    for (const def of ALL_PATTERNS) {
      const found = matchPattern(file, def, ctx)
      for (const hit of found) hits.push(hit)
    }
  }
  return hits
}

/**
 * 在读任何一条规则之前，来源有多可信。
 *
 * 这是**缓解措施**，不是结论：tier-1 的 owner 不能借此发一个后门，只是要多一条
 * `high` 才能到 `unsafe`。只有 `critical` 能越过它，而 `critical` 越过一切。
 */
export function computeTrustTier(ctx: ScanContext): TrustTier {
  const owner = (ctx.owner || '').toLowerCase()
  if (TIER1_ORGS.includes(owner)) return 1
  if (TIER2_ORGS.includes(owner)) return 2
  const stars = ctx.stars || 0
  const licensed = Boolean(ctx.license && ctx.license !== 'NOASSERTION')
  if (stars >= 1000 && licensed) return 3
  if (stars >= 100 && licensed) return 4
  return 5
}

/**
 * 命中集合变成一个评级。
 *
 * 刻意不做加权平均：一堆 `medium` 压不过一个 `critical`，而严重度唯一被软化
 * 的地方是可信来源上的 `high`。
 */
export function gradeFromFlags(flags: SecurityFlagHit[], trustTier: TrustTier): SecurityGrade {
  let critical = 0
  let high = 0
  let medium = 0
  for (const flag of flags) {
    if (flag.severity === 'critical') critical++
    else if (flag.severity === 'high') high++
    else if (flag.severity === 'medium') medium++
  }

  if (critical > 0) return 'reject'
  if (high === 0) return medium >= 2 ? 'caution' : 'safe'
  if (trustTier <= 3) return 'caution'
  if (trustTier === 4) return high > 1 ? 'unsafe' : 'caution'
  return 'unsafe'
}

/**
 * 去掉同一条规则在同一行匹配两次留下的重复。
 *
 * 键是「规则 + 文件 + 行」而不是整条 flag，这样同一条规则在同一行上的两次
 * 真正不同的匹配——比如一个带两个 host 的 `curl … | sh`——会作为两条发现保留下来。
 */
export function dedupeFlags(flags: SecurityFlagHit[]): SecurityFlagHit[] {
  const seen = new Set<string>()
  const unique: SecurityFlagHit[] = []
  for (const flag of flags) {
    const key = flag.name + ':' + (flag.file || '') + ':' + (flag.line || 0)
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(flag)
  }
  return unique
}