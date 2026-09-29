import { and, count, desc, eq, like, ne, or, sql } from 'drizzle-orm'
import type { PgColumn } from 'drizzle-orm/pg-core'
import { db } from "@/lib/db"
import { authors, categories, mcpServers } from "@workspace/db"
import { testMcpConnection } from "@/lib/gateway/mcp-connect"
import type { AssetAuthType } from "@/lib/registry-labels"

export type McpServerListItem = {
  id: string
  referenceId: string
  slug: string
  name: string
  description: string | null
  descriptionEn: string | null
  logoUrl: string | null
  transport: 'http' | 'sse' | 'stdio'
  authType: AssetAuthType | null
  hosting: 'self_hosted' | 'platform_managed'
  scope: 'public' | 'private' | 'team'
  categoryId: string | null
  priceType: 'free' | 'paid'
  billingModel: 'one_time' | 'subscription' | 'pay_per_call' | null
  unitPrice: string | null
  currency: string
  certified: boolean
  securityLevel: string | null
  views: number
  downloads: number
  publishedAt: Date | null
  createdAt: Date
  author: { id: string; name: string; username: string; avatar: string | null; verified: boolean }
  category: { id: string; name: string; nameEn: string; slug: string } | null
}

export type RegisterMcpServerInput = {
  name: string
  description?: string | null
  descriptionEn?: string | null
  transport: 'http' | 'sse' | 'stdio'
  endpoint?: string | null
  hosting: 'self_hosted' | 'platform_managed'
  scope?: 'public' | 'private' | 'team'
  tools?: Record<string, unknown>[] | null
  categoryId?: string | null
  priceType?: 'free' | 'paid'
  priceAmount?: string | number | null
  billingModel?: 'one_time' | 'subscription' | 'pay_per_call' | null
  unitPrice?: string | number | null
  currency?: string
}

function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 200)
}

async function uniqueSlug(base: string): Promise<string> {
  let candidate = base || 'mcp-server'
  let suffix = 0
  for (;;) {
    const [existing] = await db
      .select({ slug: mcpServers.slug })
      .from(mcpServers)
      .where(eq(mcpServers.slug, candidate))
      .limit(1)
    if (!existing) return candidate
    suffix += 1
    candidate = `${base || 'mcp-server'}-${suffix}`
  }
}

