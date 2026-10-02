import { and, count, desc, eq, like, ne, or, sql } from "drizzle-orm"
import type { PgColumn } from "drizzle-orm/pg-core"
import { db } from "@/lib/db"
import { a2aAgents, authors, categories } from "@workspace/db"
import { testA2aConnection } from "@/lib/gateway/a2a-connect"
import type { A2aProtocolVersion, AssetAuthType } from "@/lib/registry-labels"
import { marketVisible, notDeleted } from "@/web/assets/visibility"

export type A2aAgentListItem = {
  id: string
  referenceId: string
  slug: string
  name: string
  description: string | null
  descriptionEn: string | null
  logoUrl: string | null
  agentCardUrl: string | null
  authType: AssetAuthType
  protocolVersion: A2aProtocolVersion | null
  categoryId: string | null
  priceType: "free" | "paid"
  billingModel: "one_time" | "subscription" | "pay_per_call" | null
  unitPrice: string | null
  currency: string
  certified: boolean
  securityLevel: string | null
  views: number
  downloads: number
  publishedAt: Date | null
  createdAt: Date
  author: {
    id: string
    name: string
    username: string
    avatar: string | null
    verified: boolean
  }
  category: { id: string; name: string; nameEn: string; slug: string } | null
}

export type RegisterA2aAgentInput = {
  name: string
  description?: string | null
  descriptionEn?: string | null
  agentCardUrl?: string | null
  agentCard?: Record<string, unknown> | null
  authType?: AssetAuthType
  categoryId?: string | null
  priceType?: "free" | "paid"
  priceAmount?: string | number | null
  billingModel?: "one_time" | "subscription" | "pay_per_call" | null
  unitPrice?: string | number | null
  currency?: string
}

function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 200)
}

async function uniqueSlug(base: string): Promise<string> {
  let candidate = base || "a2a-agent"
  let suffix = 0
  for (;;) {
    const [existing] = await db
      .select({ slug: a2aAgents.slug })
      .from(a2aAgents)
      .where(eq(a2aAgents.slug, candidate))
      .limit(1)
    if (!existing) return candidate
    suffix += 1
    candidate = `${base || "a2a-agent"}-${suffix}`
  }
}

