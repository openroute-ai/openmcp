import { eq, inArray } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { authors, categories, workflowCategories, workflowNodes, workflows } from '@workspace/db'

export const dynamic = 'force-dynamic'

/**
 * 爬虫数据保存 API
 *
 * 保存从 n8nworkflows.xyz 抓取的工作流数据
 * 包括作者信息和工作流信息
 *
 * 环境变量:
 * CRAWLER_API_TOKEN - 访问令牌（可选，如果未配置则不验证）
 *
 * 请求体格式:
 * {
 *   author: {
 *     name: string
 *     username: string
 *     avatar?: string
 *     verified?: boolean
 *   },
 *   workflow: {
 *     referenceId: string
 *     slug: string
 *     title: string
 *     description?: string
 *     descriptionEn?: string
 *     summary?: string
 *     metaDescription?: string
 *     imageUrl?: string
 *     workflowUrl?: string
 *     workflowJson?: any
 *     readme?: string
 *     priceType: 'free' | 'paid'
 *     priceAmount?: string
 *     complexity?: 'beginner' | 'intermediate' | 'advanced'
 *     categorySlugs?: string[]  // 分类的 slug 数组
 *     metadata?: any
 *   }
 * }
 *
 * 使用示例:
 * POST /api/crawler/save
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
      author: z.object({
        name: z.string().min(1),
        username: z.string().min(1),
        avatar: z.string().optional(), // OSS地址（如果已下载）
        avatarUrl: z.string().optional(), // 源头地址（待批量下载）
        verified: z.boolean().optional().default(false),
        description: z.string().optional(),
        bio: z.string().optional(),
        website: z.string().optional(),
        twitter: z.string().optional(),
        linkedin: z.string().optional(),
        github: z.string().optional(),
      }),
      workflow: z.object({
        referenceId: z.string().min(1),
        slug: z.string().min(1),
        title: z.string().min(1),
        titleEn: z.string().optional(),
        description: z.string().optional(),
        descriptionEn: z.string().optional(),
        summary: z.string().optional(),
        metaDescription: z.string().optional(),
        imageUrl: z.string().optional(),
        workflowUrl: z.string().optional(),
        workflowJson: z.any().optional(),
        readme: z.string().optional(),
        readmeEn: z.string().optional(),
        priceType: z.enum(['free', 'paid']),
        priceAmount: z.string().optional(),
        complexity: z.enum(['beginner', 'intermediate', 'advanced']).optional(),
        categorySlugs: z.array(z.string()).optional(),
        metadata: z.any().optional(),
      }),
    })

    const validatedData = schema.parse(body)
    const { author: authorData, workflow: workflowData } = validatedData

    // 使用事务保存数据
    const result = await db.transaction(async (tx) => {
      // 1. 保存或更新作者
      const [existingAuthor] = await tx.select().from(authors).where(eq(authors.username, authorData.username)).limit(1)

      let authorId: string

      if (existingAuthor) {
        // 更新作者
        const [updatedAuthor] = await tx
          .update(authors)
          .set({
            name: authorData.name,
            avatar: authorData.avatar || existingAuthor.avatar, // 如果提供了OSS地址，使用它；否则保持原有
            avatarUrl: authorData.avatarUrl || existingAuthor.avatarUrl, // 保存源头地址
            verified: authorData.verified ?? existingAuthor.verified,
            description: authorData.description || existingAuthor.description,
            bio: authorData.bio || existingAuthor.bio,
            website: authorData.website || existingAuthor.website,
            twitter: authorData.twitter || existingAuthor.twitter,
            linkedin: authorData.linkedin || existingAuthor.linkedin,
            github: authorData.github || existingAuthor.github,
            updatedAt: new Date(),
          })
          .where(eq(authors.id, existingAuthor.id))
          .returning()

        if (!updatedAuthor) throw new Error('Failed to update author')
        authorId = updatedAuthor.id
      } else {
        // 创建新作者
        const [newAuthor] = await tx
          .insert(authors)
          .values({
            name: authorData.name,
            username: authorData.username,
            avatar: authorData.avatar || null, // OSS地址（如果已下载）
            avatarUrl: authorData.avatarUrl || null, // 源头地址（待批量下载）
            verified: authorData.verified || false,
            description: authorData.description || null,
            bio: authorData.bio || null,
            website: authorData.website || null,
            twitter: authorData.twitter || null,
            linkedin: authorData.linkedin || null,
            github: authorData.github || null,
            status: 'active',
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .returning()

        if (!newAuthor) throw new Error('Failed to create author')
        authorId = newAuthor.id
      }

      // 2. 获取分类 ID（通过 slug）
      let categoryIds: string[] = []
      if (workflowData.categorySlugs && workflowData.categorySlugs.length > 0) {
        const categoryList = await tx
          .select({ id: categories.id })
          .from(categories)
          .where(inArray(categories.slug, workflowData.categorySlugs))

        categoryIds = categoryList.map((c) => c.id)
      }

      // 3. 检查工作流是否已存在（通过 referenceId）
      const [existingWorkflow] = await tx
        .select()
        .from(workflows)
        .where(eq(workflows.referenceId, workflowData.referenceId))
        .limit(1)

      let workflowId: string

      if (existingWorkflow) {
        // 如果工作流已被平台认证，跳过更新操作
        if (existingWorkflow.certified) {
          workflowId = existingWorkflow.id
          // 跳过更新，直接返回现有数据
        } else {
          // 更新工作流（保留本地统计数据）
          const [updatedWorkflow] = await tx
            .update(workflows)
            .set({
              slug: workflowData.slug,
              title: workflowData.title,
              titleEn: workflowData.titleEn || null,
              description: workflowData.description || null,
              descriptionEn: workflowData.descriptionEn || null,
              summary: workflowData.summary || null,
              metaDescription: workflowData.metaDescription || null,
              imageUrl: workflowData.imageUrl || null,
              workflowUrl: workflowData.workflowUrl || null,
              workflowJson: workflowData.workflowJson || null,
              readme: workflowData.readme || null,
              readmeEn: workflowData.readmeEn || null,
              priceType: workflowData.priceType,
              priceAmount: workflowData.priceAmount || null,
              complexity: workflowData.complexity || null,
              metadata: workflowData.metadata || null,
              updatedAt: new Date(),
              // 不更新统计数据（views, downloads, likes等）
            })
            .where(eq(workflows.id, existingWorkflow.id))
            .returning()

          if (!updatedWorkflow) throw new Error('Failed to update workflow')
          workflowId = updatedWorkflow.id

          // 更新分类关联
          if (categoryIds.length > 0) {
            // 删除现有关联
            await tx.delete(workflowCategories).where(eq(workflowCategories.workflowId, workflowId))

            // 创建新关联
            await tx.insert(workflowCategories).values(
              categoryIds.map((categoryId) => ({
                workflowId,
                categoryId,
                createdAt: new Date(),
              }))
            )
          }

          // 更新节点类型（如果提供了 workflowJson）
          if (workflowData.workflowJson && typeof workflowData.workflowJson === 'object') {
            // 删除现有节点
            await tx.delete(workflowNodes).where(eq(workflowNodes.workflowId, workflowId))

            // 插入新节点
            const nodes = (workflowData.workflowJson as any).nodes || []
            if (nodes.length > 0) {
              // 使用 Map 去重：key 为 nodeType（不考虑名称）
              const nodeMap = new Map<
                string,
                {
                  workflowId: string
                  nodeType: string
                  nodeName: string | null
                  nodeNameEn: null
                  createdAt: Date
                }
              >()

              for (const node of nodes) {
                const nodeType = node.type || ''
                const nodeName = node.name || null
                const key = `${nodeType}`

                // 如果不存在则添加
                if (!nodeMap.has(key)) {
                  nodeMap.set(key, {
                    workflowId,
                    nodeType,
                    nodeName,
                    nodeNameEn: null,
                    createdAt: new Date(),
                  })
                }
              }

              const nodeTypes = Array.from(nodeMap.values())
              if (nodeTypes.length > 0) {
                await tx.insert(workflowNodes).values(nodeTypes)
              }
            }
          }
        }
      } else {
        // 创建新工作流
        const [newWorkflow] = await tx
          .insert(workflows)
          .values({
            referenceId: workflowData.referenceId,
            slug: workflowData.slug,
            title: workflowData.title,
            titleEn: workflowData.titleEn || null,
            description: workflowData.description || null,
            descriptionEn: workflowData.descriptionEn || null,
            summary: workflowData.summary || null,
            metaDescription: workflowData.metaDescription || null,
            authorId,
            imageUrl: workflowData.imageUrl || null,
            workflowUrl: workflowData.workflowUrl || null,
            workflowJson: workflowData.workflowJson || null,
            readme: workflowData.readme || null,
            readmeEn: workflowData.readmeEn || null,
            priceType: workflowData.priceType,
            priceAmount: workflowData.priceAmount || null,
            currency: 'USD',
            complexity: workflowData.complexity || null,
            status: 'published',
            publishedAt: new Date(),
            metadata: workflowData.metadata || null,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .returning()

        if (!newWorkflow) throw new Error('Failed to create workflow')
        workflowId = newWorkflow.id

        // 创建分类关联
        if (categoryIds.length > 0) {
          await tx.insert(workflowCategories).values(
            categoryIds.map((categoryId) => ({
              workflowId,
              categoryId,
              createdAt: new Date(),
            }))
          )
        }

        // 提取并保存节点类型
        if (workflowData.workflowJson && typeof workflowData.workflowJson === 'object') {
          const nodes = (workflowData.workflowJson as any).nodes || []
          if (nodes.length > 0) {
            // 使用 Map 去重：key 为 nodeType（不考虑名称）
            const nodeMap = new Map<
              string,
              {
                workflowId: string
                nodeType: string
                nodeName: string | null
                nodeNameEn: null
                createdAt: Date
              }
            >()

            for (const node of nodes) {
              const nodeType = node.type || ''
              const nodeName = node.name || null
              const key = `${nodeType}`

              // 如果不存在则添加
              if (!nodeMap.has(key)) {
                nodeMap.set(key, {
                  workflowId,
                  nodeType,
                  nodeName,
                  nodeNameEn: null,
                  createdAt: new Date(),
                })
              }
            }

            const nodeTypes = Array.from(nodeMap.values())
            if (nodeTypes.length > 0) {
              await tx.insert(workflowNodes).values(nodeTypes)
            }
          }
        }
      }

      const isSkipped = existingWorkflow?.certified ?? false

      return {
        authorId,
        workflowId,
        isNewAuthor: !existingAuthor,
        isNewWorkflow: !existingWorkflow,
        isSkipped,
      }
    })

    let message = '工作流已创建'
    if (!result.isNewWorkflow) {
      message = result.isSkipped ? '工作流已认证，跳过更新' : '工作流已更新'
    }

    return NextResponse.json({
      success: true,
      data: result,
      message,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error('保存爬虫数据失败:', errorMessage)

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
