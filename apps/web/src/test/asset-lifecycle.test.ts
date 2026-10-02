/**
 * MCP/A2A 资产生命周期集成测试：直接打真实 PostgreSQL。
 *
 * 这批用例验的是三条会直接影响"平台上架了什么"的不变量：
 *
 * 1. 软删除是软删除 —— 行还在（买家购买记录和分成归属还指得出它），但市场
 *    读不到。
 * 2. 停用即下架 —— 提供方点停用后，资产立刻从市场消失，不必额外操作。
 * 3. 重新启用必须复查 —— 端点仍然坏着时不能被翻回 online，否则买家会为一个
 *    调用不通的资产付钱。
 *
 * 第 3 条的"复查"要真的发网络请求，所以这里直接测判定层：把端点指向一个必定
 * 连接失败的地址，验证 `toggle` 拒绝把它置为 online。真正发请求的那一层留给
 * 网关侧的测试。
 */

import { and, eq, isNull } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { a2aAgents, authors, catalogAssets, mcpServers } from "@workspace/db"
import { db } from "@/lib/db"
import { resolveA2a, resolveMcp } from "@/lib/agent-install/store-mcp/resolve"
import { a2aGatewayAccess } from "@/web/a2a-agents/gateway"
import { a2aAgentsDataAccess } from "@/web/a2a-agents/index"
import { searchCatalog } from "@/web/catalog/search"
import { mcpGatewayAccess } from "@/web/mcp-servers/gateway"
import { mcpServersDataAccess } from "@/web/mcp-servers/index"

const SUFFIX = `p3test${Date.now()}`
const AUTHOR_ID = `author-${SUFFIX}`

/** 必定连不通的端点：`example.com` 的保留子域，RFC 6761 保证不解析到任何服务。 */
const DEAD_ENDPOINT = "https://this-host-does-not-exist.invalid/mcp"

let serverId = ""

async function insertServer(
  overrides: Partial<typeof mcpServers.$inferInsert> = {}
) {
  const id =
    overrides.id ?? `mcpsrv-${Math.random().toString(36).slice(2)}-${SUFFIX}`
  await db.insert(mcpServers).values({
    id,
    referenceId: `ref-${id}`,
    slug: `slug-${id}`,
    name: `P3 Server ${id}`,
    transport: "http",
    endpoint: DEAD_ENDPOINT,
    serverName: `sname-${id}`,
    connectionStatus: "online",
    scope: "public",
    authorId: AUTHOR_ID,
    priceType: "free",
    status: "published",
    publishedAt: new Date(),
    ...overrides,
  } as never)
  return id
}

async function insertAgent(
  overrides: Partial<typeof a2aAgents.$inferInsert> = {}
) {
  const id =
    overrides.id ?? `a2aagt-${Math.random().toString(36).slice(2)}-${SUFFIX}`
  await db.insert(a2aAgents).values({
    id,
    referenceId: `ref-${id}`,
    slug: `slug-${id}`,
    name: `P3 Agent ${id}`,
    agentName: `aname-${id}`,
    endpoint: DEAD_ENDPOINT,
    agentCardUrl: DEAD_ENDPOINT,
    protocolVersion: "1.0",
    connectionStatus: "online",
    visibility: "public",
    authorId: AUTHOR_ID,
    priceType: "free",
    status: "published",
    publishedAt: new Date(),
    ...overrides,
  } as never)
  return id
}

beforeAll(async () => {
  await db.insert(authors).values({
    id: AUTHOR_ID,
    name: `p3-author-${SUFFIX}`,
    username: `p3-author-${SUFFIX}`,
  } as never)

  serverId = await insertServer()
  await insertAgent()
})

afterAll(async () => {
  await db
    .delete(mcpServers)
    .where(eq(mcpServers.authorId, AUTHOR_ID))
    .catch(() => undefined)
  await db
    .delete(a2aAgents)
    .where(eq(a2aAgents.authorId, AUTHOR_ID))
    .catch(() => undefined)
  await db
    .delete(authors)
    .where(eq(authors.id, AUTHOR_ID))
    .catch(() => undefined)
})

