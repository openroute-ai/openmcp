/**
 * `Idempotency-Key` 的回放（设计文档 §3.3）。
 *
 * 这是**唯一一个必须同时看到请求与响应的中间层**：入口拿到 `Idempotency-Key` 时先占槽，
 * 抢到的那个执行并把结果记下来，抢不到的回放或收到"处理中"。写在路由里做不到这一点，
 * 因为路由拿不到"自己将要产生的响应"——它得在响应建好之后回来补一行，而那样一旦补写
 * 失败，这次调用已经对外成功了。
 *
 * ## 为什么用"占槽"而不是"先查后写"
 *
 * 「先查后写」之间有一个窗口：两个并发的同 key 请求都会查到 miss、都执行、都写。
 * 主键让第二个写入失败，于是**结果**是确定的（报错而不是双跑成功），但**副作用**已经
 * 发生——两个 201、两次回调。所以执行之前先插一行 `response_status = 0` 的预占行，
 * 冲突的那个读到的就是"有人在处理"。
 *
 * `0` 而不是另加一列 `in_flight`：一个只有一列的表不会让"忘了写这一列"与"写成了 0"
 * 混为一谈，而后者是更常见的 bug。
 *
 * ## 为什么记响应体而不是重跑
 *
 * 重跑拿不到同一个答案：`POST /repos` 会再调一次 GitHub，第二次的 `stars` 可能已经变了，
 * 回调也只该发一次。所以存下这次的**答案**（状态码 + 响应体），而不是重跑。
 *
 * 注意保证的边界：存的是 JSONB 而不是字节流，所以回放与首次响应语义一致、键序可能不同。
 * 需要"逐字节相同"的调用方不能靠这一层拿到。
 */
import { createHash } from "node:crypto"
import { and, eq, lt, sql } from "drizzle-orm"
import { db } from "@/db/client"
import {
  apiRequestIdempotency,
  IDEMPOTENCY_TTL_HOURS,
} from "@/db/schema/api-request-idempotency"

/** 预占行的标记：一个不是任何真实状态码的数。 */
const IN_FLIGHT_STATUS = 0

/**
 * 头里的 key 的长度上限。
 *
 * 200 字符足够写下任何有意义的用法，而这一列进主键且被回放查询读：无限长会让一条客户端
 * bug（把整个 request body 当 key 塞进来）变成一张按 MB 计的表。
 */
export const IDEMPOTENCY_KEY_MAX_LENGTH = 200

export type Reservation<T> =
  /** 去执行，成功后 {@link rememberResponse}，失败后 {@link releaseSlot}。 */
  | { kind: "execute"; key: string }
  /** 上一次同 key 同参数的结果，原样回放。 */
  | { kind: "replay"; key: string; status: number; body: T }
  /** 同 key 的另一个请求正在执行。 */
  | { kind: "in_flight"; key: string }
  /** 同 key 不同参数。 */
  | { kind: "conflict"; key: string }

/** 从请求头取 key，顺带拒绝空串与超长串（超长当作没带，不当作错误）。 */
export function idempotencyKeyOf(request: Request): string | null {
  const raw = request.headers.get("idempotency-key")?.trim()
  if (!raw) return null
  return raw.length > IDEMPOTENCY_KEY_MAX_LENGTH ? null : raw
}

/**
 * 请求指纹：喂**规范化后**的参数，而不是原始 body 字节。
 *
 * 两个原因，每一个都对应一种真实的误判：
 *
 * - `{"repo":"a/b"}` 与 `{"url":"https://github.com/a/b"}` 是同一个请求，但 body 字节
 *   不同。指纹按解析后的字段算，它们才会互相回放。
 * - 键序不该有影响。`JSON.stringify` 的输出顺序跟调用方构造对象的顺序走，同一个请求
 *   在两次调用里字节不同是常态，而把那种差异判成"不同请求"就是一次假 409。
 *
 * `callbackSecret` 参与指纹是必要的：不参与的话，同一个 key 换一个回调地址会被判成
 * "同一个请求"而回放上次的结果，调用方以为回调已经切走了。它只以 hash 的形式进入指纹。
 */
export function requestFingerprint(
  method: string,
  path: string,
  body: unknown
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        method: method.toUpperCase(),
        path,
        body: canonical(body),
      }),
      "utf8"
    )
    .digest("hex")
}

/** 键序无关的 JSON。数组保持原序——数组的顺序有语义。 */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(source).sort()) {
      if (source[key] !== undefined) out[key] = canonical(source[key])
    }
    return out
  }
  return value
}

/**
 * 占槽：同 key 的并发请求里只有抢到的那个会去执行。
 *
 * 没带头的请求直接 `execute`，后面两步都是空操作——那才是主流路径，带头的客户端是
 * 可选优化。
 */
