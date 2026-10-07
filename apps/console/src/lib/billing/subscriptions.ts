/**
 * 读"这个账号现在有没有生效的订阅"。
 *
 * 落地页、控制台徽标（`billing.getMySubscription`）和权限闸都用它，所以"有没有生效"
 * 只有一个定义：过期即不存在——`activeUntil` 已经是全部语义，这里不返回过期行，
 * 调用方不必记得再比较一次时间。
 *
 * 连接默认是全局的 `db`，也可以传 `ctx.db`——tRPC 里的查询应当走会话级连接，
 * 与同一个 procedure 里别的查询保持一致（测试也能注入假的连接）。
 */
import { and, eq, gt } from "drizzle-orm"
import { db } from "@/db/client"
import { userSubscriptions } from "@/db/schema/billing"

export async function getActiveSubscription(
  userId: string,
  connection: typeof db = db
) {
  const [row] = await connection
    .select({
      plan: userSubscriptions.plan,
      activeUntil: userSubscriptions.activeUntil,
    })
    .from(userSubscriptions)
    .where(
      and(
        eq(userSubscriptions.userId, userId),
        gt(userSubscriptions.activeUntil, new Date())
      )
    )
    .limit(1)

  return row ?? null
}
