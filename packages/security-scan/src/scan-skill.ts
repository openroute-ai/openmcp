/**
 * 两阶段扫描，以及评级变成决策的唯一位置。
 *
 * 阶段 1 是 {@link scanFiles}：纯、离线、确定性。阶段 2 是 LLM 复核，而它只在阶段
 * 1 说「有东西值得辩一辩」（`caution` / `unsafe`）时才跑——干净的阶段 1 不需要第二
 * 意见，而为每个干净仓库都付一次模型费就是这么把账单养大的。
 *
 * 这个模块不知道文件从哪里来，这正是重点：`apps/console` 从 sandbox、从
 * `git clone`、从 ZIP 拿到文件，然后调同样这三个函数，于是环境无法改变结论。
 *
 * 这里刻意包含的：评级合并、单文件截断、报告形状。这里刻意不包含的：落库。
 * 「判一个评级」和「把评级记下来」是两件事（表归 `apps/web` 所有，Console 一张
 * 表都不写），而把写入折进来正是它以前没法测的原因。
 */
import { analyzeWithLlm } from './llm-analyzer'
import { manifestOf, type SkillScanSource, type SkillSourceSnapshot } from './sources'
import { scanFiles } from './rule-scanner'
import { SCAN_RULES_VERSION } from './types'
import type {
  LlmAnalysis,
  ScanContext,
  ScanFileInput,
  ScanResult,
  SecurityFlagHit,
  SecurityGrade,
  TrustTier,
} from './types'

/**
 * 交给匹配器的单个文件最大字符数。
 *
 * 从环境变量读，是为了让内存吃紧的部署可以调低；默认值高到一个仓库里真正的源码
 * 永远不会被切掉。按**字符**而不是字节算，因为它约束的正是
 * `String.prototype.slice`，而且它防的那个失败（一份 40 MB 的 minified bundle）
 * 在更早一步就被文件筛选器挡掉了。
 */
const MAX_FILE_CHARS = Number(process.env.SCAN_FILE_MAX_SIZE || 5 * 1024 * 1024)

function truncate(content: string): string {
  return content.length <= MAX_FILE_CHARS ? content : content.slice(0, MAX_FILE_CHARS)
}

/**
 * 阶段 2 的结论并入阶段 1。
 *
 * 一条 `critical` 是终局：没有任何复核能把后门辩掉。当完全没有复核结论时，`unsafe`
 * 报成 `caution` 而不是照单全收——在默认自动发布集合下两者都落进
 * `pending_review`，所以这只影响那些把 `caution` 也勾进自动发布的部署。
 */
export function mergeGrades(rule: SecurityGrade, llm: SecurityGrade | null): SecurityGrade {
  if (rule === 'reject') return 'reject'
  if (!llm) return rule === 'unsafe' || rule === 'caution' ? 'caution' : rule
  if (llm === 'safe') return 'safe'
  return llm
}

/** 阶段 2 没能给出结论时落库的占位。 */
export const LLM_UNAVAILABLE: LlmAnalysis = {
  grade: 'caution',
  confidence: 0,
  riskSummary: 'LLM review unavailable; manual review recommended.',
  findings: [],
  recommendation: 'Manual review recommended',
}

export type LlmReviewer = (
  files: ScanFileInput[],
  flags: SecurityFlagHit[],
  ruleGrade: SecurityGrade
) => Promise<LlmAnalysis | null>

export interface SkillScanRequest {
  files: ScanFileInput[]
  context?: ScanContext
}

export interface FullScanOptions {
  /**
   * 阶段 2。缺省用打包的复核器；`null` 跳过。
   *
   * 可注入是为了让调用方能在没有模型 key 的情况下单独测规则，也让 sandbox 那条
   * 路径——它没有 key、也不该有 key——能断言「光靠阶段 1 就足以复现一个结论」。
   */
  review?: LlmReviewer | null
}

/** 只跑阶段 1。它是同步的，所以就是同步的。 */
export function runRuleScan(request: SkillScanRequest): {
  grade: SecurityGrade
  flags: SecurityFlagHit[]
  trustTier: TrustTier
  fileCount: number
} {
  const files = request.files.map((file) => ({
    path: file.path,
    content: truncate(file.content),
  }))
  return scanFiles(files, request.context || {})
}

/** 两个阶段，以及它们谈拢的评级。 */
export async function runFullScan(
  request: SkillScanRequest,
  options: FullScanOptions = {}
): Promise<ScanResult> {
  const files = request.files.map((file) => ({
    path: file.path,
    content: truncate(file.content),
  }))
  const rule = scanFiles(files, request.context || {})
  const review = options.review === undefined ? analyzeWithLlm : options.review

  let llmGrade: SecurityGrade | undefined
  let llmAnalysis: LlmAnalysis | undefined
  if (review && (rule.grade === 'caution' || rule.grade === 'unsafe')) {
    const analysis = await review(files, rule.flags, rule.grade)
    if (analysis) {
      llmGrade = analysis.grade
      llmAnalysis = analysis
    } else {
      // 「没有复核」和「复核说是 caution」是两件不同的事实，两者都必须看得见，
      // 否则一个没有模型 key 的部署看起来就像一个复核过并且不满意的部署。
      llmAnalysis = LLM_UNAVAILABLE
    }
  }

  return {
    grade: mergeGrades(rule.grade, llmGrade ?? null),
    flags: rule.flags,
    trustTier: rule.trustTier,
    ...(llmGrade ? { llmGrade } : {}),
    ...(llmAnalysis ? { llmAnalysis } : {}),
    scannedAt: new Date().toISOString(),
    rulesVersion: SCAN_RULES_VERSION,
    fileCount: rule.fileCount,
  }
}

/**
 * 一条获取路径交回来的报告：一次扫描，加上区分两次扫描所需的事实。
 *
 * `source`、`truncated`、`fileCount` 是结论的一部分，不是关于结论的元数据——读了
 * 200 个文件里的 4 个，和读全 200 个，是两句不同的话，而这个区别必须活到审核
 * 队列里去。
 */
export interface SkillScanReport extends ScanResult {
  source: SkillScanSource
  truncated: boolean
  truncatedReason?: string
  files: Array<{ path: string; size: number }>
}

/** 对一份已获取的快照跑完两个阶段。 */
export async function runSkillScan(
  snapshot: SkillSourceSnapshot,
  request: Omit<SkillScanRequest, 'files'> = {},
  options: FullScanOptions = {}
): Promise<SkillScanReport> {
  const result = await runFullScan(
    { files: snapshot.files, context: request.context },
    options
  )
  const manifest = manifestOf(snapshot)
  return {
    ...result,
    source: manifest.source,
    truncated: manifest.truncated,
    ...(manifest.truncatedReason ? { truncatedReason: manifest.truncatedReason } : {}),
    files: manifest.files,
  }
}