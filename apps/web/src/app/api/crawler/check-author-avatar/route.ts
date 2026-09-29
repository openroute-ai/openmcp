import { eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { authors } from '@workspace/db'

export const dynamic = 'force-dynamic'

/**
 * 检查作者头像是否已存在 API
 *
 * 用于检查指定作者是否已经有头像URL（避免重复下载）
 *
 * 环境变量:
 * CRAWLER_API_TOKEN - 访问令牌（可选，如果未配置则不验证）
 *
 * 请求体格式:
 * {
 *   username: string  // 作者的 username（必填）
 * }
 *
 * 使用示例:
 * POST /api/crawler/check-author-avatar
 * Authorization: Bearer YOUR_TOKEN
 * Content-Type: application/json
 */
export async function POST(request: Request) {
  // 验证访问令牌（如果配置了）
  const authHeader = request.headers.get('authorization')
  const crawlerToken = process.env.CRAWLER_API_TOKEN

  if (crawlerToken) {
    if (authHeader !== `Bearer ${crawlerToken}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  try {
    const body = await request.json()

    // 验证请求体格式
    const schema = z.object({
      username: z.string().min(1, 'username 不能为空'),
    })

    const validatedData = schema.parse(body)
    const { username } = validatedData

    // 查找作者
    const [author] = await db
      .select({
        id: authors.id,
        username: authors.username,
        avatar: authors.avatar,
      })
      .from(authors)
      .where(eq(authors.username, username))
      .limit(1)

    // 如果作者存在且有头像URL，返回true
    const hasAvatar = !!(author && author.avatar && author.avatar.trim() !== '')

    return NextResponse.json({
      success: true,
      data: {
        exists: !!author,
        hasAvatar,
        avatar: author?.avatar || null,
        author: author
          ? {
              id: author.id,
              username: author.username,
            }
          : null,
      },
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error('检查作者头像失败:', errorMessage)

    // 如果是验证错误，返回 400
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          error: '请求参数验证失败',
          details: error.issues,
          timestamp: new Date().toISOString(),
        },
        { status: 400 }
      )
    }

    return NextResponse.json(
      {
        success: false,
        error: errorMessage,
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    )
  }
}
