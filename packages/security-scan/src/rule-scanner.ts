/**
 * 规则扫描本体：走文件、跑规则表、评级。
 *
 * 匹配本身在 `match-file.ts`，因为 Vercel Sandbox 序列化的是**那个**模块。留在
 * 这里的是 Sandbox 不需要的那部分——它拿到的本来就是一份文件数组。
 *
 * {@link scanFiles} 是纯函数：不做 IO、不读时钟、不看环境变量。正是这一点让
 * 「同一个提交在任何部署上都得到同一个结论」成为可验证的，而不是一句愿望。
 */
import {
  ALL_PATTERNS,
  computeTrustTier,
  dedupeFlags,
  gradeFromFlags,
  matchPattern,
} from './match-file'
import type {
  RuleScanResult,
  ScanContext,
  ScanFileInput,
  SecurityFlagHit,
} from './types'

/**
 * 扫描的阶段 1。
 *
 * `ctx` 是可信度上下文（`owner` / `homepage` / `stars` / `license`）；它会改变
 * 评级，但永远不会抑制一条 `critical`——否则调用方就能用它把发现藏起来。
 */
export function scanFiles(files: ScanFileInput[], ctx: ScanContext = {}): RuleScanResult {
  const trustTier = computeTrustTier(ctx)
  const flags = dedupeFlags(collect(files, ctx))
  return {
    grade: gradeFromFlags(flags, trustTier),
    flags,
    trustTier,
    fileCount: files.length,
  }
}

/**
 * 全部 (文件, 规则) 命中，按文件序再按规则序。
 *
 * 写成循环而不是 `flatMap`，只是因为结果是 push 而不是拼接：整个扫描共用一个
 * `flags` 数组，而不是每个 (文件, 规则) 对一个中间数组。
 */
function collect(files: ScanFileInput[], ctx: ScanContext): SecurityFlagHit[] {
  const hits: SecurityFlagHit[] = []
  for (const file of files) {
    for (const def of ALL_PATTERNS) {
      const found = matchPattern(file, def, ctx)
      for (const hit of found) hits.push(hit)
    }
  }
  return hits
}