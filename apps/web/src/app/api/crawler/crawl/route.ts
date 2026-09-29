import { NextResponse } from 'next/server'
import { z } from 'zod'
import { categoriesDataAccess } from '@/web/categories/index'

export const dynamic = 'force-dynamic'

/**
 * 爬虫触发 API
 *
 * 支持指定分类和页数进行爬取
 *
 * 注意：此 API 需要 crawlee-api 项目支持。由于 crawlee-api 是独立项目，
 * 建议通过以下方式使用：
 * 1. 在 crawlee-api 项目中直接调用 WorkflowCrawler.crawlCategoryPage() 方法
 * 2. 或者将 crawlee-api 作为 HTTP 服务运行，通过 HTTP 调用
 *
 * 环境变量:
 * CRAWLER_API_TOKEN - 访问令牌（可选，如果未配置则不验证）
 *
 * 请求参数:
 * - categorySlug: 分类 slug（必填）
 * - page: 页码，从1开始（可选，默认1）
 * - limit: 每页数量（可选，默认10）
 *
 * 使用示例:
 * POST /api/crawler/crawl?categorySlug=ai&page=1&limit=10
 * Authorization: Bearer YOUR_TOKEN
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
    // 解析查询参数
    const { searchParams } = new URL(request.url)
    const categorySlug = searchParams.get('categorySlug')
    const pageParam = searchParams.get('page')
    const limitParam = searchParams.get('limit')

    // 验证参数
    const schema = z.object({
      categorySlug: z.string().min(1, '分类 slug 不能为空'),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(50).default(10),
    })

    const validatedParams = schema.parse({
      categorySlug,
      page: pageParam,
      limit: limitParam,
    })

    const { categorySlug: slug, page, limit } = validatedParams

    // 验证分类是否存在
    const categories = await categoriesDataAccess.getAllCategories()
    const category = categories.find((c) => c.slug === slug)

    if (!category) {
      return NextResponse.json(
        {
          success: false,
          error: `分类未找到: ${slug}`,
          timestamp: new Date().toISOString(),
        },
        { status: 404 }
      )
    }

    // 返回使用说明和参数验证结果
    return NextResponse.json(
      {
        success: true,
        message: '参数验证成功。请使用 crawlee-api 项目的 WorkflowCrawler.crawlCategoryPage() 方法执行爬取。',
        params: {
          categorySlug: slug,
          categoryName: category.name,
          categoryId: category.id,
          page,
          limit,
        },
        usage: {
          description: '在 crawlee-api 项目中使用以下代码：',
          code: `
import { workflowCrawler } from './crawlers/workflow-crawler.js'

// 执行爬取
const result = await workflowCrawler.crawlCategoryPage(
  '${slug}',  // categorySlug
  ${page},    // page
  ${limit}    // limit
)

console.log('爬取结果:', result)
          `.trim(),
        },
        timestamp: new Date().toISOString(),
      },
      { status: 200 }
    )
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)

    // 如果是验证错误，返回 400
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          error: '请求参数格式错误',
          details: error.issues,
          timestamp: new Date().toISOString(),
        },
        { status: 400 }
      )
    }

    console.error('爬虫触发失败:', errorMessage)

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

// 也支持 GET 方法
export async function GET(request: Request) {
  return POST(request)
}
