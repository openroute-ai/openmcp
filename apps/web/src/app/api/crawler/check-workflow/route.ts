import { eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { workflows } from '@workspace/db'

export const dynamic = 'force-dynamic'

/**
 * 检查工作流是否存在 API
 *
 * 用于检查指定工作流是否已经存在于数据库中
 *
 * 环境变量:
 * CRAWLER_API_TOKEN - 访问令牌（可选，如果未配置则不验证）
 *
 * 请求体格式:
 * {
 *   referenceId: string  // 工作流的 referenceId（必填）
 * }
 *
 * 或者使用 slug:
 * {
 *   slug: string         // 工作流的 slug（必填，与 referenceId 二选一）
 * }
 *
 * 使用示例:
 * POST /api/crawler/check-workflow
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
    const schema = z
      .object({
        referenceId: z.string().optional(),
        slug: z.string().optional(),
      })
      .refine((data) => data.referenceId || data.slug, {
        message: '必须提供 referenceId 或 slug 之一',
      })

    const validatedData = schema.parse(body)
    const { referenceId, slug } = validatedData

    // 查找工作流
    let workflow
    if (referenceId) {
      const [found] = await db
        .select({ id: workflows.id, referenceId: workflows.referenceId, slug: workflows.slug })
        .from(workflows)
        .where(eq(workflows.referenceId, referenceId))
        .limit(1)
      workflow = found
    } else if (slug) {
      const [found] = await db
        .select({ id: workflows.id, referenceId: workflows.referenceId, slug: workflows.slug })
        .from(workflows)
        .where(eq(workflows.slug, slug))
        .limit(1)
      workflow = found
    }

    return NextResponse.json({
      success: true,
      data: {
        exists: !!workflow,
        workflow: workflow
          ? {
              id: workflow.id,
              referenceId: workflow.referenceId,
              slug: workflow.slug,
            }
          : null,
      },
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error('检查工作流失败:', errorMessage)

    // 如果是验证错误，返回 400
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          error: '请求参数验证失败',
          details: error?.issues || [],
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