export const mcpServersDataAccess = {
  getMcpServers: async (params: {
    page?: number
    limit?: number
    search?: string
    transport?: 'http' | 'sse' | 'stdio'
    scope?: 'public' | 'private' | 'team'
    sort?: 'date-desc' | 'downloads-desc' | 'views-desc'
  }): Promise<McpServerListItem[]> => {
    const { page = 1, limit = 18, search, transport, scope, sort = 'date-desc' } = params
    const whereConditions = [eq(mcpServers.status, 'published')]

    if (transport) whereConditions.push(eq(mcpServers.transport, transport))
    if (scope) whereConditions.push(eq(mcpServers.scope, scope))
    if (search) {
      whereConditions.push(
        or(
          like(mcpServers.name, `%${search}%`),
          like(mcpServers.description, `%${search}%`),
          like(mcpServers.endpoint, `%${search}%`),
          like(authors.name, `%${search}%`)
        )!
      )
    }

    const orderBy: PgColumn | ReturnType<typeof desc> =
      sort === 'downloads-desc'
        ? desc(mcpServers.downloads)
        : sort === 'views-desc'
          ? desc(mcpServers.views)
          : desc(mcpServers.publishedAt)

    const rows = await db
      .select({
        id: mcpServers.id,
        referenceId: mcpServers.referenceId,
        slug: mcpServers.slug,
        name: mcpServers.name,
        description: mcpServers.description,
        descriptionEn: mcpServers.descriptionEn,
        logoUrl: mcpServers.logoUrl,
        transport: mcpServers.transport,
        authType: mcpServers.authType,
        hosting: mcpServers.hosting,
        scope: mcpServers.scope,
        categoryId: mcpServers.categoryId,
        priceType: mcpServers.priceType,
        billingModel: mcpServers.billingModel,
        unitPrice: mcpServers.unitPrice,
        currency: mcpServers.currency,
        certified: mcpServers.certified,
        securityLevel: mcpServers.securityLevel,
        views: mcpServers.views,
        downloads: mcpServers.downloads,
        publishedAt: mcpServers.publishedAt,
        createdAt: mcpServers.createdAt,
        author: {
          id: authors.id,
          name: authors.name,
          username: authors.username,
          avatar: authors.avatar,
          verified: authors.verified,
        },
        category: {
          id: categories.id,
          name: categories.name,
          nameEn: categories.nameEn,
          slug: categories.slug,
        },
      })
      .from(mcpServers)
      .innerJoin(authors, eq(mcpServers.authorId, authors.id))
      .leftJoin(categories, eq(mcpServers.categoryId, categories.id))
      .where(and(...whereConditions))
      .orderBy(orderBy)
      .limit(limit)
      .offset((page - 1) * limit)

    return rows.map((row) => ({
      ...row,
      name: row.name,
      unitPrice: row.unitPrice?.toString() ?? null,
      currency: row.currency ?? 'CNY',
      category: row.category?.id != null ? row.category : null,
    }))
  },

  getMcpServersCount: async (params: {
    search?: string
    transport?: 'http' | 'sse' | 'stdio'
    scope?: 'public' | 'private' | 'team'
  }): Promise<number> => {
    const { search, transport, scope } = params
    const whereConditions = [eq(mcpServers.status, 'published')]

    if (transport) whereConditions.push(eq(mcpServers.transport, transport))
    if (scope) whereConditions.push(eq(mcpServers.scope, scope))
    if (search) {
      whereConditions.push(
        or(
          like(mcpServers.name, `%${search}%`),
          like(mcpServers.description, `%${search}%`),
          like(authors.name, `%${search}%`)
        )!
      )
    }

    const [row] = await db
      .select({ count: count() })
      .from(mcpServers)
      .innerJoin(authors, eq(mcpServers.authorId, authors.id))
      .where(and(...whereConditions))

    return row?.count ?? 0
  },

  getMcpServerById: async (id: string) => {
    const [row] = await db
      .select({
        id: mcpServers.id,
        referenceId: mcpServers.referenceId,
        slug: mcpServers.slug,
        name: mcpServers.name,
        description: mcpServers.description,
        descriptionEn: mcpServers.descriptionEn,
        logoUrl: mcpServers.logoUrl,
        transport: mcpServers.transport,
        authType: mcpServers.authType,
        endpoint: mcpServers.endpoint,
        serverName: mcpServers.serverName,
        hosting: mcpServers.hosting,
        scope: mcpServers.scope,
        tools: mcpServers.tools,
        categoryId: mcpServers.categoryId,
        priceType: mcpServers.priceType,
        priceAmount: mcpServers.priceAmount,
        billingModel: mcpServers.billingModel,
        unitPrice: mcpServers.unitPrice,
        currency: mcpServers.currency,
        certified: mcpServers.certified,
        securityLevel: mcpServers.securityLevel,
        views: mcpServers.views,
        downloads: mcpServers.downloads,
        publishedAt: mcpServers.publishedAt,
        createdAt: mcpServers.createdAt,
        updatedAt: mcpServers.updatedAt,
        author: {
          id: authors.id,
          name: authors.name,
          username: authors.username,
          avatar: authors.avatar,
          verified: authors.verified,
        },
        category: {
          id: categories.id,
          name: categories.name,
          nameEn: categories.nameEn,
          slug: categories.slug,
        },
      })
      .from(mcpServers)
      .innerJoin(authors, eq(mcpServers.authorId, authors.id))
      .leftJoin(categories, eq(mcpServers.categoryId, categories.id))
      .where(eq(mcpServers.id, id))
      .limit(1)

    return row
  },

  registerMcpServer: async (authorId: string, input: RegisterMcpServerInput) => {
    // 营销提交不得跳过连接测试：HTTP/SSE 必须先测通；stdio 请走控制台 discover→test→connect→publish
    if (input.transport === 'stdio') {
      throw new Error('stdio 请前往「我的资产」完成连接测试后再提交上架')
    }
    if (!input.endpoint) {
      throw new Error('请填写端点地址并完成连接测试')
    }
    const transportUi = input.transport === 'sse' ? 'sse' : 'streamable'
    const test = await testMcpConnection({
      url: input.endpoint,
      transport: transportUi,
      auth: { type: 'none' },
    })
    if (!test.ok) {
      const failStep = test.steps?.find((s) => s.status === 'fail')
      throw new Error(failStep?.detail || '连接测试未通过，无法提交')
    }

    const refBase = slugify(input.name) || 'mcp-server'
    const slug = await uniqueSlug(refBase)
    const [inserted] = await db
      .insert(mcpServers)
      .values({
        referenceId: slug,
        slug,
        name: input.name,
        description: input.description ?? null,
        descriptionEn: input.descriptionEn ?? null,
        transport: input.transport,
        endpoint: input.endpoint ?? null,
        hosting: input.hosting,
        scope: input.scope ?? 'public',
        tools: input.tools && input.tools.length > 0 ? input.tools : (test.toolNames ?? []).map((name) => ({ name })),
        categoryId: input.categoryId ?? null,
        authorId,
        priceType: input.priceType ?? 'free',
        priceAmount: input.priceAmount != null ? String(input.priceAmount) : null,
        billingModel: input.billingModel ?? null,
        unitPrice: input.unitPrice != null ? String(input.unitPrice) : null,
        currency: input.currency ?? 'CNY',
        connectionStatus: 'online',
        lastTestedAt: new Date(),
        lastTestResult: test,
        status: 'submitted',
      })
      .returning()

    if (!inserted) {
      throw new Error('MCP Server 注册失败')
    }

    return mcpServersDataAccess.getMcpServerById(inserted.id)
  },

  getMyMcpServers: async (authorId: string) => {
    const rows = await db
      .select({
        id: mcpServers.id,
        slug: mcpServers.slug,
        name: mcpServers.name,
        transport: mcpServers.transport,
        priceType: mcpServers.priceType,
        billingModel: mcpServers.billingModel,
        status: mcpServers.status,
        views: mcpServers.views,
        downloads: mcpServers.downloads,
        createdAt: mcpServers.createdAt,
      })
      .from(mcpServers)
      .where(eq(mcpServers.authorId, authorId))
      .orderBy(desc(mcpServers.createdAt))

    return rows
  },

  incrementViews: async (id: string) => {
    await db
      .update(mcpServers)
      .set({ views: sql`${mcpServers.views} + 1`, updatedAt: new Date() })
      .where(eq(mcpServers.id, id))
  },

  /** 相关服务：优先同分类，其次按热度排序，供详情页右侧推荐使用 */
  getRelatedMcpServers: async (params: {
    id: string
    limit?: number
  }): Promise<
    {
      id: string
      slug: string
      name: string
      description: string | null
      descriptionEn: string | null
      logoUrl: string | null
      views: number
      downloads: number
      category: { slug: string } | null
    }[]
  > => {
    const { id, limit = 6 } = params

    const [current] = await db
      .select({ categoryId: mcpServers.categoryId })
      .from(mcpServers)
      .where(eq(mcpServers.id, id))
      .limit(1)

    const whereConditions = [eq(mcpServers.status, 'published'), ne(mcpServers.id, id)]
    if (current?.categoryId) {
      whereConditions.push(eq(mcpServers.categoryId, current.categoryId))
    }

    const rows = await db
      .select({
        id: mcpServers.id,
        slug: mcpServers.slug,
        name: mcpServers.name,
        description: mcpServers.description,
        descriptionEn: mcpServers.descriptionEn,
        logoUrl: mcpServers.logoUrl,
        views: mcpServers.views,
        downloads: mcpServers.downloads,
        category: {
          slug: categories.slug,
          name: categories.name,
          nameEn: categories.nameEn,
        },
      })
      .from(mcpServers)
      .leftJoin(categories, eq(mcpServers.categoryId, categories.id))
      .where(and(...whereConditions))
      .orderBy(desc(mcpServers.downloads))
      .limit(limit * 2)

    return rows.map((row) => ({ ...row, category: row.category?.slug != null ? { slug: row.category.slug } : null }))
  },
}
