/**
 * 接入方配对码的 console 侧入口（设计文档 §2.11）。
 *
 * 只做三件事：建码、列我建的码、作废一个码。**兑换不在这里** —— 那是
 * `POST /api/v1/connections/redeem`，唯一无凭据的端点，本 router 完全不参与。
 *
 * 三条边界都在服务层（`lib/api/connection-pairing.ts`）：scope 只能是自助子集、
 * `returnUrl` 必须是绝对地址、归属检查是 SQL 里的 `user_id = ctx.session.user.id`。
 * 页面是最容易忘记检查的地方，所以这里没有一处权限判断。
 */
import { TRPCError } from "@trpc/server"
import { z } from "zod"
import {
  createPairing,
  listPairings,
  revokePairing,
} from "@/lib/api/connection-pairing"
import { SELF_SERVICE_SCOPES, type ApiScope } from "@/lib/api/scopes"
import { createTRPCRouter, protectedProcedure } from "../init"

/**
 * 配对码只能选自助子集。
 *
 * 用 `SELF_SERVICE_SCOPES` 而不是写一份：设计文档说配对得到的是一把 `user` tier 的
 * key，而自助签发给 `user` tier 的是这三个 scope。两份清单各写一遍，那它们就会在某次
 * 改动里分叉，而分叉之后配对码会发出一把自助流程永远不会发出去的 key。
 */
const pairingScopes = z
  .array(z.enum(SELF_SERVICE_SCOPES))
  .min(1)
  .max(SELF_SERVICE_SCOPES.length)

/**
 * 服务层的失败码 → tRPC 的 code。
 *
 * 分档的依据是"用户该做什么"：`invalid_return_url` 与 `too_many_open_codes` 改一下
 * 输入或清一下现场就能重试（`BAD_REQUEST`），邮箱未验证与存量上限要用户去别处处理
 * （`FORBIDDEN`），而 `generation_failed` 是我们自己的故障——报成前两者只会让用户
 * 去改一个本来就没问题的参数，所以它留在 500 这一侧。
 */
const CREATE_FAILURE_CODE = {
  invalid_return_url: "BAD_REQUEST",
  too_many_open_codes: "BAD_REQUEST",
  generation_failed: "INTERNAL_SERVER_ERROR",
  email_unverified: "FORBIDDEN",
  scope_not_allowed: "FORBIDDEN",
  quota_exceeded: "FORBIDDEN",
} as const

export const connectionsRouter = createTRPCRouter({
  /**
   * 我建了哪些还没被兑换、也还没过期的码。
   *
   * 已兑换的不列：它们已经产生过一把 key，而 key 本身在 `/console/api-keys` 里可见，
   * 所以列出来只会让人以为"还能用"。
   */
  listMine: protectedProcedure.query(async ({ ctx }) => {
    return listPairings(ctx.session.user.id)
  }),

  /**
   * 建一个配对码。
   *
   * 返回体里就是那个码，明文不落任何日志（§2.13）——它在 `connection_pairings` 里是
   * 明文列，但那是**给兑换方比对用的存储**，不是审计；审计那行只记 `key.create`。
   */
  create: protectedProcedure
    .input(
      z.object({
        name: z.string().trim().min(1).max(120),
        scopes: pairingScopes,
        /**
         * 兑换方必须原样回传的地址。
         *
         * 校验在服务层，而这里的 `.url()` 只是让明显不是地址的东西早点被拒；真正的
         * 等值比较在兑换时做。
         */
        returnUrl: z.string().url().max(2048),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await createPairing({
        userId: ctx.session.user.id,
        name: input.name,
        scopes: input.scopes as ApiScope[],
        returnUrl: input.returnUrl,
        ip: clientIpFromHeaders(ctx.headers),
        // 配对是发 key 的第二条路，所以 §2.10 的邮箱验证门槛在这里同样适用——
        // 服务端不查这一项，一个未验证的小号就能绕过自助签发拿到一把能用的 key。
        emailVerified: ctx.session.user.emailVerified,
      })

      if (!result.ok) {
        throw new TRPCError({
          code: CREATE_FAILURE_CODE[result.code],
          message: result.message,
        })
      }

      return {
        code: result.code,
        expiresAt: result.expiresAt,
        scopes: result.scopes,
        returnUrl: input.returnUrl,
      }
    }),

  /**
   * 作废一个还没被兑换的码。
   *
   * 删行而不是标记：码的价值全在"还没用过"，而过期清理也要删，保留一个"已作废"状态
   * 只会让页面多一种徽章。已经被兑换的返回 false —— 那把 key 已经存在了，撤销配对码
   * 不会撤销它，要撤销就去 `/console/api-keys` 吊销那把 key。
   */
  revoke: protectedProcedure
    .input(z.object({ code: z.string().trim().min(1).max(32) }))
    .mutation(async ({ ctx, input }) => {
      return revokePairing(ctx.session.user.id, input.code)
    }),
})

/** 倒序优先：`X-Forwarded-For` 的第一段是最原始的发起方。 */
function clientIpFromHeaders(headers: Headers | undefined): string | null {
  if (!headers) return null
  const forwarded = headers.get("x-forwarded-for")
  const first = forwarded?.split(",")[0]?.trim()
  if (first) return first
  return headers.get("x-real-ip")?.trim() || null
}