export async function reserve<T>(
  key: string | null,
  keyHash: string,
  fingerprint: string
): Promise<Reservation<T>> {
  if (!key) return { kind: "execute", key: "" }

  const inserted = await db
    .insert(apiRequestIdempotency)
    .values({
      keyHash,
      idempotencyKey: key,
      requestFingerprint: fingerprint,
      responseStatus: IN_FLIGHT_STATUS,
      // 预占行没有响应体，而 `jsonb NOT NULL` 要求一个值；`{}` 在"处理中"这条分支上
      // 不会被读到。
      responseBody: {},
    })
    .onConflictDoNothing({
      target: [
        apiRequestIdempotency.keyHash,
        apiRequestIdempotency.idempotencyKey,
      ],
    })
    .returning({ key: apiRequestIdempotency.idempotencyKey })

  if (inserted.length > 0) return { kind: "execute", key }

  // 没抢到：读现有那行，分辨它是"已完成"、"处理中"还是"同 key 不同参数"。
  const existing = await findRecord(keyHash, key)
  if (!existing || isExpired(existing.createdAt)) {
    // 读不到行（被别人清掉了）或已过期，都按"这是一次新请求"处理。这两个分支不加
    // 递归重试：24 小时后同一个 key 再次使用本来就是允许的。
    return { kind: "execute", key }
  }
  if (existing.requestFingerprint !== fingerprint) {
    return { kind: "conflict", key }
  }
  if (existing.responseStatus === IN_FLIGHT_STATUS) {
    return { kind: "in_flight", key }
  }
  return {
    kind: "replay",
    key,
    status: existing.responseStatus,
    body: existing.responseBody as T,
  }
}

/**
 * 把预占行升级成一条可回放的记录。
 *
 * `created_at` 顺手刷新：它是过期判断的基准，而一个跑了很久才完成的请求不该从"开始
 * 的时间"算 24 小时。
 */
export async function rememberResponse<T>(
  key: string,
  keyHash: string,
  status: number,
  body: T
): Promise<void> {
  if (!key) return
  await db
    .update(apiRequestIdempotency)
    .set({
      responseStatus: status,
      responseBody: body as unknown as Record<string, unknown>,
      createdAt: new Date(),
    })
    .where(
      and(
        eq(apiRequestIdempotency.keyHash, keyHash),
        eq(apiRequestIdempotency.idempotencyKey, key)
      )
    )
}

/**
 * 失败时删掉预占行，让客户端能用同一个 key 重试。
 *
 * 4xx 也删：一次失败不是"这个请求的答案"，而是"这个请求没成"。留着它会让客户端永远
 * 拿不到成功——它会一直被回放成第一次那个失败。`POST /repos` 里 GitHub 返回 404 那种
 * 情况更明显：那是仓库不存在，不是"这个 key 永远不能登记它"。
 *
 * 只删 `response_status = 0` 的行：万一有并发请求已经把这条记录升级成已完成的了，
 * 删掉它就抹掉了一个已经对外成功过的答案。
 */
export async function releaseSlot(
  key: string,
  keyHash: string
): Promise<void> {
  if (!key) return
  await db
    .delete(apiRequestIdempotency)
    .where(
      and(
        eq(apiRequestIdempotency.keyHash, keyHash),
        eq(apiRequestIdempotency.idempotencyKey, key),
        eq(apiRequestIdempotency.responseStatus, IN_FLIGHT_STATUS)
      )
    )
}

/**
 * 过期清理。cron 里跑。
 *
 * 不清理也不会让功能出错——`reserve` 会把过期行当作不存在——只是这张表会一直长。
 * 它的增长速度由客户端的重试频率决定，不受任何配额约束。
 */
export async function purgeExpiredIdempotencyRecords(
  now: Date = new Date()
): Promise<number> {
  const cutoff = new Date(now.getTime() - IDEMPOTENCY_TTL_HOURS * 60 * 60 * 1000)
  // 预占行不删：它可能正属于一个正在执行的请求，而删掉它会让那个请求的
  // `rememberResponse` 静默落空，那一次调用就会永远处于"处理中"。
  const rows = await db
    .delete(apiRequestIdempotency)
    .where(
      and(
        lt(apiRequestIdempotency.createdAt, cutoff),
        sql`${apiRequestIdempotency.responseStatus} <> ${IN_FLIGHT_STATUS}`
      )
    )
    .returning({ key: apiRequestIdempotency.idempotencyKey })
  return rows.length
}

async function findRecord(keyHash: string, key: string) {
  const [row] = await db
    .select()
    .from(apiRequestIdempotency)
    .where(
      and(
        eq(apiRequestIdempotency.keyHash, keyHash),
        eq(apiRequestIdempotency.idempotencyKey, key)
      )
    )
    .limit(1)
  return row
}

function isExpired(createdAt: Date): boolean {
  return createdAt.getTime() < Date.now() - IDEMPOTENCY_TTL_HOURS * 60 * 60 * 1000
}