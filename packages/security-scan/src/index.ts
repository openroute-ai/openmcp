/**
 * `@workspace/security-scan` —— 一套规则表。
 *
 * 两个入口：
 *
 * - `.`（本文件）—— 全部，含 LLM 复核器。仅 Node。
 * - `./core` —— 纯的那一半，可以从浏览器 bundle 里 import。
 *
 * 这里没有任何东西知道文件从哪里来。`apps/console` 从 Vercel Sandbox、从
 * `git clone`、从 ZIP 拿到文件，把每一种都归约成
 * {@link SkillSourceSnapshot}，然后拿到同一个结论。这才是整件事的性质所在：
 * 部署目标不能改变一个答案。
 */
export { SCAN_RULES_VERSION } from './types'
export type {
  FlagSeverity,
  LlmAnalysis,
  RuleScanResult,
  ScanContext,
  ScanFileInput,
  ScanResult,
  SecurityFlagHit,
  SecurityGrade,
  TrustTier,
} from './types'

/* 两个阶段，以及一条获取路径交回来的报告。 */
export {
  LLM_UNAVAILABLE,
  mergeGrades,
  runFullScan,
  runRuleScan,
  runSkillScan,
  type FullScanOptions,
  type LlmReviewer,
  type SkillScanReport,
  type SkillScanRequest,
} from './scan-skill'

/* 阶段 1 单独暴露给只想要规则、不想要流水线的人。 */
export { scanFiles } from './rule-scanner'
export {
  ALL_PATTERNS,
  computeTrustTier,
  dedupeFlags,
  gradeFromFlags,
  matchFileHits,
  matchPattern,
} from './match-file'

/* 读哪些文件——一份实现，三条路径共用。 */
export {
  DEFAULT_FILE_PICKER_LIMITS,
  SCAN_EXCLUDED_DIRS,
  SCAN_EXTENSIONS,
  acceptFile,
  extensionOf,
  isBinaryBytes,
  isScannablePath,
  type FilePickerDecision,
  type FilePickerLimits,
} from './file-picker'

/* 每条获取路径归约到的那个形状。 */
export {
  manifestOf,
  type SkillScanSource,
  type SkillSourceFile,
  type SkillSourceManifest,
  type SkillSourceSnapshot,
} from './sources'

/* 阶段 2。仅 Node —— 它要伸手去拿一个 key。 */
export { analyzeWithLlm } from './llm-analyzer'

/* Vercel Sandbox 脚本生成器，以及怎么读它的输出。 */
export {
  SANDBOX_SCAN_MARKER,
  buildSandboxScanScript,
  parseSandboxScanOutput,
  type SandboxScanOutput,
  type SandboxScriptOptions,
} from './sandbox-script'

/* 入站 Gateway 的载荷走同一套评级规则。 */
export {
  GATEWAY_SCAN_RULES_VERSION,
  gradeFrom,
  scanGatewayMetadata,
  runGatewayScan,
  type GatewayScanInput,
  type GatewayScanResult,
} from './gateway-scan'