describe("soft delete keeps the row", () => {
  it("remove() tombstones the MCP row instead of deleting it", async () => {
    const id = await insertServer()
    await mcpGatewayAccess.remove(AUTHOR_ID, id)

    const [row] = await db
      .select()
      .from(mcpServers)
      .where(eq(mcpServers.id, id))
      .limit(1)
    // 行必须在：买家购买记录和分成归属都指向 author/asset，硬删会让"这笔钱
    // 是谁赚的"失去原始凭据。
    expect(row).toBeDefined()
    expect(row?.deletedAt).toBeInstanceOf(Date)
    // 而且要真的不可见，而不只是多一列。
    expect(await mcpGatewayAccess.getMineById(AUTHOR_ID, id)).toBeNull()
    expect(await mcpServersDataAccess.getMcpServerById(id)).toBeUndefined()
  })

  it("remove() tombstones the A2A row too", async () => {
    const id = await insertAgent()
    await a2aGatewayAccess.remove(AUTHOR_ID, id)

    const [row] = await db
      .select()
      .from(a2aAgents)
      .where(eq(a2aAgents.id, id))
      .limit(1)
    expect(row).toBeDefined()
    expect(row?.deletedAt).toBeInstanceOf(Date)
    expect(await a2aGatewayAccess.getMineById(AUTHOR_ID, id)).toBeNull()
  })

  it("hides a deleted server from the market list and count", async () => {
    const id = await insertServer()
    const before = await mcpServersDataAccess.getMcpServersCount({})
    expect(
      (await mcpServersDataAccess.getMcpServers({})).some((s) => s.id === id)
    ).toBe(true)

    await mcpGatewayAccess.remove(AUTHOR_ID, id)

    expect(await mcpServersDataAccess.getMcpServersCount({})).toBe(before - 1)
    expect(
      (await mcpServersDataAccess.getMcpServers({})).some((s) => s.id === id)
    ).toBe(false)
  })

  it("hides a deleted server from related servers", async () => {
    // 详情页右侧的"相关服务"如果不过滤，会把已删除的资产重新推荐出去。
    const id = await insertServer()
    await mcpGatewayAccess.remove(AUTHOR_ID, id)
    const related = await mcpServersDataAccess.getRelatedMcpServers({
      id: serverId,
      limit: 20,
    })
    expect(related.some((r) => r.id === id)).toBe(false)
  })

  it("removing twice is a no-op error rather than resurrecting the row", async () => {
    const id = await insertServer()
    await mcpGatewayAccess.remove(AUTHOR_ID, id)
    const first = (
      await db.select().from(mcpServers).where(eq(mcpServers.id, id)).limit(1)
    )[0]
    await expect(mcpGatewayAccess.remove(AUTHOR_ID, id)).rejects.toThrow()
    const second = (
      await db.select().from(mcpServers).where(eq(mcpServers.id, id)).limit(1)
    )[0]
    // 第二次删除不能把时间戳刷新掉，否则"首次删除时间"就不可信了。
    expect(second?.deletedAt?.getTime()).toBe(first?.deletedAt?.getTime())
  })

  it("keeps a deleted server out of the provider's own list", async () => {
    const id = await insertServer()
    await mcpGatewayAccess.remove(AUTHOR_ID, id)
    expect(
      (await mcpGatewayAccess.listMine(AUTHOR_ID)).some((s) => s.id === id)
    ).toBe(false)
  })
})

