/**
 * 每条获取路径都要对齐的类型。
 *
 * 一个 sandbox、一份磁盘上的 `git clone`、一个浏览器已经解好的 ZIP，在开始扫描
 * 之前都归约为同一种东西：一份 `{ path, content }` 列表，加上「这份列表是否就是
 * 整个仓库」。把这个形状放在包里（而不是放在恰好负责抓取的那个 app 里），才能
 * 让「各部署用同一套规则」成为类型层面的性质，而不是一条约定。
 */

/** 一个文本文件，路径相对扫描根目录。 */
export interface SkillSourceFile {
  /** 相对被扫描目录的 POSIX 路径。绝不会是绝对路径。 */
  path: string
  content: string
  /** 读取时的字节数，在扫描器做任何单文件截断之前。 */
  size: number
}

/** 字节实际从哪里来。落库，好让两次扫描可比。 */
export type SkillScanSource =
  | 'local-clone'
  | 'vercel-sandbox'
  | 'vercel-sandbox-serverless'

/**
 * 一次获取的结果：仓库里值得扫的文本。
 *
 * `truncated` 不是一条警告，它是关于**结论**的事实：一次被截断的扫描说的是
 * 「读到的文件里没发现问题」，从来不是「没发现问题」。调用方不得把被截断的快照
 * 变成 `safe`。
 */
export interface SkillSourceSnapshot {
  files: SkillSourceFile[]
  source: SkillScanSource
  truncated: boolean
  /** 机器可读的成因：`max_files` / `max_total_bytes` / `file_too_large`。 */
  truncatedReason?: string
}

/** {@link SkillSourceSnapshot} 去掉内容，只留够解释「读了什么、没读什么」的部分。 */
export interface SkillSourceManifest {
  source: SkillScanSource
  truncated: boolean
  truncatedReason?: string
  files: Array<{ path: string; size: number }>
}

/** 去掉内容，保留足以解释读取范围的信息。 */
export function manifestOf(snapshot: SkillSourceSnapshot): SkillSourceManifest {
  return {
    source: snapshot.source,
    truncated: snapshot.truncated,
    ...(snapshot.truncatedReason ? { truncatedReason: snapshot.truncatedReason } : {}),
    files: snapshot.files.map((file) => ({ path: file.path, size: file.size })),
  }
}