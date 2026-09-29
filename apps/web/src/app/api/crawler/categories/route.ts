import { NextResponse } from 'next/server'
import { categoriesDataAccess } from '@/web/categories/index'

export const dynamic = 'force-dynamic'

/**
 * 爬虫分类列表 API
 *
 * 返回所有可抓取的分类（激活状态的分类）
 *
 * 环境变量:
 * CRAWLER_API_TOKEN - 访问令牌（可选，如果未配置则不验证）
 *
 * 使用示例:
 * GET /api/crawler/categories
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
    // 获取所有激活的分类
    const categories = await categoriesDataAccess.getAllCategories()

    // 只返回可抓取的分类信息（简化字段）
    const crawlerCategories = categories.map((category) => ({
      id: category.id,
      referenceId: category.referenceId,
      name: category.name,
      nameEn: category.nameEn,
      slug: category.slug,
      description: category.description,
      descriptionEn: category.descriptionEn,
      icon: category.icon,
      order: category.order,
      workflowCount: category.workflowCount,
    }))

    return NextResponse.json({
      success: true,
      data: crawlerCategories,
      count: crawlerCategories.length,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error('获取分类列表失败:', errorMessage)

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