export const a2aAgentsDataAccess = {
  getAgents: async (params: {
    page?: number
    limit?: number
    search?: string
    authType?: AssetAuthType
    sort?: "date-desc" | "downloads-desc" | "views-desc"
  }): Promise<A2aAgentListItem[]> => {
    const {
      page = 1,
      limit = 18,
      search,
      authType,
      sort = "date-desc",
    } = params
    const whereConditions = [marketVisible(a2aAgents)]

    if (authType) whereConditions.push(eq(a2aAgents.authType, authType))
    if (search) {
      whereConditions.push(
        or(
          like(a2aAgents.name, `%${search}%`),
          like(a2aAgents.description, `%${search}%`),
          like(authors.name, `%${search}%`)
        )!
      )
    }

    const orderBy: PgColumn | ReturnType<typeof desc> =
      sort === "downloads-desc"
        ? desc(a2aAgents.downloads)
        : sort === "views-desc"
          ? desc(a2aAgents.views)
          : desc(a2aAgents.publishedAt)

    const rows = await db
      .select({
        id: a2aAgents.id,
        referenceId: a2aAgents.referenceId,
        slug: a2aAgents.slug,
        name: a2aAgents.name,
        description: a2aAgents.description,
        descriptionEn: a2aAgents.descriptionEn,
        logoUrl: a2aAgents.logoUrl,
        agentCardUrl: a2aAgents.agentCardUrl,
        authType: a2aAgents.authType,
        protocolVersion: a2aAgents.protocolVersion,
        categoryId: a2aAgents.categoryId,
        priceType: a2aAgents.priceType,
        billingModel: a2aAgents.billingModel,
        unitPrice: a2aAgents.unitPrice,
        currency: a2aAgents.currency,
        certified: a2aAgents.certified,
        securityLevel: a2aAgents.securityLevel,
        views: a2aAgents.views,
        downloads: a2aAgents.downloads,
        publishedAt: a2aAgents.publishedAt,
        createdAt: a2aAgents.createdAt,
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
      .from(a2aAgents)
      .innerJoin(authors, eq(a2aAgents.authorId, authors.id))
      .leftJoin(categories, eq(a2aAgents.categoryId, categories.id))
      .where(and(...whereConditions))
      .orderBy(orderBy)
      .limit(limit)
      .offset((page - 1) * limit)

    return rows.map((row) => ({
      ...row,
      unitPrice: row.unitPrice?.toString() ?? null,
      currency: row.currency ?? "CNY",
      category: row.category?.id != null ? row.category : null,
    }))
  },

  getAgentsCount: async (params: {
    search?: string
    authType?: AssetAuthType
  }): Promise<number> => {
    const { search, authType } = params
    const whereConditions = [marketVisible(a2aAgents)]

    if (authType) whereConditions.push(eq(a2aAgents.authType, authType))
    if (search) {
      whereConditions.push(
        or(
          like(a2aAgents.name, `%${search}%`),
          like(a2aAgents.description, `%${search}%`),
          like(authors.name, `%${search}%`)
        )!
      )
    }

    const [row] = await db
      .select({ count: count() })
      .from(a2aAgents)
      .innerJoin(authors, eq(a2aAgents.authorId, authors.id))
      .where(and(...whereConditions))

    return row?.count ?? 0
  },

  getAgentById: async (id: string) => {
    const [row] = await db
      .select({
        id: a2aAgents.id,
        referenceId: a2aAgents.referenceId,
        slug: a2aAgents.slug,
        name: a2aAgents.name,
        description: a2aAgents.description,
        descriptionEn: a2aAgents.descriptionEn,
        logoUrl: a2aAgents.logoUrl,
        agentCardUrl: a2aAgents.agentCardUrl,
        agentCard: a2aAgents.agentCard,
        agentName: a2aAgents.agentName,
        authType: a2aAgents.authType,
        protocolVersion: a2aAgents.protocolVersion,
        categoryId: a2aAgents.categoryId,
        visibility: a2aAgents.visibility,
        priceType: a2aAgents.priceType,
        priceAmount: a2aAgents.priceAmount,
        billingModel: a2aAgents.billingModel,
        unitPrice: a2aAgents.unitPrice,
        currency: a2aAgents.currency,
        certified: a2aAgents.certified,
        securityLevel: a2aAgents.securityLevel,
        views: a2aAgents.views,
        downloads: a2aAgents.downloads,
        publishedAt: a2aAgents.publishedAt,
        createdAt: a2aAgents.createdAt,
        updatedAt: a2aAgents.updatedAt,
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
      .from(a2aAgents)
      .innerJoin(authors, eq(a2aAgents.authorId, authors.id))
      .leftJoin(categories, eq(a2aAgents.categoryId, categories.id))
      .where(and(marketVisible(a2aAgents), eq(a2aAgents.id, id)))
      .limit(1)

    return row
  },

  registerAgent: async (authorId: string, input: RegisterA2aAgentInput) => {
    if (!input.agentCardUrl) {
      throw new Error("请填写 Agent Card 地址并完成连接测试")
    }
    const test = await testA2aConnection({
      url: input.agentCardUrl,
      protocol: "1.0",
      auth: {
        type:
          input.authType === "bearer" || input.authType === "api_key"
            ? input.authType
            : "none",
      },
    })
    if (!test.ok) {
      const failStep = test.steps?.find((s) => s.status === "fail")
      throw new Error(failStep?.detail || "连接测试未通过，无法提交")
    }

    const refBase = slugify(input.name) || "a2a-agent"
    const slug = await uniqueSlug(refBase)
    const [inserted] = await db
      .insert(a2aAgents)
      .values({
        referenceId: slug,
        slug,
        name: input.name,
        description: input.description ?? null,
        descriptionEn: input.descriptionEn ?? null,
        agentCardUrl: input.agentCardUrl ?? null,
        agentCard: input.agentCard ?? null,
        authType: input.authType ?? "none",
        categoryId: input.categoryId ?? null,
        authorId,
        priceType: input.priceType ?? "free",
        priceAmount:
          input.priceAmount != null ? String(input.priceAmount) : null,
        billingModel: input.billingModel ?? null,
        unitPrice: input.unitPrice != null ? String(input.unitPrice) : null,
        currency: input.currency ?? "CNY",
        connectionStatus: "online",
        lastTestedAt: new Date(),
        lastTestResult: test,
        status: "submitted",
      })
      .returning()

    if (!inserted) {
      throw new Error("Agent 注册失败")
    }

    return a2aAgentsDataAccess.getAgentById(inserted.id)
  },

  getMyAgents: async (authorId: string) => {
    const rows = await db
      .select({
        id: a2aAgents.id,
        slug: a2aAgents.slug,
        name: a2aAgents.name,
        authType: a2aAgents.authType,
        priceType: a2aAgents.priceType,
        billingModel: a2aAgents.billingModel,
        status: a2aAgents.status,
        views: a2aAgents.views,
        downloads: a2aAgents.downloads,
        createdAt: a2aAgents.createdAt,
      })
      .from(a2aAgents)
      .where(and(eq(a2aAgents.authorId, authorId), notDeleted(a2aAgents)))
      .orderBy(desc(a2aAgents.createdAt))

    return rows
  },

  incrementViews: async (id: string) => {
    await db
      .update(a2aAgents)
      .set({ views: sql`${a2aAgents.views} + 1`, updatedAt: new Date() })
      .where(eq(a2aAgents.id, id))
  },

  /** 相关智能体：优先同分类，其次按热度排序，供详情页右侧推荐使用 */
  getRelatedAgents: async (params: {
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
      .select({ categoryId: a2aAgents.categoryId })
      .from(a2aAgents)
      .where(eq(a2aAgents.id, id))
      .limit(1)

    const whereConditions = [marketVisible(a2aAgents), ne(a2aAgents.id, id)]
    if (current?.categoryId) {
      whereConditions.push(eq(a2aAgents.categoryId, current.categoryId))
    }

    const rows = await db
      .select({
        id: a2aAgents.id,
        slug: a2aAgents.slug,
        name: a2aAgents.name,
        description: a2aAgents.description,
        descriptionEn: a2aAgents.descriptionEn,
        logoUrl: a2aAgents.logoUrl,
        views: a2aAgents.views,
        downloads: a2aAgents.downloads,
        category: {
          slug: categories.slug,
          name: categories.name,
          nameEn: categories.nameEn,
        },
      })
      .from(a2aAgents)
      .leftJoin(categories, eq(a2aAgents.categoryId, categories.id))
      .where(and(...whereConditions))
      .orderBy(desc(a2aAgents.downloads))
      .limit(limit * 2)

    return rows.map((row) => ({
      ...row,
      category: row.category?.slug != null ? { slug: row.category.slug } : null,
    }))
  },
}
