import { eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { authors } from '@workspace/db'

export const dynamic = 'force-dynamic'

/**
 * 更新作者头像 API
 *
 * 用于批量下载头像后，更新作者的 avatar 字段（OSS地址）
 *
 * 环境变量:
 * CRAWLER_API_TOKEN - 访问令牌（可选，如果未配置则不验证）
 *
 * 请求体格式:
 * {
 *   authorId: string  // 作者ID（必填）
 *   avatar: string   // OSS地址（必填）
 * }
 *
 * 使用示例:
 * POST /api/crawler/authors/update-avatar
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
      authorId: z.string().min(1, 'authorId 不能为空'),
      avatar: z.string().min(1, 'avatar 不能为空'),
    })

    const validatedData = schema.parse(body)
    const { authorId, avatar } = validatedData

    // 查找作者
    const [author] = await db
      .select({ id: authors.id, username: authors.username })
      .from(authors)
      .where(eq(authors.id, authorId))
      .limit(1)

    if (!author) {
      return NextResponse.json(
        {
          success: false,
          error: '作者未找到',
          timestamp: new Date().toISOString(),
        },
        { status: 404 }
      )
    }

    // 更新头像
    const [updatedAuthor] = await db
      .update(authors)
      .set({
        avatar,
        updatedAt: new Date(),
      })
      .where(eq(authors.id, authorId))
      .returning()

    return NextResponse.json({
      success: true,
      data: {
        author: updatedAuthor,
      },
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error('更新作者头像失败:', errorMessage)

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