describe("disable delists immediately", () => {
  it("a disabled published server disappears from the market", async () => {
    const id = await insertServer()
    const before = await mcpServersDataAccess.getMcpServersCount({})
    expect(
      (await mcpServersDataAccess.getMcpServers({})).some((s) => s.id === id)
    ).toBe(true)

    await mcpGatewayAccess.toggle(AUTHOR_ID, id, false)

    // 市场可见性要求 `connection_status = 'online'`。以前 toggle 只改这一列而
    // 列表只查 `status = 'published'`，于是停用的资产继续挂在市场上被购买。
    expect(await mcpServersDataAccess.getMcpServersCount({})).toBe(before - 1)
    expect(
      (await mcpServersDataAccess.getMcpServers({})).some((s) => s.id === id)
    ).toBe(false)
    expect(await mcpServersDataAccess.getMcpServerById(id)).toBeUndefined()
  })

  it("a disabled agent disappears from the market", async () => {
    const id = await insertAgent()
    expect(await a2aAgentsDataAccess.getAgentById(id)).toBeTruthy()
    await a2aGatewayAccess.toggle(AUTHOR_ID, id, false)
    expect(await a2aAgentsDataAccess.getAgentById(id)).toBeFalsy()
  })

  it("keeps the server in the provider's own list so it can be re-enabled", async () => {
    // 如果停用后提供方自己也看不到，就没有任何入口能重新启用，资产等于报废。
    const id = await insertServer()
    await mcpGatewayAccess.toggle(AUTHOR_ID, id, false)
    const mine = await mcpGatewayAccess.listMine(AUTHOR_ID)
    const row = mine.find((s) => s.id === id)
    expect(row).toBeDefined()
  })

  it("does not disturb status when disabling", async () => {
    // status 保持 published，重新启用通过复查后能自动回到市场，不必重新走审核。
    const id = await insertServer()
    await mcpGatewayAccess.toggle(AUTHOR_ID, id, false)
    const [row] = await db
      .select()
      .from(mcpServers)
      .where(eq(mcpServers.id, id))
      .limit(1)
    expect(row?.status).toBe("published")
    expect(row?.connectionStatus).toBe("disabled")
  })
})

describe("re-enabling re-verifies the endpoint", () => {
  it("refuses to bring a still-broken endpoint back online", async () => {
    const id = await insertServer()
    await mcpGatewayAccess.toggle(AUTHOR_ID, id, false)

    await expect(mcpGatewayAccess.toggle(AUTHOR_ID, id, true)).rejects.toThrow(
      /连接测试未通过|端点不可用/
    )

    // 关键：不能停在 disabled —— 那样重试一次就永久失去市场入口，
    // 也不能是 online —— 端点确实不通。
    const [row] = await db
      .select()
      .from(mcpServers)
      .where(eq(mcpServers.id, id))
      .limit(1)
    expect(row?.connectionStatus).toBe("error")
    expect(
      (await mcpServersDataAccess.getMcpServers({})).some((s) => s.id === id)
    ).toBe(false)
  })

  it("records the failed re-test result so the provider can see why", async () => {
    const id = await insertServer()
    await mcpGatewayAccess.toggle(AUTHOR_ID, id, false)
    await mcpGatewayAccess.toggle(AUTHOR_ID, id, true).catch(() => undefined)

    const [row] = await db
      .select()
      .from(mcpServers)
      .where(eq(mcpServers.id, id))
      .limit(1)
    expect(row?.lastTestedAt).toBeInstanceOf(Date)
    expect(row?.lastTestResult).toBeTruthy()
  })

  it("refuses for A2A too", async () => {
    const id = await insertAgent()
    await a2aGatewayAccess.toggle(AUTHOR_ID, id, false)
    await expect(a2aGatewayAccess.toggle(AUTHOR_ID, id, true)).rejects.toThrow(
      /连接测试未通过|端点不可用/
    )
    const [row] = await db
      .select()
      .from(a2aAgents)
      .where(eq(a2aAgents.id, id))
      .limit(1)
    expect(row?.connectionStatus).toBe("error")
  })
})

