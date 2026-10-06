/**
 * 扫描器的浏览器安全面。
 *
 * 从这里可达的一切都是纯的：没有 `ai`、没有 `node:*`、没有 `process.env`。这正是
 * 一个组件能用**产出**评级的那份代码去**渲染**一个已存下来的 `SecurityGrade` 的
 * 原因——评级规则是一份实现，不是组件里的再实现。
 *
 * 复核器（`scan-skill.ts`）刻意不在这里。它会伸手去拿模型和 key；客户端组件一旦
 * import 它，bundle 要么泄漏一个 key，要么构建不过，而两者都不值「少写一条
 * import 路径」这个便利。
 */
export { SCAN_RULES_VERSION } from './types'
export type {
  LlmAnalysis,
  RuleScanResult,
  ScanContext,
  ScanFileInput,
  ScanResult,
  SecurityFlagHit,
  SecurityGrade,
  TrustTier,
} from './types'
export {
  ALL_PATTERNS,
  computeTrustTier,
  dedupeFlags,
  gradeFromFlags,
  matchFileHits,
  matchPattern,
} from './match-file'
export { scanFiles } from './rule-scanner'
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
export {
  manifestOf,
  type SkillScanSource,
  type SkillSourceFile,
  type SkillSourceManifest,
  type SkillSourceSnapshot,
} from './sources'