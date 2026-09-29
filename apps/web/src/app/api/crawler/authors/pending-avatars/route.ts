import { and, isNotNull, isNull } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { authors } from '@workspace/db'

export const dynamic = 'force-dynamic'

/**
 * 获取待下载头像的作者列表 API
 *
 * 返回所有 avatar 为空但 avatarUrl 不为空的作者列表
 * 这些作者的头像需要批量下载
 *
 * 环境变量:
 * CRAWLER_API_TOKEN - 访问令牌（可选，如果未配置则不验证）
 *
 * 使用示例:
 * GET /api/crawler/authors/pending-avatars
 * Authorization: Bearer YOUR_TOKEN
 */
export async function GET(request: Request) {
  // 验证访问令牌（如果配置了）
  const authHeader = request.headers.get('authorization')
  const crawlerToken = process.env.CRAWLER_API_TOKEN

  if (crawlerToken) {
    if (authHeader !== `Bearer ${crawlerToken}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  try {
    // 查询所有 avatar 为空但 avatarUrl 不为空的作者
    const pendingAuthors = await db
      .select({
        id: authors.id,
        username: authors.username,
        avatarUrl: authors.avatarUrl,
      })
      .from(authors)
      .where(
        and(
          isNull(authors.avatar), // avatar 为空
          isNotNull(authors.avatarUrl) // avatarUrl 不为空
        )
      )

    return NextResponse.json({
      success: true,
      data: pendingAuthors,
      count: pendingAuthors.length,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error('获取待下载头像作者列表失败:', errorMessage)

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
