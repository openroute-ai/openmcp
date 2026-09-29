import { eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { providersDataAccess } from "./index"

export async function getAuthorForUser(userId: string): Promise<{ authorId: string | null; username: string | null }> {
  const profile = await providersDataAccess.getMyProfile(userId)
  if (!profile?.authorId) return { authorId: null, username: null }
  const { authors } = await import('@workspace/db')
  const [author] = await db
    .select({ id: authors.id, username: authors.username })
    .from(authors)
    .where(eq(authors.id, profile.authorId))
    .limit(1)
  return { authorId: author?.id ?? null, username: author?.username ?? null }
}

export async function requireAuthorForUser(userId: string): Promise<{ authorId: string; username: string }> {
  const result = await getAuthorForUser(userId)
  if (!result.authorId || !result.username) {
    throw new Error('请先完成入驻再发布')
  }
  return { authorId: result.authorId, username: result.username }
}

export type PublishAuthOptions = {
  /** 付费资产要求收款通道 ready */
  requirePayChannel?: boolean
}

/**
 * 发布/注册资产前强制：已存在作者身份 + 实名 verified；
 * 付费资产额外要求 payChannelStatus === ready。
 */
export async function requireVerifiedProviderForPublish(
  userId: string,
  options: PublishAuthOptions = {}
): Promise<{ authorId: string; username: string }> {
  const profile = await providersDataAccess.getMyProfile(userId)

  if (!profile) {
    throw new Error('请先完成提供者入驻与实名认证')
  }

  if (profile.verificationStatus === 'pending') {
    throw new Error('实名认证审核中，请等待审核通过后再提交')
  }
  if (profile.verificationStatus === 'rejected') {
    throw new Error('实名认证未通过，请重新提交认证资料后再发布')
  }
  if (profile.verificationStatus !== 'verified') {
    throw new Error('请先完成实名认证后再发布资产')
  }

  if (options.requirePayChannel && profile.payChannelStatus !== 'ready') {
    throw new Error('发布付费资产前请先绑定微信 / 支付宝收款账户')
  }

  const result = await getAuthorForUser(userId)
  if (!result.authorId || !result.username) {
    throw new Error('请先完成入驻再发布')
  }
  return { authorId: result.authorId, username: result.username }
}
