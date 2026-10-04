/**
 * 写入端点（`POST /api/v1/repos` 与 `/api/v1/projects`）共用的请求解析。
 *
 * 两个端点的地址形态是同一种设计的两个刻面：`{ url }` 给一整个 GitHub 地址，
 * `{ repo }` 给裸的 `owner/repo`。差别只在调用方手上有什么——从 GitHub 页面
 * 复制过来的是 URL，从 CI 的配置文件里读出来的多半已经是 `owner/repo`。
 *
 * 放在一处是因为「两个都给了算谁的」这条规则必须只有一个答案：两个端点各写一遍，
 * 迟早会出现一个收 `url`、另一个收 `repo` 的组合，而那种组合没法向调用方解释。
 */
import { parseGithubRepoUrl, parseRepoSlug } from "@/lib/github/repo-url"

/** 两个写入端点都接受的那一小块请求体。 */
export interface WriteRequestBody {
  url?: string
  repo?: string
  callbackUrl?: string
  callbackSecret?: string
}

export interface ResolvedTarget {
  fullName: string
  /** 给了 `callbackUrl` 就一定有 secret：缺一个就是 400，不替调用方挑默认值。 */
  callback?: { url: string; secret: string }
}

export type TargetResult =
  | { ok: true; target: ResolvedTarget }
  | { ok: false; code: "invalid_body" | "invalid_url"; message: string; detail?: string }

/**
 * 把请求体解析成 `owner/name`，顺带取出回调配置。
 *
 * 两种地址只接受各自那种拼法：`url` 走 URL 解析（含 `git@` 与无 scheme 的写法），
 * `repo` 只认裸的 `owner/repo`。反过来也报错——字段名与内容对不上时，
 * 「你大概想写的是另一个字段」比「我去猜」有用。
 */
export function resolveWriteTarget(
  body: WriteRequestBody
): TargetResult {
  if (body.url && body.repo) {
    return {
      ok: false,
      code: "invalid_body",
      message: "url 与 repo 二选一，不能同时给",
    }
  }
  if (!body.url && !body.repo) {
    return {
      ok: false,
      code: "invalid_body",
      message: "需要 { url } 或 { repo: \"owner/name\" }",
    }
  }

  const fullName = body.url
    ? (parseGithubRepoUrl(body.url)?.fullName ?? null)
    : (parseRepoSlug(body.repo)?.fullName ?? null)

  if (!fullName) {
    // 两种都归到 `invalid_url`：字段选对了、形状也对，是**值**不是一个能用的地址。
    // 分成两个码会让调用方多写一个分支，而两个分支的处理方式完全一样：改地址。
    return body.url
      ? {
          ok: false,
          code: "invalid_url",
          message: `"${body.url}" 不是 GitHub 仓库地址`,
        }
      : {
          ok: false,
          code: "invalid_url",
          message: `"${body.repo}" 不是 owner/name 格式`,
          detail: "repo 只接受裸的 owner/repo（可带 .git），不接受 URL",
        }
  }

  if (body.callbackUrl && !body.callbackSecret) {
    return {
      ok: false,
      code: "invalid_body",
      message: "给了 callbackUrl 就必须给 callbackSecret",
      detail:
        "回调签名密钥不能有默认值：常量等于公开，派生自 API key 等于把 key 的寿命绑到回调上",
    }
  }

  return {
    ok: true,
    target: {
      fullName,
      callback: body.callbackUrl
        ? { url: body.callbackUrl, secret: body.callbackSecret! }
        : undefined,
    },
  }
}