describe("ownership is still enforced after soft delete", () => {
  it("refuses to toggle or remove another provider's asset", async () => {
    const id = await insertServer()
    await expect(
      mcpGatewayAccess.toggle("author-someone-else", id, false)
    ).rejects.toThrow()
    await expect(
      mcpGatewayAccess.remove("author-someone-else", id)
    ).rejects.toThrow()
    const [row] = await db
      .select()
      .from(mcpServers)
      .where(eq(mcpServers.id, id))
      .limit(1)
    expect(row?.connectionStatus).toBe("online")
    expect(isNull(mcpServers.deletedAt)).toBeTruthy()
    expect(row?.deletedAt).toBeNull()
  })

  it("does not let a deleted asset's slug be reused", async () => {
    // slug 是 unique 的：软删除后仍然占用。若将来要允许复用，这里是冲突点。
    const id = await insertServer()
    await mcpGatewayAccess.remove(AUTHOR_ID, id)
    const [row] = await db
      .select()
      .from(mcpServers)
      .where(eq(mcpServers.id, id))
      .limit(1)
    expect(row?.slug).toBeTruthy()
    const dup = await db
      .insert(mcpServers)
      .values({
        ...row,
        id: `other-${id}`,
        referenceId: `ref-other-${id}`,
      } as never)
      .then(() => null)
      .catch((e) => e)
    expect(dup).not.toBeNull()
    await db
      .delete(mcpServers)
      .where(eq(mcpServers.id, `other-${id}`))
      .catch(() => undefined)
  })
})

describe("market visibility requires all three signals", async () => {
  it("keeps drafts and rejected rows out even when connection is online", async () => {
    const draft = await insertServer({ status: "draft" })
    const rejected = await insertServer({ status: "rejected" })
    const archived = await insertServer({ status: "archived" })

    const listed = await mcpServersDataAccess.getMcpServers({ limit: 100 })
    for (const id of [draft, rejected, archived]) {
      expect(
        listed.some((s) => s.id === id),
        id
      ).toBe(false)
    }
  })

  it("keeps an errored published row out of the market", async () => {
    // 健康检查把连接标成 error 时，资产必须立刻消失 —— 否则买家会为一个
    // 已知连不上的服务付款。
    const id = await insertServer({ connectionStatus: "error" })
    expect(
      (await mcpServersDataAccess.getMcpServers({ limit: 100 })).some(
        (s) => s.id === id
      )
    ).toBe(false)
    expect(await mcpServersDataAccess.getMcpServerById(id)).toBeUndefined()
  })

  it("still shows a published, online, undeleted row", async () => {
    const id = await insertServer()
    expect(
      (await mcpServersDataAccess.getMcpServers({ limit: 100 })).some(
        (s) => s.id === id
      )
    ).toBe(true)
    expect(await mcpServersDataAccess.getMcpServerById(id)).toBeTruthy()
    const [row] = await db
      .select()
      .from(mcpServers)
      .where(and(eq(mcpServers.id, id), isNull(mcpServers.deletedAt)))
      .limit(1)
    expect(row).toBeDefined()
  })
})

