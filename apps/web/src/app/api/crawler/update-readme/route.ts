import { and, eq, isNull, or, sql } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { workflows } from '@workspace/db'

export const dynamic = 'force-dynamic'

/**
 * 获取 readme 为空的工作流列表
 * GET /api/crawler/update-readme?limit=10
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
    const { searchParams } = new URL(request.url)
    const limitParam = searchParams.get('limit')
    const limit = limitParam ? parseInt(limitParam, 10) : 10

    if (isNaN(limit) || limit <= 0 || limit > 100) {
      return NextResponse.json(
        {
          success: false,
          error: 'limit 参数无效，必须是 1-100 之间的数字',
          timestamp: new Date().toISOString(),
        },
        { status: 400 }
      )
    }

    // 查询 readme 或 readmeEn 为空的工作流
    // 按创建时间升序排序（最早创建的优先）
    const workflowsWithoutReadme = await db
      .select({
        id: workflows.id,
        referenceId: workflows.referenceId,
        slug: workflows.slug,
        title: workflows.title,
        readme: workflows.readme,
        readmeEn: workflows.readmeEn,
        createdAt: workflows.createdAt,
      })
      .from(workflows)
      .where(
        and(
          // eq(workflows.status, 'published'), // 只查询已发布的工作流
          or(isNull(workflows.readme), isNull(workflows.readmeEn))!
        )
      )
      .orderBy(workflows.createdAt) // 按创建时间升序
      .limit(limit)

    // 查询总数
    const [totalResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(workflows)
      .where(
        and(
          // eq(workflows.status, 'published'),
          or(isNull(workflows.readme), isNull(workflows.readmeEn))!
        )
      )

    const total = Number(totalResult?.count || 0)
    const hasMore = total > limit

    return NextResponse.json({
      success: true,
      data: workflowsWithoutReadme,
      total,
      hasMore,
      limit,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error('获取待抓取工作流列表失败:', errorMessage)

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

/**
 * 更新工作流 README API
 *
 * GET: 获取 readme 为空的工作流列表
 * POST: 更新指定工作流的 README 内容（英文和中文）
 *
 * 环境变量:
 * CRAWLER_API_TOKEN - 访问令牌（可选，如果未配置则不验证）
 *
 * GET 请求:
 * GET /api/crawler/update-readme?limit=10
 *
 * POST 请求体格式:
 * {
 *   referenceId: string  // 工作流的 referenceId（必填）
 *   readme?: string       // 中文 README（可选）
 *   readmeEn?: string     // 英文 README（可选）
 * }
 *
 * 或者使用 slug:
 * {
 *   slug: string         // 工作流的 slug（必填，与 referenceId 二选一）
 *   readme?: string      // 中文 README（可选）
 *   readmeEn?: string     // 英文 README（可选）
 * }
 *
 * 使用示例:
 * GET /api/crawler/update-readme?limit=10
 * POST /api/crawler/update-readme
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
        readme: z.string().optional(),
        readmeEn: z.string().optional(),
      })
      .refine((data) => data.referenceId || data.slug, {
        message: '必须提供 referenceId 或 slug 之一',
      })

    const validatedData = schema.parse(body)
    const { referenceId, slug, readme, readmeEn } = validatedData

    // 查找工作流
    let workflow
    if (referenceId) {
      const [found] = await db.select().from(workflows).where(eq(workflows.referenceId, referenceId)).limit(1)
      workflow = found
    } else if (slug) {
      const [found] = await db.select().from(workflows).where(eq(workflows.slug, slug)).limit(1)
      workflow = found
    }

    if (!workflow) {
      return NextResponse.json(
        {
          success: false,
          error: '工作流未找到',
          timestamp: new Date().toISOString(),
        },
        { status: 404 }
      )
    }

    // 如果工作流已被平台认证，跳过更新
    if (workflow.certified) {
      return NextResponse.json({
        success: true,
        data: {
          workflowId: workflow.id,
          referenceId: workflow.referenceId,
          slug: workflow.slug,
          message: '工作流已认证，跳过更新',
        },
        timestamp: new Date().toISOString(),
      })
    }

    // 构建更新数据
    const updateData: {
      readme?: string | null
      readmeEn?: string | null
      updatedAt: Date
    } = {
      updatedAt: new Date(),
    }

    // 只更新提供的字段
    if (readme !== undefined) {
      updateData.readme = readme || null
    }
    if (readmeEn !== undefined) {
      updateData.readmeEn = readmeEn || null
    }

    // 更新工作流
    const [updatedWorkflow] = await db
      .update(workflows)
      .set(updateData)
      .where(eq(workflows.id, workflow.id))
      .returning()

    if (!updatedWorkflow) {
      return NextResponse.json(
        { success: false, error: '工作流不存在', timestamp: new Date().toISOString() },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      data: {
        workflowId: updatedWorkflow.id,
        referenceId: updatedWorkflow.referenceId,
        slug: updatedWorkflow.slug,
        readme: updatedWorkflow.readme ? `${updatedWorkflow.readme.length} 字符` : null,
        readmeEn: updatedWorkflow.readmeEn ? `${updatedWorkflow.readmeEn.length} 字符` : null,
      },
      message: 'README 更新成功',
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error('更新 README 失败:', errorMessage)

    // 如果是验证错误，返回 400
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          error: '请求数据格式错误',
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