describe("the unified catalog view applies the same rule", async () => {
  // `catalog_assets` 是 0007 建的视图，power 了 `catalog.search`、
  // 推荐和 Store MCP 的搜索工具。它原本只有 `status = 'published'` 一个条件，
  // 于是是整套可见性规则里最容易漏的一处：页面全都没了，资产还能被搜到并安装。
  async function catalogIds(kind: "mcp" | "a2a"): Promise<Set<string>> {
    const rows = await db
      .select({ id: catalogAssets.id })
      .from(catalogAssets)
      .where(eq(catalogAssets.kind, kind))
    return new Set(rows.map((r) => r.id))
  }

  it("hides a deleted asset from catalog search", async () => {
    const id = await insertServer()
    expect(await catalogIds("mcp")).toContain(id)
    await mcpGatewayAccess.remove(AUTHOR_ID, id)
    expect(await catalogIds("mcp")).not.toContain(id)
  })

  it("hides a disabled asset from catalog search", async () => {
    const id = await insertServer()
    await mcpGatewayAccess.toggle(AUTHOR_ID, id, false)
    expect(await catalogIds("mcp")).not.toContain(id)
  })

  it("hides an errored asset from catalog search", async () => {
    const id = await insertServer({ connectionStatus: "error" })
    expect(await catalogIds("mcp")).not.toContain(id)
  })

  it("keeps a healthy asset in catalog search", async () => {
    const id = await insertServer()
    expect(await catalogIds("mcp")).toContain(id)
  })

  it("hides a deleted A2A agent from catalog search", async () => {
    const id = await insertAgent()
    expect(await catalogIds("a2a")).toContain(id)
    await a2aGatewayAccess.remove(AUTHOR_ID, id)
    expect(await catalogIds("a2a")).not.toContain(id)
  })

  it("surfaces the asset through searchCatalog, the real caller", async () => {
    const id = await insertServer()
    const found = await searchCatalog({
      kind: "mcp",
      q: `slug-${id}`,
      limit: 20,
    })
    expect(found.assets.some((a) => a.id === id)).toBe(true)

    await mcpGatewayAccess.remove(AUTHOR_ID, id)
    const after = await searchCatalog({
      kind: "mcp",
      q: `slug-${id}`,
      limit: 20,
    })
    expect(after.assets.some((a) => a.id === id)).toBe(false)
  })
})

/**
 * 商店安装工具（`install_asset`）绕过市场列表，直接按 id 或 slug 查库。买家
 * Agent 记的是 slug，所以这是最短的绕过路径：只判 `status === 'published'`
 * 就能装到一个已删除或已停用的资产，然后把一个必然调不通的 gatewayUrl 写进
 * 配置文件。
 */
describe("the Store MCP install resolver enforces the same rule", () => {
  async function slugOf(id: string) {
    const row = await db
      .select({ slug: mcpServers.slug })
      .from(mcpServers)
      .where(eq(mcpServers.id, id))
      .limit(1)
    return row[0]!.slug
  }

  it("still resolves a healthy asset by id and by slug", async () => {
    const id = await insertServer()
    expect((await resolveMcp(id))?.id).toBe(id)
    expect((await resolveMcp(await slugOf(id)))?.id).toBe(id)
  })

  it("refuses a deleted asset by id", async () => {
    const id = await insertServer()
    await mcpGatewayAccess.remove(AUTHOR_ID, id)
    expect(await resolveMcp(id)).toBeNull()
  })

  it("refuses a deleted asset by slug", async () => {
    const id = await insertServer()
    const slug = await slugOf(id)
    await mcpGatewayAccess.remove(AUTHOR_ID, id)
    expect(await resolveMcp(slug)).toBeNull()
  })

  it("refuses a disabled asset", async () => {
    const id = await insertServer()
    await mcpGatewayAccess.toggle(AUTHOR_ID, id, false)
    expect(await resolveMcp(id)).toBeNull()
  })

  it("refuses an asset whose endpoint is known broken", async () => {
    // 健康检查判定失败后状态是 error，此时即使 status 仍是 published，
    // 也不能再被装进 Agent。
    const id = await insertServer({ connectionStatus: "error" })
    expect(await resolveMcp(id)).toBeNull()
  })

  it("refuses a draft that was never published", async () => {
    const id = await insertServer({ status: "draft", publishedAt: null })
    expect(await resolveMcp(id)).toBeNull()
  })

  it("refuses a deleted A2A agent by id and by slug", async () => {
    const id = await insertAgent()
    const row = await db
      .select({ slug: a2aAgents.slug })
      .from(a2aAgents)
      .where(eq(a2aAgents.id, id))
      .limit(1)
    const slug = row[0]!.slug
    await a2aGatewayAccess.remove(AUTHOR_ID, id)
    expect(await resolveA2a(id)).toBeNull()
    expect(await resolveA2a(slug)).toBeNull()
  })

  it("refuses a disabled A2A agent", async () => {
    const id = await insertAgent()
    await a2aGatewayAccess.toggle(AUTHOR_ID, id, false)
    expect(await resolveA2a(id)).toBeNull()
  })
})
