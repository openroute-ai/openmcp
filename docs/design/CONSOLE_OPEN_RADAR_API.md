# `apps/console` Radar 开放 API 设计方案

> 本文定义 `apps/console` 对外开放的 HTTP API：**用户自助签发与管理员治理 API Key**、
> 接入方注册与配对、仓库创建与首次拉取回调、指定仓库的日/周/月统计、周期排行与周期目录、
> 以及日更新订阅推送。同时定义**现有 `/api/*` 路由的清理与迁移**（§12）。
>
> 前提事实（已核对代码）：
>
> - `apps/console` 与 `apps/web` 是两个独立 Next 应用，各自的数据库、账号体系、会话与鉴权互不相通。
>   本文所有接口只经HTTP 与外部通信，**不得** import `@workspace/db` / `@workspace/auth`，
>   也不共享任何用户身份。
> - 仓库创建已存在于 `apps/console/src/lib/trpc/routers/repos.ts:394`（`repos.create`，**`protectedProcedure`**），
>   统计写入已存在于 `apps/console/src/lib/github/service/stats.ts:463`（`recordCurrentPeriods`），
>   排行构建已存在于 `apps/console/src/lib/github/service/rankings.ts`（`buildRankingsForWeek` /
>   `buildRankingsForMonth`）。
> - 三张统计表 `repo_daily_stats` / `repo_weekly_stats` / `repo_monthly_stats` 由
>   `apps/console/src/db/drizzle/0012_repo_stats.sql` 建出，字段完全一致；`repo_stargazers`
>   同批建立。
> - 现有机器对机器鉴权只有一个 `CONSOLE_API_TOKEN`（`apps/console/src/lib/env.ts:62` 声明、`:157-159` 由 `apiToken()` 读取，
>   `apps/console/src/app/api/internal/repos/route.ts`），常数时间比较、fail-closed 404。
>   **本文把它整体废弃**，由可撤销的 API key 取代；`/api/internal/repos` 的处置见 §12.2。
> - 现有出站签名实现在 `apps/console/src/lib/webhook/client.ts`（`signPayload` /
>   `verifySignature` / `isFreshTimestamp` / `sendWebhook`），本文的回调与订阅推送复用它，
>   不另造一套签名。但 `sendWebhook` **不发** `X-Webhook-Id` / `X-Webhook-Event`（§3.5 有说明）。
> - `apps/web` 的 `repo_snapshots.subscribers`（`packages/db/src/mcp-schema.ts:100`）当前**从未被写入**，
>   且 `repo_snapshots.watchers` 拿到的是 REST 的 `watchers_count`。GitHub 这两个字段的语义与直觉相反，
>   见 §4.4。结论是 console 侧**不需要新增计数器**，但必须先讲清这个坑。
> - **分类表 `categories` 已于 `0021_stiff_shadowcat.sql` 建出**（`projects.category_id` 等四列），
>   `capabilities` / `projects_to_capabilities` 由 `0016` 恢复。两者**都没有种子、没有写入方**，
>   这是**正常的**——分类是产品/运营配置的数据，不是程序生成的。程序只保证读写路径闭环，
>   见 §1.5。
> - **本文 §2 的凭据层（`api_keys` 表、`lib/api/*` 鉴权与限流、Redis 双驱动、`adminProcedure`
>   签发/吊销/轮换）已经实现并有测试**，但**一条 `/api/v1` 路由都还没有**，
>   因此 `authenticateApiKey` 目前没有任何生产调用方。准确清单见 §10.1。
> - **`api_keys` 表缺一个"归属"列**，这是自助签发的唯一 schema 阻塞点；
>   `created_by` 的语义是"谁签发"、`submitter_id` 是"提交记到谁名下"，两者都不回答"这是谁的 key"。
>   §2.2 补 `user_id`。
> - 现有机器对机器鉴权只有一个 `CONSOLE_API_TOKEN`（`apps/console/src/lib/env.ts:62` 声明、`:157-159` 由 `apiToken()` 读取，
>   `apps/console/src/app/api/internal/repos/route.ts`），常数时间比较、fail-closed 404。
>   本文的设计把它升级为可撤销的 key，但**保持同样的 fail-closed 语义**。
> - 现有出站签名实现在 `apps/console/src/lib/webhook/client.ts`（`signPayload` /
>   `verifySignature` / `isFreshTimestamp` / `sendWebhook`），本文的回调与订阅推送复用它，
>   不另造一套签名。
> - `apps/web` 的 `repo_snapshots.subscribers`（`packages/db/src/mcp-schema.ts:100`）当前**从未被写入**，
>   且 `repo_snapshots.watchers` 拿到的是 REST 的 `watchers_count`。GitHub 这两个字段的语义与直觉相反，
>   见 §4.4。结论是 console 侧**不需要新增计数器**，但必须先讲清这个坑。

---

## 1. 总览

### 1.1 路由清单

所有开放接口挂在 `/api/v1` 前缀下，与匿名可读的 `/api/rankings/*.json` 并存但互不影响。

| 方法 | 路径 | scope | 说明 |
|---|---|---|---|
| POST | `/api/v1/repos` | `repos:write` | 登记仓库，**不建 project**（§12.2 已实施） |
| POST | `/api/v1/projects` | `projects:write` | 按 URL 策展并**发布** project（§12.2 已实施） |
| GET | `/api/v1/repos` | `repos:read` | 列出该 key 可见的仓库，支持 §6.6 的同一套过滤器，**keyset 分页** |
| GET | `/api/v1/repos/{id}` | `repos:read` | 单个仓库档案 + 最近一期统计 |
| GET | `/api/v1/repos/{id}/stats` | `repos:read` | 日/周/月区间统计（§4） |
| GET | `/api/v1/rankings/weekly` | `rankings:read` | 指定周排行 |
| GET | `/api/v1/rankings/monthly` | `rankings:read` | 指定月排行 |
| GET | `/api/v1/rankings/periods` | `rankings:read` | 可用周期目录（周/月，按年过滤） |
| POST | `/api/v1/subscriptions` | `subscriptions:write` | 创建订阅（§6） |
| GET | `/api/v1/subscriptions` | `subscriptions:write` | 列出当前主体的订阅 |
| GET | `/api/v1/subscriptions/{id}` | `subscriptions:write` | 单个订阅详情 + 命中仓库 + 投递状态 |
| PATCH | `/api/v1/subscriptions/{id}` | `subscriptions:write` | 改过滤器 / scopes / 暂停 / 恢复 |
| DELETE | `/api/v1/subscriptions/{id}` | `subscriptions:write` | 删除订阅并清空待投递队列 |
| POST | `/api/v1/subscriptions/{id}/rotate-secret` | `subscriptions:write` | 轮换回调 secret |
| POST | `/api/v1/subscriptions/{id}/test` | `subscriptions:write` | 立刻发一条探测 payload，验证回调可达 |
| POST | `/api/v1/connections/redeem` | **无凭据** | 配对码换 key（§2.11，唯一无凭据端点） |
| GET | `/api/v1/openapi.json` | 任意有效凭据 | 接口自描述（§8） |

订阅也可以由 console 登录用户在 `/dashboard/subscriptions` 自助创建，归属主体是该账号而不是某个
API key。两套管理入口共用同一个 `createSubscription` 服务函数（§6.7）。

### 1.2 不做什么

| 不提供 | 原因 |
|---|---|
| `repo_stargazers` 明细 | GitHub 对非仓库管理员的 `/stargazers` 返回 403，覆盖必然不完整，对外给出会造成"完整"的错误印象。仅作为内部留存（`0012` 的注释已说明）。 |
| console 用户身份 | 跨应用不共享账号。`userRepos.userId` 只用于 console 内部的提交归属，M2M 提交走 `source: "api"`。 |
| radar 排行写入 web 的 workflow rankings | 已在 `CONSOLE_RADAR_COMMERCIAL_PLAN.md` §7.3 决策：两套排行独立，radar 排行是"信号"，web 排行是"行为"。 |
| 发布 / 扫描门控 | 那是 web 侧职责（`SKILLS_PUBLISH_POLICY.md`）。console 只提供证据。 |
| **创建 `projects` 的能力** | §1.4 的核心决策：建 project == 发布到公开面，公开面只读 `projects`。若给 API key 这个能力，任何持有 key 的接入方都能把任意仓库推上公开站。本文的 `POST /api/v1/repos` 只能让仓库"被知道"，"被发布"仍然只走 admin 策展路径。 |
| **`capabilities` 作为过滤维度** | `0016` 建了表，但 `assignProjectCapabilities` **零调用方**，没有任何代码写入过一行（§1.5）。加进过滤器等于对外承诺一个永远是空的契约。与 `categories` 不同的是，`categories` 至少有 `classify-projects` 在写，所以本文只接 `categories`，不接 `capabilities`。 |

### 1.3 不变约束

- 统计周期的"日 / 周 / 月"一律按 `Asia/Shanghai`（`apps/console/src/lib/time.ts` 的
  `APP_TIMEZONE`）解释。`period` 是该日历边界对应的**瞬间**，不是 UTC 零点。
- `total_*` / `delta_*` 的 `NULL` 原样透传，**不转 0**。`NULL` 的含义是"该周期未采集"，
  转0 会变成"采集到 0"。
- `deltaNewStars`（毛新增）与 `deltaStars`（净变化）是两个不同的量，保留两者。
- 所有响应带 `Cache-Control` / `ETag`（读接口）或 `no-store`（写接口、回调、订阅）。

### 1.4 实体模型：`repos` / `projects` / `user_repos` 的分工

这一节回答一个本文反复要用到的问题：**普通用户提交的仓库，在 radar 里是什么**。
三张表容易被混成一层，实际是三种不同的东西。

| 表 | 一行代表 | 谁写 | 公开可见 | 基数 |
|---|---|---|---|---|
| `repos` | 一个 GitHub 仓库在本系统的档案 | `upsertRepo`（`service/repo.ts:162`）——**唯一**的 `repos` 插入点 | 公开详情页可查 | 每个 GitHub 仓库恒 1 行 |
| `projects` | 一个**被策展发布**的条目 | `createProject`（`service/project.ts:99`）——**仅 admin 路径** | 公开页读的就是它 | `repoId` **不唯一**，1 repo : N projects |
| `user_repos` | 一个用户对一个仓库的提交关系 | `linkUserToRepo`（`service/user-repo.ts:63`） | 仅本人（私有列）+ 公共列全体可见 | PK `(user_id, repo_id)`，同一仓库可有多人提交 |

```
        提交 / 抓取                  仅 admin 策展
             │                            │
             ▼                            ▼
   ┌───────────────────┐          ┌───────────────────┐
   │       repos       │ 1 ─── N │     projects      │   ← 公开面只读这一张
   │  GitHub 事实档案  │          │  策展发布单元     │
   └───────────────────┘          └───────────────────┘
             │ 1                            │ 1
             │ N                            │ N
             ▼                              ▼
   ┌───────────────────────────────────────────────┐
   │                   user_repos                   │  公共列：source /
   │  N 个提交者 × 1 个仓库 = N 行                  │  submittedAt /
   │  私有列：status / note / pinned / lastViewedAt │  platformStatus
   └───────────────────────────────────────────────┘
```

**关键约束（都已核对代码）：**

- **`repos.created_by` 最多记一个人。** 它是"第一个提交者"，不是"拥有者"。
  第二个用户提交同一 URL 时该列**不能**改写——否则谁先来就决定了别人还能不能在 `/console` 看到它
  （`trpc/routers/repos.ts:431-433`）。多提交者的关系只能落在 `user_repos`。
- **提交仓库不会创建 `projects` 行。** `repos.create`（`repos.ts:394-455`）只跑
  `parseGithubRepoUrl → upsertRepo → setRepoCreatedBy → linkUserToRepo → recomputePlatformStates`，
  该 router 不 import 任何 project 写入函数。路由自己的注释写明了：
  *"the row it writes points at nothing, is not a project, and is not synced as one until an admin
  links a project to it"*（`repos.ts:219-222`）。
- **`projects` 无法脱离 `repos` 存在。** `repoId` 是 `NOT NULL` + FK `ON DELETE CASCADE`
  （`db/schema/github.ts:294-296`），所以删仓库会连带删掉它的 projects、tags、skills——
  `repos.delete` 因此在有 project 时直接 `CONFLICT`，除非显式 `force`（`repos.ts:643-653`）。
- **`user_repos.platform_status` 是物化列，不是事实来源。** 它只有一个写者
  `recomputePlatformStates`（`service/user-repo.ts:90-105`），判据直接写在 SQL 里
  （`user-repo.ts:33-39`）：

  ```sql
  case
    when repos.archived is true                          then 'archived'
    when exists (select 1 from projects p where p.repo_id = repos.id) then 'curated'
    else 'tracked'
  end
  ```

  即：**只有存在 `projects` 行才可能 `curated`**，没有第二个写者（列默认值 `'tracked'` 除外）。
  任何改变仓库平台状态的动作都必须调它，否则读到旧值——这是它作为物化列的全部代价。
  顺带说明 `PLATFORM_REPO_STATUSES` 只有 3 个值是刻意的（`db/schema.ts:207-211`）：
  `pending` 在真实数据里不可达，因为 `upsertRepo` 在提交那一刻就填了 `repos.updated_at`。

#### 决策：用户提交的 repo **不**自动创建为 project

**不自动创建。** 理由不是保守，是有一条硬边界：

> **建 `projects` 行 == 把条目推到公开面。**
> 公开页读的就是 `projects`，唯一的过滤条件是 `PUBLIC_WHERE = ne(projects.status, "hidden")`
> （`lib/public/radar.ts:45`，在 `radar.ts:77/212/269/377/487/530` 六处应用）。
> 若提交即建 project，则**任何匿名用户贴一个 URL 就能把自己任意仓库发布到公开站**——
> 这是一条未鉴权的写入公开面的路径，不能开。

同一个仓库里已经有人写过这条结论，`discover-skill-repos` 因此拒绝建 project：

> *"A candidate is a repository and nothing more. The project row is what publishes it, and creating
> one here would publish every search result."*（`tasks/discover-skill-repos.ts:118-119`）

因此 `POST /api/v1/repos`（§3）与 tRPC `repos.create` **保持完全一致的语义**：只写
`repos` + `user_repos(source)`，**不建 project，不写 `repos.created_by`**（§3.1 已写）。

提交后这个仓库在雷达里的位置是：

| 问题 | 回答 | 来源 |
|---|---|---|
| 平台跟到哪一步了 | `platform_status = 'tracked'`（GitHub 上已 archived 则 `archived`） | `platformStatusCase` |
| 谁提交的 | `user_repos` 行，按 `user_id` 精确读 | `user_repos` PK |
| 公开页能查到吗 | **查不到**，`projects` 无行 | `PUBLIC_WHERE` 从 `projects` 起筛 |
| `/console` 能看到吗 | 能，只有 `repos.created_by = 我` 的那一部分 | `repos.ts:109-111` |
| API 能按类型/分类订到它吗 | 只能通过 `includeUncurated` 匹配，见 §6.6 陷阱一 | §6.6 |

**被否决的第三种方案：建一个非公开状态（如 `draft`）的 project。**
它能拿到 slug / type / 描述供运营审阅，值得认真考虑后否决：

- `projects.slug` 全局唯一且**已被消耗**（`slugify(repo name)`，不带 owner，
  `service/project.ts:60-67`；冲突靠 `-2`/`-3` 后缀，`project.ts:84-91`）。
  让任意提交消耗 slug，会让真正的策展拿到 `widget-7` 这种名字，且不可回收。
- 要让 `PUBLIC_WHERE` 排除 `draft`，就得给 `PROJECT_STATUSES`（`github.ts:32-38`）加一个值。
  该枚举同时被 `projects.list` 的筛选、`/dashboard/projects` 的编辑器和排行过滤读，
  为"暂存"付这个面是不划算的。
- 更根本的：**策展是 radar 的核心动作**（§9 末段）。把它降级成一个自动步骤，
  就等于让"被收录"不再意味着"有人看过"。

重新考虑这个方案的条件只有一个：将来运营的审阅量成为瓶颈，且确认了瓶颈出在"要给待审仓库
起名字"而不是"看不出该收录什么"。在那之前不预先为不存在的问题加状态。

### 1.5 分类体系：四条正交的轴，其中一条刚上线

`0021_stiff_shadowcat.sql` 落地后，"一个项目属于哪一类"在 schema 里有**四个**答案。
它们不是同一件事的四种叫法，混淆它们是本文 §6.6 最容易写错的地方。

| 轴 | 载体 | 每 project 基数 | 语义 | 谁写 | 上线状态 |
|---|---|---|---|---|---|
| **type** | `projects.type`（枚举） | 1 | 这个东西**是什么形态**：`client / server / application / skill / persona` | 建项目时人工给，默认 `application` | ✅ 已上线，`projects.list` 可筛（`trpc/routers/projects.ts:210-232`） |
| **category** | `projects.category_id` → `categories.code` | 1 | 运营自建的**单一**分类：这个项目**做什么** | 运营在 `/dashboard/categories` 维护词表，`classify-projects` 提，运营确认 | ⚠️ 表已上线，接入**本文 §6.6** 的过滤器与 admin 页面 |
| **tags** | `projects_to_tags` → `tags` | N（≤3） | 读者的检索词，来源是 GitHub topics | 目前**全人工** | ✅ 已上线，是公开站 `/categories` 的**唯一**分类轴 |
| **capabilities** | `projects_to_capabilities` → `capabilities(axis, code)` | 3–5 | 机器可填的**属性**：这个项目**具备什么** | `assignProjectCapabilities`，**当前无调用方** | ⚠️ `0016` 建表，无写入方 |

三处必须写下来的坑：

**坑一：`categories` 没有数据是正常状态，不是缺陷。**

分类是**产品/运营配置的数据**，不是程序生成的。空词表意味着"运营还没配分类法"，
而不是"代码没跑起来"。`db/schema/github.ts:210-215` 是**刻意**不预置种子的：
空词表让分类器闭嘴，好过猜运营的分类法。

因此下面这四件事**都不是阻塞项**，它们描述的是"空状态下的正确行为"，而不是"缺失的功能"：

- `classify-projects`（`tasks/classify-projects.ts`）**不在 `TASK_SEEDS` 里**（`registry.ts:55`
  只注册不排期），所以没有 cron。这不构成"上线阻塞"。
- 它第一步是 `listCategories(...)`，**没有分类就跳过**（`classify-projects.ts:55-59`，
  返回 `{ classified: 0, skipped: "no-categories" }`）。**这个返回值是正确行为，不是静默失败。**
- 唯一的写入函数 `upsertCategory`（`service/category.ts:57`）没有调用方，也没有 `categories`
  的 tRPC router（`trpc/root.ts` 只注册 13 个 router）。**本文要求补上 admin 维护页**
  （`/dashboard/categories`），因为运营要能配，否则"产品/运营配置"这句话是空的。
- `listCategoryReviewQueue`（`category.ts:343`）和 `categoryUsage`（`category.ts:119`）零调用方，
  由同一批 admin 页面消费。

**程序只保证逻辑闭环，不保证词表非空。** 展开成四条可验收的断言：

| 断言 | 含义 |
|---|---|
| 词表为空时，`classify-projects` 正常退出且 `skipped: "no-categories"`，不报错、不重试 | 空 ≠ 故障 |
| 词表为空时，§6.6 的 `categoryCode` 过滤器返回**空集**而不是全量或 500 | 空集是正确答案 |
| 运营在 `/dashboard/categories` 新增一个 code 后，下一轮 `classify-projects` 就能开始产出候选 | 配置可生效 |
| `projects.category_id` 为 NULL 的行在 payload 里如实给 `category: null`，不做兜底填充 | 不编造 |

所以 `0022` 之后没有任何"必须先灌数据才能上线"的前置条件。§6.6 的 `categoryCode`
**可以现在就实现**，上线时它对空词表返回空集，与 `tags` 的行为一致。

**坑二：`categories` 表与 `capabilities.axis = 'category'` 撞名，且含义相反 —— 重命名后者。**

- `categories.code` = 运营自建的分类，"这个项目做什么"（如 `database`、`mcp-server`）。
- `capabilities` 里 `axis = 'category'` = "这个东西是什么形态"，封闭词表
  `language / library / service / framework`（`db/schema/github.ts:418-431`）。

两者都叫 category，说的不是一件事。本文**在 `categories` 上线之后把 `capabilities` 里的这个
轴改名**，让两边的命名空间在 API 层面彻底分开。

**改名方案**（`0026_rename_capability_category_axis.sql`）：

| 旧 axis | 新 axis | 说明 |
|---|---|---|
| `category` | `form` | 值不变，仍是 `language / library / service / framework`。`form` 与 `projects.type` 的"形态"用词一致，也与 §1.5 的"是什么形态"措辞一致 |
| `dataSource` | `data-source` | 顺带统一为 kebab-case。唯一的理由是 `category` 改成 `form` 之后，一组值里混着 camelCase 会更难读 |

`CAPABILITY_AXES`（`db/schema/github.ts:418-431`）改为：

```ts
export const CAPABILITY_AXES = [
  "form",
  "language",
  "deployment",
  "auth",
  "data-source",
  "runtime",
] as const;
```

**这次重命名几乎零成本**，这是必须写下来的理由：

- `0016_restore_capabilities_tables.sql` 只 `CREATE TABLE IF NOT EXISTS`，**全文 0 条 INSERT**，
  不预置任何 capability 行。
- `assignProjectCapabilities` 与 `listProjectCapabilities` **都没有调用方**，表里不可能有行。
  （`grep -rn "listProjectCapabilities\|assignProjectCapabilities" apps/console/src` 只在
  `classify-projects.ts:6` 的注释里出现过 `assignProjectCapabilities`。）
- 因此 `capabilities` 与 `projects_to_capabilities` 都可以直接 `DELETE FROM` 后重建约束，
  迁移写成幂等的 `UPDATE` 即可，不需要考虑旧值转换。

**但仍要写迁移而不是只改常量**，因为生产库的实际行数是未知的（代码里没有写入方，
不代表历史上没人手工插过）。迁移必须满足：

```sql
-- 幂等；两处都要改：capabilities.axis 是枚举列，projects_to_capabilities 通过 capabilityId
-- 间接依赖，不需要改。但 uniqueIndex("capabilities_axis_code_unique").on(axis, code) 的
-- 索引数据会随 UPDATE 自动重建。
UPDATE "capabilities" SET axis = 'form'        WHERE axis = 'category';
UPDATE "capabilities" SET axis = 'data-source' WHERE axis = 'dataSource';
```

**对外接口用两个不同的名字**（这是本文一直坚持的做法）：

| 概念 | 参数名 | 来源 |
|---|---|---|
| 运营分类（做什么） | `categoryCode` | `categories.code`，如 `database` |
| 形态（是什么） | `form` | `capabilities` 里 `axis = 'form'` 的值，如 `framework` |

`CONSOLE_RADAR_COMMERCIAL_PLAN.md` §5.3 要求"分类法正交拆两轴：`category` × `deployment`"，
那条要求指的是 **capabilities 内部的两轴**，与 `categories` 表无关 —— 改名成 `form` 后，
`capabilities` 内部的两轴是 `form × deployment`，正好保持了原意，且不再与 `categories` 撞名。

**坑三：分类只覆盖已策展项目。** 四条轴全部挂在 `projects` 上，所以**一个没有 `projects` 行的
仓库没有任何分类信息**——只有 `repos.description` 和 `repos.topics`。这直接决定了 §6.6 的
过滤器形状：`includeUncurated: true` 匹配到的仓库，在 payload 里必然
`categoryCode: null` / `projectTypes: []` / `capabilities: []`。

注意别把 `projectTypes` 和上面改名的 `form` 搞混：payload 里的 `projectTypes` 读的是
`projects.type`（§1.5 表格第一行，那个枚举**不改名**），`form` 才是 capabilities 的轴。
两者都会为空，但来源不同，文档里不要混用。

这不是待修的缺陷，是"分类是策展的产物"这个决定的推论，
必须在 payload 里如实反映，不能给未策展仓库编一个分类。

---

## 2. API 创建与签发

### 2.1 为什么不用单token

现有 `CONSOLE_API_TOKEN` 能回答"能不能调"，但回答不了：

- **谁在调** —— 泄漏后无法定位来源，也无法只吊销受影响的调用方。
- **能调什么** —— 读仓库和创建仓库共用一个凭据，权限无法分层。
- **配额归谁** —— 限流、审计、账单都需要一个主体。

同时 §1.1 里 `apps/web` 是唯一的计划消费方，若它需要轮换凭据，共享单 token 会让轮换变成一次
全站风险操作。

### 2.2 表结构

`0015_api_keys.sql` 已经建出下表的前 15 列。本节新增 3 列（`user_id` / `tier` /
`last_rotated_at`），走 `0022`。

```sql
-- 0015_api_keys.sql（已落地） + 0022_api_key_ownership.sql（本文新增）
CREATE TABLE "api_keys" (
  "id"             text PRIMARY KEY,
  -- 只存 sha256(明文)，明文仅在创建响应里出现一次。
  -- 与 docs/design/API_KEY_LITELLM_PROXY.md 的 api_keys.key 同一做法。
  "key_hash"       text NOT NULL,
  -- 明文的前 8 字符，用于 UI 展示和人工比对，不足以被用来鉴权。
  "prefix"         text NOT NULL,
  "name"           text NOT NULL,

  -- ①【新增】**归属人**：这把 key 是谁的，"我的 API Key" 列表按它过滤。
  -- NULL = 没有人类主人的接入方 key（web 后端的服务 key）。
  -- CASCADE 而不是 SET NULL：账号没了，"我的 key" 就不该留下一把无人能吊销的钥匙。
  -- 代价是审计线索随账号一起消失，因此 §2.13 的审计日志必须用不带级联的纯文本列。
  "user_id"        text REFERENCES "user"("id") ON DELETE CASCADE,

  -- ②【新增】配额档位。**不是权限**——权限只看 scopes；tier 只决定 rate_limit 的默认值与
  -- 自助签发时被允许勾选的范围。给这两个东西一个字段会制造"升级 tier 就能越权"的错觉。
  "tier"           text NOT NULL DEFAULT 'user',   -- user | service

  -- 归属账号 = 谁签发了这把 key。console 自己的 user 表，不对外暴露。
  -- 自助签发时 user_id = created_by；admin 签发给别人时两者不同。
  "created_by"     text REFERENCES "user"("id") ON DELETE SET NULL,
  -- 该key 提交仓库时，userRepos 记谁。用它，repos.created_by 不动。
  "submitter_id"   text REFERENCES "user"("id") ON DELETE SET NULL,
  "scopes"         text[] NOT NULL,
  "rate_limit_rpm" integer NOT NULL DEFAULT 60,
  "rate_limit_rpd" integer NOT NULL DEFAULT 5000,
  -- ③【新增】最后一次轮换的时间。与 created_at 的差就是"这把 key 用了多久没换"。
  "last_rotated_at" timestamp with time zone,
  "expires_at"     timestamp with time zone,
  "revoked_at"     timestamp with time zone,
  "revoked_reason" text,
  "last_used_at"   timestamp with time zone,
  "created_at"     timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"     timestamp with time zone
);
CREATE UNIQUE INDEX "api_keys_key_hash_idx" ON "api_keys" ("key_hash");
-- 自助签发的每一条查询都走这一条，所以它和 created_by 同级重要。
CREATE INDEX "api_keys_user_id_idx" ON "api_keys" ("user_id");
CREATE INDEX "api_keys_created_by_idx" ON "api_keys" ("created_by");
-- 列"未吊销且未过期"的 key。过期要 `IS NULL OR > now()`，因为 NULL 表示不过期。
CREATE INDEX "api_keys_active_idx" ON "api_keys" ("revoked_at","expires_at");
```

**为什么必须有 `user_id`，现有两列都不够**（这是自助签发的唯一 schema 阻塞点）：

| 列 | 回答的问题 | 为什么不能当归属 |
|---|---|---|
| `created_by` | 「谁**签发**了这把 key」 | admin 给别人签发时，签发者是 admin、主人是别人。自助签发一旦打开，两者恒等，这个歧义才会暴露 |
| `submitter_id` | 「提交仓库时 `user_repos` 记谁」 | 完全另一个问题。一把 key 可以 `submitter_id = NULL`（不归属任何账号），也可以与主人不同 |
| `user_id`【新增】 | 「这是**谁的** key」 | — |

`packages/db/src/auth-schema.ts:237` 里 web 侧的 `api_keys` 早就有 `userId NOT NULL`，
`apps/web` 的 `listApiKeys` 因此是一行 `eq(apiKeys.userId, ctx.user.id)`。console 这张表
在只有 admin 签发的年代把归属隐含在 `created_by` 里，那个隐含在自助签发下会立刻失效。

`key_hash` 用 **sha256** 而不是 bcrypt / argon2，与 `API_KEY_LITELLM_PROXY.md` 保持一致：
key 是高熵随机串，不需要抗离线爆破的可逆性检查；用慢哈希会让每次 API 调用都付出百毫秒级延迟。
这里防的是"数据库泄漏后直接拿到明文"，不是"防猜"。

`tier` 的两个取值与默认值：

| tier | 谁签发 | 默认 rpm / rpd | 自助可勾选的 scopes |
|---|---|---|---|
| `user` | 用户自己在 `/console/api-keys` 签发；或 admin 代签发并指定 `user_id` | 30 / 1000 | `repos:read`、`repos:write`、`rankings:read`（§2.10） |
| `service` | 仅 admin，**必须** `user_id IS NULL` | 60 / 5000 | 全部 4 个（§2.12） |

`tier = 'service'` 且 `user_id IS NOT NULL` 视为非法组合，服务层直接拒绝。
理由：一旦允许"服务 key 也有主人"，管理员端就会出现两套互相重叠的过滤维度
（按 owner 查、按 tier 查），而两者的交集语义说不清。**有主人 ⇒ user tier，无主人 ⇒ service tier。**

### 2.3 明文格式与生成

```
mcp_radar_<prefix>_<secret>
         ~~~~~~~~  ~~~~~~~~~~~~~~~~
         展示用     一次性返回的机密部分
```

- `secret` = `randomBytes(32).toString("base64url")`（256 bit 熵）
- `prefix` = `randomBytes(3).toString("base64url")`（4字符），用于 `api_keys.prefix`
- 明文整体再做一次 `sha256` 存 `key_hash`

前端必须按 `sk-` 之外的惯例自行剥前缀。**约定：Bearer 值就是完整明文，不带 `Bearer ` 之外的任何包装**。

### 2.4 签发入口：自助 + 管理员

签发本身**不是**开放 API —— 否则任何人都能给自己发 key。签发走 console 的 tRPC，
但分成两个入口，**按角色分开**：

```
// ── 用户自助：只管"我自己的" ─────────────────────────────
apiKeys.listMine     protectedProcedure   // 只返回 user_id = 我
apiKeys.createMine   protectedProcedure   // scopes ⊆ SELF_SERVICE_SCOPES，tier 强制 'user'
apiKeys.revokeMine   protectedProcedure
apiKeys.rotateMine   protectedProcedure

// ── 管理员：管所有人的 ─────────────────────────────────────
apiKeys.list         protectedProcedure   // 角色推进 WHERE，见下
apiKeys.create       adminProcedure       // 任意 scopes、任意 tier、可指定 user_id
apiKeys.revoke       adminProcedure
apiKeys.rotate       adminProcedure
apiKeys.updateScopes adminProcedure       // 【新增】调整权限，§2.12
apiKeys.updateLimits adminProcedure       // 【新增】调整限流
apiKeys.surrender    protectedProcedure   // 放弃自有 key 的所有权，改由 admin 接管
```

#### 页面路由：`/console` 而不是 `/dashboard`

这是一个硬约束，不是偏好。**两个 layout 各自把对方角色重定向走**，路由树因此被切成互斥的两半：

| Layout | 判据 | 允许的角色 |
|---|---|---|
| `src/app/[locale]/dashboard/layout.tsx:35` | `if (!isAdmin(user)) redirectTo(Routes.console)` | **仅** `role === "admin"` |
| `src/app/[locale]/console/layout.tsx:31` | `if (isAdmin(user)) redirectTo(Routes.dashboard)` | **仅** `role !== "admin"` |

两侧都先 `if (!user) redirectTo(Routes.signIn)`。`src/lib/auth/role.ts:65` 的 `landingPathFor`
把同一个二分法收敛成"登录后去哪"：admin → `/dashboard`，其他 → `/console`。

`src/lib/routes.ts` 的注释记录了一个已经踩过的坑，值得照着做：它把 `/settings` 提升为
顶层路径而不是 `/console/settings`，理由是"两个 console layout 都会把对方角色重定向走，
只存在于 `/console` 下的设置页对管理员就不可达"。同理，**`/console/api-keys` 对管理员
也是不可达的** —— 所以管理员要看到全部 key，必须有 `/dashboard/api-keys`，不能指望一个页面通吃。

（`src/proxy.ts:99` 的 matcher 排除了整个 `api`，所以以上 layout 对 `/api/*` 一律不生效，
每个 API 路由得自己鉴权 —— 见 §7。）

管理员**进不去** `/console`，普通用户**进不去** `/dashboard`。所以自助页只能是
`/console/api-keys` 和 `/console/subscriptions`；管理员的全局视图是
`/dashboard/api-keys` 和 `/dashboard/subscriptions`。

两个页面**共用同一个组件**，因为它们背后是同一条查询（下面解释）：

| 页面 | 渲染 | 查询 |
|---|---|---|
| `/console/api-keys` | 我的 key | `apiKeys.listMine` |
| `/dashboard/api-keys` | 全部 key（owner / tier / 状态可筛选）+ 我的 key 分区 | `apiKeys.list` |

#### `apiKeys.list` 为什么是 `protectedProcedure` 而不是 `adminProcedure`

这是照抄 `repos.list`（`src/lib/trpc/routers/repos.ts:103-111`）的做法：
**中间件只回答"你登录了吗"，"你能看哪些行"由查询自己按角色推进**，于是管理员和用户
共用一条查询，不会出现两份逻辑各自漂移。

```ts
// repos.ts:103-111 的既有模式（示意，非逐字）
const conditions: SQL[] = []
if (!isAdmin(ctx.session.user)) {                             // :109
  conditions.push(eq(repos.createdBy, ctx.session.user.id))   // :110
}
```

`apiKeys.list` 同构，并额外提供 `filter.userId` / `filter.tier` / `filter.onlyActive` / `filter.search`
（`search` 匹配 `name` / `prefix`）。**非管理员调用时这些 filter 全部忽略**，无条件退回
`user_id = 我`，即使用户显式传了 `filter.userId = <别人>`。

`updateScopes` 是 `adminProcedure`，但**不能只靠中间件**：见 §2.5 的服务层授权说明。

### 2.5 scope 枚举

| scope | 允许 | 自助可勾选 |
|---|---|---|
| `repos:read` | `GET /api/v1/repos*`、`GET /api/v1/repos/{id}/stats` | ✅ |
| `repos:write` | `POST /api/v1/repos` | ✅ |
| `projects:write` | `POST /api/v1/projects` | ❌ 需管理员授予 |
| `rankings:read` | `GET /api/v1/rankings/*` | ✅ |
| `subscriptions:write` | `/api/v1/subscriptions` 的全部方法 | ❌ 需管理员授予 |

scope 是**加法**的：`repos:read` 不含 `repos:write`，`subscriptions:write` 不隐含任何读权限。
一条 key 想读又想订阅，就得显式列两个。

`repos:write` 与 `projects:write` 的分界就是 §1.4 本身，而且是**两个 scope 而不是一个端点上的
一个字段**：登记只写 `repos` / `user_repos`，策展会在 `projects` 上建行，而建行就是公开发布。
把 `type` 做成 `POST /api/v1/repos` 的可选字段，等于让"顺手就发布了"继续是默认行为——
那正是 §12.2 要删掉的东西。所以登记端点明确拒绝带 `type` 的 body（`400 type_not_accepted`）
并指向 `/api/v1/projects`。

订阅隐含的读能力由服务端按订阅的 `scopes` 自行读库，**不复用调用方的 key** —— 见 §5.3。

`SELF_SERVICE_SCOPES = ["repos:read", "repos:write", "rankings:read"]`。

三个勾选项的选择理由，逐个说清：

- **`repos:read` / `rankings:read` 允许**：只读公开或自己可见的数据，没有副作用。
- **`repos:write` 允许**，尽管它是个写 scope —— 因为它**不授予任何用户现在没有的能力**：
  `POST /api/v1/repos` 与已有的 `repos.create`（`protectedProcedure`）走同一条
  `upsertRepo` + `linkUserToRepo`，而按 §1.4 提交**不会**自动发布。拒绝它等于要求用户
  先去找管理员，才能做他在 console 里本来就能做的事。
- **`projects:write` 不允许自助勾选**，因为按 §1.4 它就是"把任意仓库推上公开站"的权限。
  `repos:write` 可以给是因为它不写公开面（`apps/web` 的创作者流程要发布，所以它拿的是
  `projects:write` 而不是 `repos:write`）。
- **`subscriptions:write` 不允许自助勾选**，因为它等价于一个通用爬取原语：
  `createSubscription` 允许任意 `callbackUrl` + 任意 filter（含 `includeUncurated: true`），
  意味着持有者可以订阅"全部仓库的每日统计"并把它们推给自己的服务器。
  这些数据本身公开（公开面就是 `projects`），但这让每个账号都能当爬虫用。
  用户自己订阅走 `/console/subscriptions` 的 cookie 会话 + tRPC，**不需要这个 scope**；
  只有"某个外部工具代表我管理订阅"这种少数场景才需要，而管理员可以在签发时单独授予。

#### 授权必须在服务层，不能只在中间件

现有 `src/lib/api/keys.ts` 里的 `issueApiKey` / `rotateApiKey` / `revokeApiKey` /
`findApiKeyByPlaintext` **一行授权判断都没有**，唯一的一道门在 router 里。
这是 admin-only 时代留下的形状（`adminProcedure` 之后还要什么？）。

把 `createMine` 写成 `protectedProcedure` 会直接踩到它：**任何登录用户都能给自己签发任意 scopes
和无限额**。所以 `createMine` 必须显式做三件事，`adminProcedure` 之后省略前两件：

```ts
// 1) scopes 子集：服务层强制，不信任 router 传进来的值
assertScopesSubset(input.scopes, SELF_SERVICE_SCOPES)
// 2) 归属由服务端决定：user_id 和 submitter_id 都取会话，不接受客户端指定
{ user_id: ctx.session.user.id, tier: "user",
  created_by: ctx.session.user.id, submitter_id: ctx.session.user.id }
// 3) 配额收窄：忽略 input.rateLimitRpm / rateLimitRpd，用 TIER_DEFAULTS.user
```

**第 2 条是防越权的关键**：现有 `apiKeys.create` 的输入里有
`submitterId: z.string().nullable().optional()`（§2.4 旧版）。自助入口**必须把这个字段从
输入里拿掉**，否则任何用户都能签发一把 `submitter_id = <受害者>` 的 key，
用它提交的仓库全部记到别人名下 —— 这是可被用来污染他人 `user_repos` 与雷达数据的提权。
同理 `user_id` 绝不能出现在自助入口的输入 schema 里。

`repos.create` 已经有同一条经验，而且它的注释把理由写得更狠（`repos.ts:427-444`）：
`setRepoCreatedBy(ctx.db, row.id, ctx.session.user.id)`（`:433`）与
`linkUserToRepo(ctx.db, { userId: ctx.session.user.id, ... })`（`:441-444`）都直接从会话取值，
**`userId` 根本不出现在输入 schema 里**；旁边的注释解释了为什么必须是会话值 ——
"把同一个 URL 再粘一次不得转移归属"。自助 key 的 `user_id` / `submitter_id` 沿用这个形状。

### 2.6 请求鉴权流程

```ts
// apps/console/src/lib/api/guard.ts（新增）
export type ApiKeyPrincipal = {
  keyId: string
  scopes: ReadonlySet<ApiScope>
  submitterId: string | null
}

export async function authenticateApiKey(request: Request): Promise<
  { ok: true; principal: ApiKeyPrincipal } | { ok: false; response: Response }
>
```

顺序（任一步失败立即返回，不继续查库）：

> ✅ **本节 1–7 步已实现于 `apps/console/src/lib/api/guard.ts:142-220`**，与下表逐条一致
> （含第 3 步的 404 fail-closed、第 6 步的 `WWW-Authenticate`）。第 8 步只有前半。

1. 取 `Authorization: Bearer <明文>`。缺失/格式错 → 401。（`guard.ts:57`，RFC-6750 大小写不敏感）
2. `sha256(明文)` → 查 `api_keys.key_hash`。（`keys.ts:211`）
3. 查不到 → **404**（不是 401）。与现有 `apiToken()` 的 fail-closed 一致：
   一个没配置凭据的实例不该通过 401 vs 404 的差别告诉攻击者这条路由存在。（`guard.ts:161-167`）
4. `revoked_at IS NOT NULL` → 401 `key_revoked`。（`guard.ts:169`）
5. `expires_at < now()` → 401 `key_expired`。（`guard.ts:178`）
6. `scopes` 不含所需 scope → 403 `insufficient_scope`，并带 `WWW-Authenticate:
   Bearer error="insufficient_scope"`。（`guard.ts:188-198`）
7. 限流（§2.8）：先过每分钟窗口，再过每日窗口。超限 → 429 + `Retry-After`。（`guard.ts:200`）
8. 通过后更新 `last_used_at`（异步、不阻塞响应、失败只记日志）✅ 已实现（`guard.ts:209`），
   并把 `api_keys.id` 记入审计日志 ❌ **未实现，console 目前没有审计日志的写入方**。

第 8 步的后半是一个真实缺口，不只是"少个功能"：`last_used_at` 只记录"这个 key 最近用过"，
**不记录"谁在什么时候调了哪个接口"**。而 §2.1 列的三个理由里，第一个就是"泄漏后无法定位来源"。
没有审计日志，`revoke` 之后无法回答"过去 30 天这个 key 调过哪些仓库"，这恰好是凭据泄漏时
唯一真正需要的信息。

**这一期补上，但只补变更、不补每次读**：`api_request_audit` 表与写入点在 §2.13。
不记录每次 GET 是刻意的 —— `last_used_at` 已经回答了"是否在用"，
而每次读都写审计会让这张表变成第二张 `repo_daily_stats`。

另外 `ApiKeyPrincipal` 需要多一个字段：自助签发之后"这次调用算谁的"不能再靠猜。

```ts
// 上面的定义改为
export type ApiKeyPrincipal = {
  keyId: string
  scopes: ReadonlySet<ApiScope>
  /** 归属人。self-service key 有值；service key 为 null。 */
  userId: string | null
  /** 提交仓库时 userRepos 记谁。与 userId 是两件事。 */
  submitterId: string | null
  /** 配额档位，只影响 §2.8 的默认值回填，不参与任何鉴权判断。 */
  tier: "user" | "service"
}
```

`userId` 不参与 `authenticateApiKey` 的任何判断（它不是 scope，也不是租户边界 ——
租户边界由 §6.1 的 CHECK 约束和 `subscriptions` 归属负责）。它只是被带出来给
审计与统计用。把 `userId` 加进鉴权逻辑会立刻引入"admin 代签发的 key 归属谁"这类问题，
而那属于 §6.7 的归属问题，不属于凭据校验。

### 2.7 吊销与轮换

- **吊销**：`revoked_at` 置位，立即生效（下一个请求就 401），无缓存可清。
  自助入口是 `revokeMine`（只能吊销 `user_id = 我`），admin 入口是 `revoke`。
- **轮换**：`rotate` / `rotateMine` 创建一个 `scopes` / `rate_limit_*` 相同、
  `revoked_at` 已置位的新 key，返回新明文一次。旧 key 立即死。
  理由：轮换不应该需要"先创建新的、再手工删旧的"，那个中间窗口会让两个有效凭据同时存在。
- **自助轮换**额外写 `last_rotated_at`（§2.2 新增列），因为自助轮换的动机与 admin 不同：
  admin 轮换是运维动作，自助轮换是用户看到"这把我用了两年了"的提示之后点的，
  而"用了多久没换"正是提示本身要算的数。这列只服务这一个 UI，不参与鉴权。
- **自助入口没有"改归属"操作**：`user_id` 一旦签发就是固定的。
  换主人只有两条路 —— admin `revoke` 旧的再 `create` 一把新的（`tier: "user",
  userId: <新主人>`，§2.12），或者用户先 `surrender`（§2.4）放弃所有权再让 admin 重签。
  刻意**不提供** `updateOwner` 这种"直接转移归属"的 mutation：转移让原主人和新宿主
  在同一瞬间都能吊销这把 key，而 `revoke + create` 的中间窗口里凭据是明确的
  "旧的已死、新的还没生效"。

### 2.8 限流：本地 Redis + Vercel Upstash

**先说清楚为什么不能靠进程内计数。** Vercel 的函数实例是按流量冷启动、无状态的：
同一个 key 的连续两次请求很可能落在两个不同实例上，进程内窗口等于每个实例各发一份配额。
再叠上 `notify-subscriptions` 这个任务——它本身就要防多实例并发执行同一个 sweep——
单实例假设已经不成立了。所以限流和分布式锁一起上 Redis。

**驱动选择按环境变量决定，两者实现同一个接口：**

| 变量 | 场景 | 客户端 |
|---|---|---|
| `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` / `REDIS_DB`，或 `REDIS_URL` | 本地开发 / 自建 | `ioredis`（console 已在依赖里，见 `packages/sms-captcha/src/server/redis.ts` 的同一套约定） |
| `KV_REST_API_URL` + `KV_REST_API_TOKEN` | Vercel | `@upstash/redis`（需新增依赖） |

沿用 monorepo 已有的 `REDIS_HOST`/`REDIS_PORT`/`REDIS_PASSWORD`/`REDIS_DB` 命名而不是新造
`REDIS_URL`，是为了让 console 和 `@workspace/sms-captcha` 用同一份本地 Redis 配置；
`REDIS_URL` 额外支持，因为托管 Redis 通常只给一个连接串。

`KV_REST_API_*` 存在时优先使用 Upstash；两者都没有时，限流降级为进程内窗口并**打一条
`logger.warn`**——本地开发不该因为没起 Redis 而 503。

```ts
// apps/console/src/lib/redis/client.ts（新增）
export interface RedisLike {
  eval<T = unknown>(script: string, keys: string[], args: string[]): Promise<T>
  set(key: string, value: string, opts?: { nx?: boolean; px?: number }): Promise<"OK" | null>
  del(key: string): Promise<number>
}
```

只暴露三个原语。刻意不暴露整个 redis 客户端：接口越小，两种驱动的行为差异越无处藏身，
将来换驱动的成本也就越低。`@upstash/redis` 的 `eval(script, keys, args)` 与 node-redis 的
`eval(script, { keys, arguments })` 签名不同，在这层抹平。

**滑动窗口用一段 Lua，一次往返完成"清理 + 计数 + 判定"。** 多条命令（`ZREMRANGEBYSCORE`
→ `ZCARD` → `ZADD`）分开发会有竞态：一个并发的请求会在 `ZCARD` 之后、`ZADD` 之前
数到一个偏小的值，于是两个请求都以为自己还在配额内。Lua 脚本在 Redis 里是原子的，
所以本地和 Upstash 都能跑同一段。

```lua
-- apps/console/src/lib/redis/lua/sliding-window.lua
-- KEYS[1] = 窗口 zset 的 key
-- ARGV[1] = now (ms)   ARGV[2] = window (ms)   ARGV[3] = member (唯一)
-- ARGV[4] = limit      ARGV[5] = ttl (s)
local key, now, window, member, limit, ttl =
  KEYS[1], tonumber(ARGV[1]), tonumber(ARGV[2]), ARGV[3], tonumber(ARGV[4]), tonumber(ARGV[5])
redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window)
local used = redis.call('ZCARD', key)
if used >= limit then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local retryAfterMs = window
  if oldest[2] then retryAfterMs = (tonumber(oldest[2]) + window) - now end
  return { 0, used, retryAfterMs }
end
redis.call('ZADD', key, now, member)
redis.call('EXPIRE', key, ttl)
return { 1, used + 1, 0 }
```

返回三元组 `{allowed, used, retryAfterMs}`，两个驱动都原样透传，因此限流判定逻辑
只需要写一次、测试一次。

`member` 用 `apiKeyId + ":" + 一个每次请求唯一的值`。若用 `apiKeyId` 本身，
同一 key 的并发请求会写同一个 member，`ZCARD` 少算、限流失效。

**两个窗口：**

| 窗口 | key | limit | TTL |
|---|---|---|---|
| 每分钟 | `rl:rpm:<apiKeyId>:<YYYYMMDDHHMM>` | `api_keys.rate_limit_rpm` | 120s |
| 每日 | `rl:rpd:<apiKeyId>:<YYYYMMDD>` | `api_keys.rate_limit_rpd` | 172800s |

每日窗口用固定窗口（key 里带日期）而不是滑动窗口：跨天的限流用不着秒级精确，
而固定窗口少一次 Lua 调用、key 可以自然过期、不需要清理。

**Redis 不可用时的行为：fail-open。** 拿到限流结果超限以外的异常（连接失败、超时、
脚本报错），一律放行并打 `logger.warn`。理由：限流是保护措施，不是正确性措施——
Redis 抖一下就让整个 API 变成 500，是拿可用性换了一个本来就不是安全边界的功能。
真的需要硬边界的地方（比如防止暴力尝试）应该单独走一条 fail-closed 路径，
而不是让所有读接口一起被拖垮。

**分布式锁（同一套 Redis）：** 本文设计

```
SET notify-subscriptions:lock <instanceId> NX PX 900000
```

但**现有任务框架用的是数据库锁，不是 Redis 锁**：`tasks/runner.ts:185` 调
`acquireTaskLock(...)`，抢不到就记 `skipped` / `task.alreadyRunning`（`runner.ts:198-208`）。
`lib/redis/lock.ts` 已经把锁写好了（`acquireLock` / `withLock`，含 CAS 释放与 TTL 续期，
有测试），但**全仓零生产调用方**。

所以落地时要拍的是**一道还是两道**，不是"用不用 Redis"：

| 选项 | 代价 |
|---|---|
| 只用 DB 锁（改设计） | 删掉 §2.8 这段和 `lock.ts`。DB 锁已经覆盖了多实例并发，代价是没有 TTL 自动释放，实例被杀时锁要靠人工/超时清理 |
| 只用 Redis 锁（改 runner） | 让 runner 支持"这个任务用 Redis 锁"。锁有 TTL 自动释放，但多一处机制要维护 |
| 两层都留（本文早期写法） | 没人说得清哪道生效。**不推荐** |

若选 Redis：`notify-subscriptions` 拿到锁才跑，跑完释放。900s 是任务最长预估时长的 1.5 倍；
超时自动释放，避免实例被杀后锁永远不还。
这个锁和 `task_alreadyRunning` 是**两层**，不冲突：前者防跨实例，后者防同一实例内的重入。

### 2.9 第三方接入的形态

保留 `mode: "snapshot"`（§6.4）——第三方接入是已知方向，`batch` 的水位线语义对
"只要一份当前快照"的接入方是纯粹的负担。

配套的三件事：

1. **`GET /api/v1/openapi.json`** 生成完整 spec，由 zod schema 单一来源产出（§8）。
2. **分层的 rate limit**：第三方默认比内部 key 更严，由 `tier` 决定默认值（§2.2），
   而不是让每个 key 手填数字。
3. **key 的自助签发还是 admin 签发** —— **已决定**：用户自助签发自己名下、限定 scope 子集
   （§2.10），接入方走注册 + 配对（§2.11）。

### 2.10 用户自助签发与滥用防护

自助签发把"能拿到 key"这件事从管理员身上移走，于是防护必须落在别处。
§2.8 已经把"读接口 fail-open 对、滥用控制必须另走 fail-closed"这个分界写清楚了；
本节是那条分界落到具体三个 limiter 上的结果。现有代码里有三个东西**恰好就是 fail-open**，
直接复用会让自助签发变成一个放大器。

#### 现有 limiter 全部 fail-open，不能用于"防止自助滥用"

| limiter | 失败时的行为 | 代码 |
|---|---|---|
| API key 限流 / 日配额 | Redis 不可用 → **放行**，只 `console.warn` | `src/lib/api/rate-limit.ts:66-72`，warn 文案就是 `"API rate limiter unavailable, failing open"` |
| 认证 / 邮件码限流 | 同上 | `src/lib/rate-limit.ts:44-46,66-67`，warn 文案 `"Redis rate limiter unavailable, failing open"` |
| 验证码重发冷却 | `if (!redis) return true` → **永远放行** | `src/lib/auth/otp-store.ts:167-176` |

**第三条最值得注意**，因为它正是防"批量申请验证码"的闸门，而它在没有 Redis 时**恒真**。
`claimSlot` 的原语是对的（`redis.setIfAbsent` = `SET NX PX`，见 `otp-store.ts:170-174`），
错的只是默认值。

对**读接口** fail-open 是合理的取舍：Redis 抖动时让用户能继续看数据。但"一个账号能不能再申请
一把 key"、"这台 IP 能不能再兑一次配对码"是**滥用控制**，fail-open 的语义正好相反 ——
Redis 一挂，限制消失，当天签发量翻倍。所以自助路径**不共用**上述任何一条，而是走新的、
**fail-closed** 的路径：

```ts
// 失败时拒绝，而不是放行。这是它与 checkKeyRateLimit 唯一的区别。
async function assertSelfServiceQuota(db, userId): Promise<void>
```

#### 三层防护，全部在签发这一刻生效

| 层 | 限制 | 为什么要 |
|---|---|---|
| 1. 前置条件 | `user.emailVerified === true` 才允许签发 | better-auth 已配 `requireEmailVerification: true`（`apps/console/src/lib/auth.ts:65`），session 在验证前就已存在，所以这道门要显式写。挡住批量小号 |
| 2. 冷却 | 同一用户两次自助签发间隔 ≥ 60s | 复用 `OtpStore.claimSlot` 的原语（`redis.setIfAbsent` = `SET NX PX`），但**把默认值反过来** |
| 3. 存量上限 | 同一用户未吊销的 key ≤ 5 | DB 计数。`src/lib/radar/decisions.ts:32` 的 `MAX_CANDIDATES = 5` 是同量级先例，其上限判断在 `:219-223` |

冷却这一条直接抄 `claimSlot` 是不行的：`src/lib/auth/otp-store.ts:169` 写着
`if (!redis) return true`，也就是**没有 Redis 就恒真**。所以要另写一个
`assertSelfServiceQuota` 专用的变体，把那一行改成 fail-closed。
这属于"把既有代码反过来用"，因此必须在注释里写明这个 `claimSlot` 的语义与验证码那个
**相反** —— 否则下一个人会"顺手统一"回去。

存量上限必须在**插入的同一事务内**做计数，不能"先 count 再 insert" —— 那是 TOCTOU，
并发两个请求都能看到 4 把自己就都通过了。做法是同一事务里
`SELECT count(*) ... FOR UPDATE` 或者依赖 `(user_id)` 索引上的行锁。

#### 已经有的等价防线

自助 `repos:write` 不构成新能力（§2.5 已论证），所以这一层不需要额外限流；
签发频率交给上面两层。

### 2.11 接入方注册与配对（`apps/web` 的接入路径）

产品要求：**接入方必须先注册，创建 key，然后才能正常调用 console 的 API**。
这条要求真正要解决的是一个鸡生蛋问题 —— 注册和创建 key 本身都需要凭据，
而接入方此时还没有凭据。

#### 为什么不能靠"web 有自己的 api_keys 表"

`packages/db/src/auth-schema.ts:237` 确实给 web 建了一张 `api_keys` 表（`userId NOT NULL`），
`apps/web/src/app/[locale]/(protected)/(console)/dashboard/apikeys/page.tsx` 也在发 key。
但那张表**与 console 的 `api_keys` 毫无关系**：不同的库、不同的 `user` 表、
不同的鉴权代码。**web 的 key 不能调 console 的任何接口**，服务把两者区分得毫无痕迹，
这是最危险的一种状态 —— 用户会以为它能用，直到第一次 401。

两份 API Key 表面看起来是同一件事，其实是两个产品。文档必须显式承认这一点，
否则下一个人一定会把它们合并，然后顺手造出跨库读 `user` 表的东西。

#### 配对流程

采用**从 console 侧发起**的配对，而不是让 web 主动来注册。理由：发起方向决定了
"哪一侧需要凭据"。web 反过来发起就需要一个已经存在的 key，而那个 key 正是我们要发的东西。

```
用户(web)                     console                      web 后端
   │                             │                             │
   │  用户登录 /console/connections，建一把配对码  │             │
   │────────────────────────────▶│                             │
   │                             │                             │
   │  console 显示配对码 + 该码的 scopes + 兑换方法说明         │
   │◀────────────────────────────│                             │
   │                             │                             │
   │  把配对码粘回 web ───────────────────────────────────────▶│
   │                             │◀── 用配对码兑换 ─────────────│
   │                             │   POST /api/v1/connections/redeem
   │                             │   { code, returnUrl }
   │                             │      （无需凭据，见下）      │
   │                             │── 返回明文 key ─────────────▶│
   │                             │   （同时写入该码的 api_key_id）│
```

兑换端点 `POST /api/v1/connections/redeem` 是**唯一**一个不需要凭据的 `/api/v1` 端点，
安全边界完全等于 OAuth device flow，因此这几个约束是必须的而不是可选的：

| 约束 | 值 |
|---|---|
| 配对码 | 8 字符、无 `0O1I` 歧义字符；单次有效；TTL 5 分钟 |
| 绑定 | **兑换时**才签发 key，因此绑定的是 `(code, scopes 快照, returnUrl, userId)`；`api_key_id` 在兑换成功后回填 |
| 兑换校验 | 码有效 + 未用过 + 未过期 + `returnUrl` 精确相等（不是前缀相等） |
| 限流 | 按 IP，**fail-closed**，复用 `claimSlot`；单 IP 每小时 20 次 |
| 明文 | 只在兑换响应里出现一次；不写日志（§2.13） |

兑换端的失败语义分成两类，因为两类的信息量不一样：

| 情况 | 响应 | 为什么能/不能分开 |
|---|---|---|
| 码不存在 / 已用过 / 已过期 / `returnUrl` 不匹配 | 全部 `404 not_found` | 分开报就是给探测者的二分枚举 oracle；攻出一个还没用的码 = 拿到一把 key |
| 单 IP 超 20 次 | `429 rate_limited` + `Retry-After: 3600` | **本地**计数，与那个码存不存在无关 |
| 码主人 key 存量已满 | `403 quota_exceeded`，**无** `Retry-After` | 只在码通过全部校验之后才可能出现，泄漏的是"主人存量满了"而不是"码存在"。上限要主人去 `/console/api-keys` 撤销一把 key 才会动，所以不给一个不会兑现的重试时间 |

**为什么是兑换时才签发**，而不是建码时就签好（这是与初版设计不同的一处）：建码时签发
意味着 `connection_pairings` 要存一把**未交付**的明文 key，而那把 key 在建码到兑换之间
对任何人都没有用处，却能被任何能读到这张表的人拿走。改成兑换时签发之后，明文的生命周期
被压缩到"兑换响应本身"这一瞬间，与 `api_keys` 侧"明文只在签发响应里出现一次"的规则
（§2.3）一致，代价是 `api_key_id` 列可为 `NULL`——而它本来就在"兑换前无意义"的那一侧。

**兑换方拿到的 key 是 `user` tier。** 所以它带 §2.5 的自助子集 scope、`rpm=30 / rpd=1000`
配额（§2.10，取自 `TIER_DEFAULTS.user`，与 `selfServiceRateLimits()` 同源），且 `user_id` 等于
建码的那个账号——服务端的调用因此会出现在该账号的"我的仓库"里。这与 §2.4 自助签发是同一
个结果，区别只有发放方式。

配对建码同样走 §2.10 里与"能发出去多少"有关的两道闸门（邮箱已验证、存量 key 上限）：配对
是发 key 的第二条路，服务端在这里不查，一个未验证的小号就能绕过自助签发拿到一把能调的
key；不查存量上限，用户可以绕过 5 把的封顶反复兑换。**刻意不搬**的是 60 秒 cooldown——
它防的是"一把 key 换一次 GitHub token"的成本，而建码不消耗任何外部配额，这里的实际
天花板是"同时 3 个待兑换码 × 5 把存量上限"，两者都是每账号计数、都不需要等时间。

**console 侧入口**（§2.11 的配套 UI，不属于 `/api/v1`）：

| 入口 | 作用 |
|---|---|
| `connections.listMine`（tRPC `protectedProcedure`） | 列出我建的、未兑换且未过期的码 |
| `connections.create` | 建码：入参只有 `name` / `scopes` / `returnUrl` |
| `connections.revoke` | 作废一个还没被兑换的码（删行） |
| `/console/connections` | 上述三者的页面；建码后一次性弹窗显示码 |

归属判断是 SQL 里的 `user_id = session.user.id`，scope 上界是 `SELF_SERVICE_SCOPES`，
页面里没有一处权限判断。**兑换端点不在这个 router 里**——那是无凭据面。

`connections.create` 的失败码映射（`CREATE_FAILURE_CODE`，三档而不是一档，因为三件事要用户
做的事不同）：

| 服务层 code | tRPC | 用户该做什么 |
|---|---|---|
| `invalid_return_url` | `BAD_REQUEST` | 改 `returnUrl` 重试 |
| `too_many_open_codes`（同时最多 3 个未兑换未过期的码） | `BAD_REQUEST` | 作废一个，或等它过期 |
| `email_unverified` | `FORBIDDEN` | 去验证邮箱——**没有**验证就绕过 §2.10 拿到能调 API 的 key，是配对这条路最大的风险 |
| `quota_exceeded` | `FORBIDDEN` | 去 `/console/api-keys` 撤销一把 |
| `scope_not_allowed` | `FORBIDDEN` | 服务层的兜底；页面已被 zod 挡在前面 |
| `generation_failed`（连续 5 次撞码） | `INTERNAL_SERVER_ERROR` | 我们的故障，重试即可；**不能**报成前两档，否则用户会去作废一个没问题的码 |

限流落在**兑换**侧（按 IP，单 IP 每小时 20 次），不落在建码侧：建码是登录态操作，已有
`MAX_OPEN_PAIRING_CODES` 与 key 存量上限两道每账号计数；真正需要防穷举的是兑换那一端，
所以 20 次的额度花在那里。

`returnUrl` 用**精确相等**而不是前缀相等：前缀匹配会让 `https://evil.com/?x=https://a.b`
通过校验，是典型的开放重定向。

**service key 走另一条路。** `apps/web` 后端之间的机器对机器调用不需要每个用户配对一次，
admin 在 `/dashboard/api-keys` 直接签发一把 `tier = "service"`、`user_id IS NULL` 的 key 即可，
这是 §2.12 的日常用法。**两条路并存**：用户归属的操作用配对得到的 `user` tier key，
后台批处理用 admin 签发的 `service` tier key。

### 2.12 管理员治理

管理员页 `/dashboard/api-keys` 与 `/dashboard/subscriptions` 的能力，与自助页的对称关系：

| 操作 | 用户（`/console`） | 管理员（`/dashboard`） |
|---|---|---|
| 看 key | 仅自己的，含明文 prefix、scopes、配额、最后使用时间 | 全部，按 owner / tier / 状态 / 关键字筛选 |
| 创建 | `createMine`，scopes ⊆ 子集，tier 强制 `user` | `create`，任意 scopes，tier 自由，可指定 `user_id` |
| 调权限 | ✗ | ✓ `updateScopes` |
| 调限流 | ✗ | ✓ `updateLimits` |
| 吊销 | 仅自己的 | 全部，`revoked_reason` 必填 |
| 轮换 | 仅自己的 | 全部 |
| 看订阅 | 仅自己的 | 全部，含两种归属（user / key） |
| 停用订阅 | 仅自己的 | 全部 ← §6.7 |

`apiKeys.create`（admin）保留现有输入：

```ts
apiKeys.create.input({
  name: z.string().min(1).max(120),
  scopes: z.array(z.enum(API_SCOPES)).min(1),
  tier: z.enum(["user", "service"]).default("service"),
  userId: z.string().nullable().optional(),      // tier=user 时可指定，替他人签发
  submitterId: z.string().nullable().optional(), // 提交仓库时记到谁名下
  expiresAt: z.coerce.date().nullable().optional(),
  rateLimitRpm: z.number().int().min(1).max(1000).optional(),
  rateLimitRpd: z.number().int().min(1).max(10000).optional(),
})
// 输出：{ id, prefix, name, scopes, ..., secret?: string }  ← secret 只在 create/rotate 出现
```

服务层强制 `tier === "service" ⟺ userId === null`，与 §2.2 的规则一致。
管理员想替某用户签发一把就传 `tier: "user", userId: <该用户>`。

`secret` 出现在响应里，也出现在该响应的 `Cache-Control: no-store` 里。之后任何读接口都不再返回它，
包括 `apiKeys.list`。

#### `updateScopes`：改权限必须立刻生效

这是管理员真正想要的"可以设置 api key 的权限"。要点有三个，缺一个就留后门：

1. **不能用缓存里的 scopes**。`authenticateApiKey` 已经每次都查库（§2.6），所以改完下一次
   请求就生效 —— 这正是想要的语义。**不要**在 `updateScopes` 后试图去清 Redis：
   key 本身不在 Redis 里缓存（Redis 只存配额计数），所以没有缓存要清。
2. **收窄和放宽要分开记录**。`revoked_reason` 那种单一字段不够用；
   复用 `api_keys` 之外没有审计表这一现实，本文在 §2.13 补一张。
3. **收窄 scopes 不等于吊销**。收窄到空集合会得到一把什么都干不了的 key
   （`authenticateApiKey` 对空 scopes 应当 403），但它仍然是"活"的，
   列表里会显示为 scopes 为空 —— 界面上要能一键理解这是被管理员收窄的结果，不是配置错误。

### 2.13 审计日志（自助签发的前提）

§10.1 已经指出 `api_request_audit` 的**声明已删除、0 行、无任何调用方**。
admin-only 时代这不紧急：谁签的 key 心里有数。开放自助签发之后，
"这个账号签了多少把 key、admin 改过谁的权限"就成了必须能回答的问题。

```sql
-- 0023_api_request_audit.sql
CREATE TABLE "api_request_audit" (
  "id"           bigserial PRIMARY KEY,
  -- 纯文本，不加外键：账号被删也要留下"当时是谁在调用"的痕迹。
  -- 这是 §2.2 里 user_id 用 CASCADE 的对价。
  "user_id"      text,
  "api_key_id"   text,
  "key_prefix"   text,
  "action"       text NOT NULL,   -- key.create | key.revoke | key.rotate | scopes.update |
                                   -- limits.update | connection.redeem | subscription.disable …
  "before"       jsonb,
  "after"        jsonb,
  "reason"       text,
  "ip"           text,
  "created_at"   timestamptz NOT NULL DEFAULT now()
);
-- admin 治理页的默认查询："这个 owner 的 key 发生过什么"
CREATE INDEX "api_request_audit_user_id_created_at_idx"
  ON "api_request_audit" ("user_id", "created_at" DESC);
CREATE INDEX "api_request_audit_api_key_id_idx"
  ON "api_request_audit" ("api_key_id");
```

三条约束：

- **不落明文**。`after` 里可以出现 scopes、配额、`revoked_reason`，**永远不能出现 secret 或
  `key_hash`**。这是这张表存在的意义，也是它容易被破坏的地方。
- **只记变更，不记每次 GET**。每次读接口调用都写审计会让这张表变成第二张 `repo_daily_stats`。
  `last_used_at` 已经覆盖了"是否在用"。
- **写审计不失败业务**。审计写入失败要 log 并继续，不能因为审计把 API 请求变成 500。

---

## 3. 仓库创建与首次拉取回调

### 3.1 复用与差异

`repos.create`（`apps/console/src/lib/trpc/routers/repos.ts:394`）已经做对了大部分事：
`parseGithubRepoUrl` → `fetchRepoInfo` → `upsertRepo` → `setRepoCreatedBy` → `linkUserToRepo`
→ `recomputePlatformStates`。

开放 API 版本**不重写这套逻辑**，而是把同一段序列抽成
`apps/console/src/lib/github/service/ingest-repo.ts` 的 `ingestRepo(db, { url, source, submitterId })`，
由 tRPC 和 REST 两条入口共用。该文件目前**不存在**（`git log --all --diff-filter=A` 为空），
ingest 逻辑现在分散在 `repos.ts:394-455` + `service/repo.ts:151-195` +
`service/user-repo.ts:53-105` + `github/repo-url.ts` 四处，所以这是一次真实的抽取。

差异只有一处：

**M2M 提交不写 `repos.created_by`。**

`repos.createdBy` 的语义是"这个仓库**第一个**被谁提交"，`/console` 的"我的仓库"列表直接过滤
这一列（`repos.ts:109-111`）。一个外部系统的 API key 不是账号，让 web 的提交在 console 里
冒名成某个用户是错的。而 `userRepos.source` 枚举里已经有 `"api"`（`apps/console/src/db/schema.ts:254`），
那才是 M2M 提交的正确落点。

若 key 带 `submitterId`，`userRepos.userId` 记该用户（前端可选择把用户提交的仓库集中到一个人名下），
`repos.created_by` 仍不动。

**M2M 提交同样不建 `projects` 行。** 这是 §1.4 那条决策的直接推论，写在这里是为了让
实现者不必回去翻 §1.4：`POST /api/v1/repos` 与 `repos.create` 的**可见性后果必须完全相同**。
一个能通过 API 把任意仓库推上公开站的接入方，和一个能通过 `/console` 做到的匿名用户是同一个
越权面，不因为它持有 API key 就更合理。`repos.create` 的返回值里带 `projectCount`
（`repos.ts:448-454`），REST 版本应当同样返回它，让接入方能明确知道"这个仓库尚未被策展"。

### 3.2 请求

```http
POST /api/v1/repos
Authorization: Bearer mcp_radar_<prefix>_<secret>
Content-Type: application/json
Idempotency-Key: <可选，客户端生成的稳定字符串>
```

```jsonc
// 形态一：给一整个地址
{ "url": "https://github.com/owner/name" }

// 形态二：给裸 slug
{ "repo": "owner/name" }

// 两个形态都可带的回调参数
{
  "repo": "owner/name",
  "callbackUrl": "https://your-service.example/hook",  // 可选
  "callbackSecret": "…"                               // 给了 callbackUrl 就必填
}
```

**三种约束，逐条都是被一次失败换来的：**

1. **`url` 与 `repo` 二选一，且只能带一个地址字段。** 两者都带会被拒（"该用哪个"），都
   不带也会被拒（"没给地址"）。
2. **`callbackUrl` 存在时 `callbackSecret` 必填。** 早期版本把它写成"缺省时用 key 派生的
   secret"（§4.3），但那条派生路径等于"只要有人知道 key 的哈希就能收回调"，而 `api_keys`
   只有 SHA-256、哈希本身就在审计可见的列里。因此取消派生：`callbackSecret` 由调用方
   提供，它至少是一次真实的双方约定。
3. **带 `type` 的请求被明确拒绝**，并返回 400 `type_not_accepted` + 指向
   `POST /api/v1/projects`。理由见 §1.4 与 §3.1：登记与发布是两个 scope，一个能通过
   API 把任意仓库推上公开站的接入方，和一个能通过 `/console` 做到的匿名用户是同一个
   越权面。答错端点比答错字段贵——调用方会拿着同一个 body 重试到底，所以这条要指向
   正确的端点，而不是让 union 的第一个校验错误把它引到别处。

**没有 `wait`、没有 `requestId`、没有异步排队。** 初版设计里的 `wait: true` 同步等首次拉取
（阻塞 30s）与 `202 queued` + `requestId` 都已移除：端点因此与 `repos.create`（§3.1）
**完全一致**，"提交后立刻看到统计"这个需求由调用方自己轮询 `GET /api/v1/repos/{id}/stats`
（§4.1）满足。一次长任务换来一个会被客户端轮询、被中间层掐断、且失败语义含糊的同步
端点，不如给一个稳定的读接口。

### 3.3 幂等

- `Idempotency-Key` 头存在时，在 `api_request_idempotency` 表记
  `(key_hash, idempotency_key, request_fingerprint, response_status, response_body, created_at)`。
  `key_hash` 是 `api_keys.key_hash` 而不是 `keyId`：一次轮换是**吊销旧行 + 签发新行**
  （`rotateApiKey`），新行有自己的 id 与 `key_hash`，所以幂等记录天然按"这把具体的
  明文"隔离——轮换后客户端拿新 key 重发同一次请求会重新执行而不是回放旧的答案。这是对的：
  旧 key 上成功的那次请求，是用另一把 key 完成的。吊销不删行也不影响回放。
- 指纹是 `sha256(method + path + 规范化后的 body)`，规范化会把对象键排序递归展开，
  因此键序不同的两次请求视为同一个。
- 同 key + 同指纹 → 回放上次响应（**状态码与响应体都取上次那一份**）。
- 同 key + 不同指纹 → `409 idempotency_key_reuse`。
- 同 key + 另一个请求仍在执行 → `409 idempotency_in_flight` + `Retry-After: 2`。
- **只记成功**。一次 400 或 503 没有"答案"，槽会被释放，于是客户端改完 body 用同一个 key
  重试是允许的——这正是 `invalid_body` 之后再占槽会毁掉的行为。
- 24 小时后过期清理。
- 未带该头时，天然幂等：`upsertRepo` 本身按 `(owner, name)` 冲突更新，重复提交同一地址
  只是刷新。所以**不带该头也不会产生重复行**，只是响应里的 `created` 字段会从 `true`
  变成 `false`。

**已知边界**（照实写在这里，而不是留给下一个人发现）：

- 预占与业务写入不在一个事务里。进程在"仓库已落库"与"响应已记住"之间崩溃，会留下一行
  `in_flight`，此后该 key 的重试一直被 `idempotency_in_flight` 挡住。要彻底消除需要把
  业务写入和幂等行放进同一个事务，或给 `in_flight` 加租约超时；两者都超出当前端点的
  事务边界（`ingestRepo` 会调 GitHub HTTP，见 §3.1）。
- 指纹不做语义归一：`{"repo":"owner/name"}` 与 `{"url":"https://github.com/owner/name"}`
  会得到两个不同的指纹。它们确实是**不同的请求体**，所以这不是 bug，只是同一个意图的
  两种写法要用两个 key。
- `response_body` 存的是 JSONB，回放时重新序列化，因此键序可能与首次响应不同。语义
  一致，不是逐字节一致。

### 3.4 响应

```jsonc
// 201：本次新登记
{
  "ok": true,
  "repo": { "id": "V1StGXR8Z5jd", "full_name": "owner/name", "stars": 1234 },
  "created": true,
  "projectCount": 0
}

// 200：这个仓库本来就在跟踪里，本次只是刷新
{
  "ok": true,
  "repo": { "id": "V1StGXR8Z5jd", "full_name": "owner/name", "stars": null },
  "created": false,
  "projectCount": 2
}
```

`stars` 为 `null` 表示尚未采集到（§4.1 之后才有值）；`projectCount` 非零意味着这个仓库
先前被策展过（§1.4），与 `repos.create` 的返回一致（`repos.ts:448-454`）——调用方据此
知道"这个仓库已经在公开站上，type 会被忽略"。

没有 `status` 字段：同步成功没有状态可报，而失败的形态是 HTTP 4xx/5xx + 错误体。

**回放时的状态码**：幂等回放**原样返回首次的状态码**，所以一次新登记（201）的重试拿到的
仍是 201 而不是 200。调用方因此不能靠状态码区分"这次真的登记了"与"这次回放了"——要区分
就看 body 里的 `created`（首次新登记为 `true`）或者干脆带上自己的 `Idempotency-Key`。

### 3.5 登记回调

`callbackUrl` 给了就在登记成功后回调一次。**注意语义**：登记是「请求返回时数据已经在
库里了」（§3.2 没有 `wait`、没有异步排队），所以回调**不是**"首次拉取完成"的信号——
它是"可以开始读统计了"的信号，而统计本身要等下一个周期任务才有值。

**签名**：复用 `signPayload`（`apps/console/src/lib/webhook/client.ts:63`）。

```
X-Webhook-Timestamp: 1774000000
X-Webhook-Signature: sha256=<hex over "<timestamp>.<raw body>">
```

验签方（`apps/web`）三步，缺一不可：

1. `verifySignature(rawBody, ts, secret, header)` —— 必须用**收到的原始字节**，
   重新 `JSON.stringify` 会改键序导致验签失败（`signPayload` 的注释已写明这一点）。
2. `isFreshTimestamp(ts, new Date(), 300)` —— 只验 HMAC 的接收方会永远接受被录制的请求，
   时间戳窗口是签名有意义的前提。
3. `eventId` 去重 —— 网络重试会让同一个事件到达两次，按 `eventId` 落一张幂等表。

请求头：

```
Content-Type: application/json
X-Webhook-Id: repo.registered.V1StGXR8Z5jd   ← 幂等键，重试不变
X-Webhook-Timestamp: 1774000000
X-Webhook-Signature: sha256=...
X-Webhook-Event: repo.registered
```

**事件名是 `repo.registered` / `repo.published`，不是初版设计里的
`repo.initial_pull.completed` / `.failed`。** 原因就是上一段那句语义：登记端点不等待
首次拉取，所以不存在"拉取完成"这个时刻可报；报一个从未发生的时刻，会让接入方写出一个
永远等不到的状态机。两个事件名与 `POST /api/v1/projects` 共用同一个回调发送器
（`lib/api/callback.ts`），所以"登记"与"发布"在消费方是同一段代码的两个分支。

`eventId` 由事件名加仓库 id 派生（`repo.registered.<repoId>`）而不是随机：同一个写请求
因为超时被重发时，接收方按 `eventId` 去重就能认出这是同一件事，而不是两次独立的登记。

**secret 只有一种来源：本次请求带来的 `callbackSecret`。** 初版设计的
"`callbackSecret` > `api_keys` 派生 secret > `CONSOLE_API_TOKEN`" 优先级已取消——后两档
都不成立：`api_keys` 只存 SHA-256 而 §4.3 的派生方案依赖那列可读；`CONSOLE_API_TOKEN`
是全站共享的，一个接入方拿到它就能收回所有人的回调。因此 `callbackUrl` 存在而
`callbackSecret` 缺失时直接 400（§3.2 约束 2）。

**投递失败不影响本次调用的结果**：数据已经落库，把一次写成功报成失败，调用方的重试只会
登记两次。回调结果只进日志（`lib/api/callback.ts` 的文件头第 2、3 条）。

### 3.6 payload

```jsonc
{
  "eventId": "repo.registered.V1StGXR8Z5jd",
  "event": "repo.registered",
  "occurredAt": "2026-04-01T18:00:03.114Z",
  "fullName": "owner/name",
  "repoId": "V1StGXR8Z5jd",
  "created": true
  // 发布回调多一个 projectId；登记没有 project，所以这个字段不出现。
}
```

**回调体里没有 §3.6 初版设计那张庞大的 `repo` / `stats` / `classification` 全量 payload。**
初版把订阅推送的 payload（§6.5）复制了一份到登记回调里，但那些字段在登记刚完成时
**全是空的**：`stats` 要等周期任务，`classification` 必然为空（§1.4：M2M 登记不建
`projects` 行，所以 `projectTypes` / `categoryCode` 恒为空），`iconUrl` 要等图标任务。
发一份内容基本为 null 的全量结构，只会让接入方以为"字段为空就是没有数据"，然后写出一段
去猜 null 含义的代码。回调只报"发生了哪件事"，数据由接入方按 §4.1 / §5.1 去读。

需要全量 payload 的调用方有两条路：`GET /api/v1/repos/{id}`（§3.6 之外的档案端点，含
分类四轴）与 `POST /api/v1/subscriptions` 之后的推送（§6.5，那里有 `event` 级的
`repo.registered` 触发）。

失败时**不发回调**。回调只在成功路径上投递；`ingestRepo` 失败会带着 4xx/5xx 返回给
调用方，那才是处理失败的地方。

---

### 3.7 `GET /api/v1/repos`：可见性、过滤器与分页

列表**只返回已策展、对公开站可见的仓库**（§1.4），这与 `POST /api/v1/repos` 的"登记即可见"
正好相反，所以两个方法共用一条路径却不共用可见性。过滤器是 §6.6 的同一套参数
（`projectTypes` / `categoryCodes` / `platformTypes` / `tags` / `includeUncurated` /
`minStars` / `includePlatformProjects`），由同一个 `lib/api/repo-filter.ts` 求值——列表里
看得到与订阅里收得到必须是同一个集合。

分页是 **keyset**，不是 offset：

| 参数 | 默认 | 说明 |
|---|---|---|
| `limit` | 50 | 1..500 |
| `cursor` | — | 上一页响应里的 `nextCursor` |

```jsonc
{
  "repos": [ /* §3.6 的档案行，带分类四轴 */ ],
  "nextCursor": "V1StGXR8Z5jd",  // 或 null：这是最后一页
  "total": 137                     // 命中过滤器的总数，与 limit 无关
}
```

- 游标是上一页最后一行 `repos.id` 的 base64url。**不用 offset** 的理由是 offset 会在两次
  请求之间错行：新登记的仓库按 id 插进中间位置，于是第二页的第一行与第一页的最后一行
  重复；而更糟的是"读到最后返回空数组"会被调用方当成"读完了"。
- **坏游标返回 400，不退回第一页。** 静默退回会让调用方以为数据只有一页。
- `total` 是命中过滤器的总数，所以调用方翻第一页就知道"要不要继续"，不必翻完才知道。
- `limit` 上限 500 而不是 1000：每行带分类四轴（§1.5），1000 行是一个几 MB 的响应，
  而调用方真正需要的"还有多少"已经由 `total` 回答了。

**已知边界**：游标只按 `id` 定序，而 `repos.id` 是 nanoid。翻页期间新登记的仓库如果 id 排序
落在游标之前，它在这次翻页里不会被看到——这是 keyset 的定义，不是缺陷；需要一致的快照
只能给调用方一个"截至 `X` 时刻"的语义，而当前端点没有那个参数。

---

## 4. 仓库统计读取

### 4.1 `GET /api/v1/repos/{id}/stats`

`{id}` 接受 console 的 `repos.id`（nanoid）或 `owner/name`（URL 编码为 `owner%2Fname`）。

| 参数 | 默认 | 说明 |
|---|---|---|
| `cadence` | `daily` | `daily` \| `weekly` \| `monthly` |
| `start` | `end - 90d` | ISO 8601 **日期或时间戳**，按 `Asia/Shanghai` 日历解释 |
| `end` | 该仓库最新已存周期 | 同上；**不 clamp 到今天** |
| `limit` | 500 | 1..1000 |
| `cursor` | — | 上一页的 `nextCursor` |

**为什么默认 90 天**：沿用 `stats.ts:1105` 的 `DAILY_ARRIVALS_WINDOW_DAYS`，
和公开项目详情图用同一个窗口，客户端不需要为 radar 和详情页维护两套默认。

**`start` / `end` 接受两种写法**，因为"我要 4 月"是一个日期而不是一个时刻：

| 写法 | 含义（`Asia/Shanghai`） |
|---|---|
| `"2026-04-01"` | 该日 00:00:00.000 +08:00，即 `2026-03-31T16:00:00Z` |
| `"2026-04-01T00:00:00Z"` / 带偏移 / 不带偏移的完整时间戳 | 就按它解析（无偏移者按 `Asia/Shanghai`） |

只接受完整 ISO 时间戳曾经是一个真 bug：`{start: "2026-04-01", end: "2026-04-30"}` 是最自然的
区间写法，却会被 `z.iso.datetime()` 拒成 400，而同一份文档的示例里 `range.start` 输出的是
`2026-03-31T16:00:00Z` —— 文档教人用的写法端点不接受。现在 `YYYY-MM-DD` 被当作**上海时区
的日历边界**（`instantOfCivil`），而不是运行时的本地时区：`2026-04-01` 在 UTC 服务器上和在
上海部署的服务器上必须指向同一个时刻，否则同一个请求在不同机器上返回不同区间。

**为什么 `end` 是"最新已存周期"而不是今天**：`listDailyArrivals`
（`apps/console/src/lib/github/service/stats.ts:995`）的注释已经论证过这一点 —— sweep 随时可能停，
sweep 最后一次跑可能是三天前。按日历今天取，返回的是一串"有数据的最后一天 → 今天"的空洞，
而空洞在日频图上和"这几天真的没人 star"无法区分。

响应：

```jsonc
{
  "repoId": "V1StGXR8Z5jd",
  "fullName": "owner/name",
  "cadence": "daily",
  "timezone": "Asia/Shanghai",
  "range": {
    "start": "2026-01-01T16:00:00Z",
    "end":   "2026-03-31T16:00:00Z"
  },
  "counts": { "periods": 90, "returned": 90, "hasMore": false },
  "periods": [
    {
      "period": "2026-03-31T16:00:00Z",
      "date": "2026-04-01",          // daily: Asia/Shanghai 日历日
      "yearWeek": "2026-W14",        // weekly: ISO 周
      "yearMonth": "2026-03",        // monthly: 年月
      "totalStars": 1234, "deltaStars": 40, "deltaNewStars": 46,
      "totalWatchers": 89,   "deltaWatchers": 2,
      "totalForks": 120,     "deltaForks": 3,
      "totalOpenIssues": 7,  "deltaOpenIssues": -2,
      "totalPullRequests": 15, "deltaPullRequests": 1,
      "totalReleases": 9,    "deltaReleases": 1,
      "totalContributors": 34, "deltaContributors": 0,
      "totalCommits": 890,   "deltaCommits": 25,
      "totalDownloads": 12000, "deltaDownloads": 300
    }
  ],
  "nextCursor": "…"
}
```

- 三个周期标签字段恒定输出（不适用的为 `null`），让客户端不必按 `cadence` 分支解析。
- `NULL` 原样输出为 `null`。
- **不补洞。** 窗口内没有行、或行存在但计数器从未采集，一律作为**空洞**返回，不是 0。
  这是 `ecd3cb8`（"an unmeasured star period is a gap, not a zero"）确立的行为，
  `stats.ts:991-993` 的原话是：*"Days inside the window with no row, and rows no writer measured,
  are drawn as gaps rather than as zeros. Both are 'we did not look', and a quiet day is only a
  zero once something has actually recorded it."* 另有 `stats.ts:455-461`：没有前值可减时
  `delta` 写 `NULL` 而不是 0。
  本文早期版本在这里写的是"schema 层保证每个周期都有一行（稠密行），所以接口层不再补洞"，
  那个说法是**错的**——代码里没有任何稠密行保证，引用的 `github.ts:449` 也不是那条注释。
  因此 payload 必须让客户端能区分"这天是 0"和"这天没量"，§1.3 的 `NULL` 不转 0 规则正是为此。
- `totalDownloads` 对非 npm 仓库恒为 `null`。这是 `NULL` 语义最典型的用例：
  "没有下载数据"和"下载数是 0"是两件事。

### 4.2 需要新增的服务函数

现有 `listRecentDailyStats` / `listRecentWeeklyStats`（`stats.ts:371` / `stats.ts:355`）是"倒序取最近 N 期"，
语义与"任意区间"不同，**不能直接套**。它们自己的注释就把理由写清楚了：*"ordering ascending and
limiting returns the repository's **oldest** history, which is how a ten-year-old repository ends up
charting its first weeks forever"*（`stats.ts:347-354`）。另外 `listMonthlyStats`（`stats.ts:333`）
的 `limit` 同样取的是**最旧** N 期且不 reverse，也当"最近"用会静默拿到错误区间。

现存十个统计读取函数里没有一个接受 `{start, end}`、没有一个返回游标、没有一个按日期过滤，
所以下面两个是真正的新增面（今天均不存在，全仓 grep 为空）：

```ts
// apps/console/src/lib/github/service/stats.ts
export interface StatsRange {
  start: Date
  end: Date
  limit: number
  cursor?: { period: Date; repoId: string }
}

export async function listStatsRange(
  db: Db,
  repoId: string,
  cadence: StatsCadence,
  range: StatsRange
): Promise<StatsRow[]>

export async function listStatsSince(
  db: Db,
  cadence: StatsCadence,
  since: Date,
  repoIds?: string[]
): Promise<Array<{ repoId: string; row: StatsRow }>>
```

`listStatsSince` 供订阅增量推送使用（§6.4），按 `period > since` 索引扫描，
三张表都有 `period` 单列索引（`0012` 建出）。

### 4.3 callback secret 的派生 —— **已取消**

初版设计是"未显式传 `callbackSecret` 时从 key 派生"：

```
secret = base64url( HMAC-SHA256( key="mcp-radar-callback-v1", message=sha256(apiKeyHash) ) )
```

**这条路径没有实现，而且不该实现。** 它的两个卖点都站不住：

1. "回调 secret 可独立吊销（换 key 即换 secret）" —— 换 key 本来就是一次明确的管理动作，
   而 `api_keys` 上还有 `revoke`，独立吊销并不需要靠派生 secret 来实现。
2. "派生输入用 `key_hash`，不必在请求路径上持有明文" —— `key_hash` 恰恰是**库里明文可见、
   审计可见**的那一列。任何能读到 `api_keys.key_hash` 的人都能算出回调 secret，于是"回调
   只对我信任的接收方可见"退化成"对任何能查库的人可见"。而 `HMAC-SHA256` 在这里没有密钥
   保密性可言：`key="mcp-radar-callback-v1"` 是写在本文里的常量。

所以现在只有一种 secret 来源：**调用方在请求里带来 `callbackSecret`**
（`POST /api/v1/repos` / `POST /api/v1/projects`，`callbackUrl` 存在时必填，§3.2 约束 2）。
订阅的 secret 不走这条路，它由 `rotateSubscriptionSecret` 显式生成与轮换（§6.2），
因为订阅要能**在不换 key** 的前提下换 secret。

### 4.4 `subscribers`（GitHub watchers）：语义澄清与结论

需求里问的 `apps/web` 的 `repo_snapshots.subscribers`（`packages/db/src/mcp-schema.ts:100`），
**GitHub 确实提供，而且 console 侧已经在存了**。但这里有一个极易踩的坑，先把 GitHub 的两套命名对齐：

| GitHub 概念 | REST 字段 | GraphQL 字段 | 含义 |
|---|---|---|---|
| Stargazers（收藏） | `stargazers_count`（`watchers_count` / `watchers` 是它的**历史别名**） | `stargazers` | 给仓库点 star 的人 |
| Watchers / Subscribers（订阅） | `subscribers_count` | `watchers` | 订阅了仓库通知的人（**不**包含 star） |

GitHub 官方文档的原话：*"In responses from the REST API, `subscribers_count` corresponds to the
number of watchers, whereas `watchers`, `watchers_count`, and `stargazers_count` correspond to the
number of users that have starred a repository."*

**两套 API 里"watchers"这个词指的是相反的东西**：

- REST 的 `watchers_count` = **star 数**（一个会误导人的遗留别名）
- GraphQL 的 `watchers` connection = **订阅数**（对应 REST 的 `subscribers_count`）

GraphQL 里**没有** `subscribers` 字段 —— 想知道订阅数，GraphQL 得查 `watchers`。

**结论：console 侧不需要新增计数器，也不需要迁移。** 现有代码两条取数路径读的都是订阅数：

- **主路径** GraphQL：`repo-info-query.ts:64` 查 `watchers { totalCount }`，
  `client.ts` 的 `extractRepoInfo` 取 `["watchers","totalCount"]` → `RepoInfo.watchersCount`
  → `repos.watchers_count`
- **降级路径** REST：`client.ts:280` 在 FORBIDDEN 回退时读 `subscribers_count` → 同一个字段

两条路径指向同一个量，历史数据是一致的。`recordCurrentPeriods`
（`stats.ts:464`）已经把它写进三张 stats 表的 `total_watchers` / `delta_watchers`，
**历史已经完整保存**。

**接口上的处理：**

- 仓库档案（§3.6）新增 `subscribersCount`，即当前的 `repos.watchers_count`，满足"只返当前的"。
- 统计接口（§4.1）的 `totalWatchers` / `deltaWatchers` **就是**订阅数的历史，不再另起字段名。
  理由：加一对 `totalSubscribers` / `deltaSubscribers` 作为同值的别名，等于让两套名字长期并存，
  半年后没人说得清哪个才是权威；把语义写清楚比复制一份字段可靠。
  若第三方接入方对 `watchers` 这个词有歧义担心（§2.9），在文档里给映射表，不在 payload 里给别名。

**`apps/web` 侧需要修的（不在本文范围内，但会因此踩坑）：**

| `repo_snapshots` 列 | 当前来源 | 实际语义 | 应改为 |
|---|---|---|---|
| `stars` | `data.stars` | 正确 | 不变 |
| `watchers` | `data.watchers_count`（REST 别名） | **实际是 star 数，与 `stars` 重复** | 删除或改为订阅数 |
| `subscribers` | 无 | 空 | 从 console 的 `totalWatchers` / `subscribersCount` 填 |
| `forks` / `openIssues` / `contributors` / `pullRequests` / `releases` / `commits` | 对应字段 | 正确 | 不变 |

`design-github-repos-skills-webhook-sync.md:76` 描述的映射（`watchers_count → watchers`）
就是这个错误的源头，它把 REST 的遗留别名当成了字面意思。

**取数成本：零额外请求。** `subscribers_count` 在 REST 的 `GET /repos/{owner}/{repo}` 响应里，
`watchers.totalCount` 在已有的 GraphQL 查询里，两者都已经在打，不需要新增 GitHub 调用。

**一个诚实的边界：** GitHub 的 watch（通知订阅）功能在 2020 年做过调整，
对很多仓库而言 `subscribers_count` 会等于收藏数或与之接近，数值本身的信息量有限。
它对 `apps/web` 的价值主要在于与 `stars` 的**比值**（关注度是否转化为订阅）。
如果实测下来发现绝大多数仓库两者相等，值得先看一眼真实分布再决定要不要在 web 侧建索引。

---

## 5. 排行与周期目录

### 5.1 排行

```
GET /api/v1/rankings/weekly?year=2026&week=14&limit=100
GET /api/v1/rankings/monthly?year=2026&month=3&limit=100
```

`year`/`week`/`month` 都不传时取 `lastCompletePeriod`
（`apps/console/src/lib/tasks/tasks/build-rankings.ts:149`）—— 与 dashboard、build 任务、
匿名 `/api/rankings/week.json` 三方一致。这一点 `apps/console/src/lib/rankings-web.ts` 的注释
已经论证过（"silently ranking a different week than was asked for"）。

实现上直接复用 `buildRankingsForWeek` / `buildRankingsForMonth`。它们是**重算而非读缓存**
（`rising-stars.json/route.ts` 的注释解释了为什么：匿名路由没有写权限，不能重算成写入），
所以开放 API 复用它们同样安全。

返回沿用 `Rankings`（`rankings.ts:62`）：`trending` + `byRelativeGrowth`，
`relativeGrowth: null` 保留（此前 star 数为 0 时比率未定义，发`Infinity` 会让所有新仓库霸榜）。

### 5.2 周期目录

「年度周排行列表 / 年度月排行列表」有两种可能的读法，接口用两条路由分别覆盖，不猜：

```
GET /api/v1/rankings/periods?year=2026&cadence=weekly
GET /api/v1/rankings/periods?cadence=monthly&limit=120
```

- 读法 A（某年有哪些期）→ `year=2026&cadence=weekly`，返回该年**有数据**的 ISO 周升序列表。
  复现 `listWeeklyPeriods`（`available-periods.ts:40`）+ 年份过滤。
- 读法 B（全部可用期）→ 不传 `year`，倒序返回（`DEFAULT_LIMIT = 120`）。

客户端因此可以先列目录、再逐期取排行，而不必猜哪些期存在。**目录只列有数据的期**——
列出一个没有行的周，等于把客户端送去拿一个必然是 404 的请求。

### 5.3 与 web 排行的边界

`CONSOLE_RADAR_COMMERCIAL_PLAN.md` §7.3 已决策：radar 的"信号排行"（按 star 净增/相对增长）
与 web 的"行为排行"（按用户实际使用）是两个东西，不合并。

因此本节的排行接口**只输出 radar 信号**，`scopes` 里没有能让它写web 的能力，
web 若要消费只能在自己的库里另存一份，不能覆盖 `rankings` 系列表。

---

## 6. 订阅机制

### 6.1 表结构

```sql
-- 0015_subscriptions.sql
CREATE TABLE "subscriptions" (
  "id"            text PRIMARY KEY,
  "name"          text NOT NULL,

  -- 归属主体：API key 或 console 账号，二选一。
  -- 订阅既可能是某个接入方的（M2M），也可能是某个 console 用户的（自助订阅自己的提交）。
  -- CHECK 保证恰好一个非空，否则投递时无从判断"这是谁的订阅"。
  "api_key_id"    text REFERENCES "api_keys"("id") ON DELETE CASCADE,
  "user_id"       text REFERENCES "user"("id") ON DELETE CASCADE,

  "callback_url"  text NOT NULL,
  -- 只存 sha256(明文)。secret 明文仅在 create/rotate 时返回一次。
  "secret_hash"   text NOT NULL,
  "secret_prefix" text NOT NULL,
  "cadence"       text NOT NULL DEFAULT 'daily',      -- daily | weekly | monthly
  "scopes"        text[] NOT NULL,

  -- 过滤条件。语义见 §6.6。
  "project_types"     text[] NOT NULL DEFAULT '{}',   -- projects.type，见 §6.6 的 in() 约束
  -- 运营分类，取 categories.code（0021）。与 project_types 正交，见 §1.5。
  "category_codes"    text[] NOT NULL DEFAULT '{}',
  "platform_types"    text[] NOT NULL DEFAULT '{}',
  "include_platform"  boolean NOT NULL DEFAULT true,
  "include_uncurated" boolean NOT NULL DEFAULT true,
  "include_own_submissions" boolean NOT NULL DEFAULT true,
  "repo_ids"      text[],                             -- NULL = 走上面的过滤器
  "mode"          text NOT NULL DEFAULT 'batch',      -- batch | snapshot

  -- 过滤器每次变更 +1。消费方据此区分"新数据"与"过滤器变更后的补发"（§6.4）。
  "filters_version"  integer NOT NULL DEFAULT 1,

  "enabled"       boolean NOT NULL DEFAULT true,
  -- 已成功投递到的位置。只有投递成功才推进，失败不动，因此重试会重发同一批。
  "watermark"     timestamp with time zone,
  -- 连续失败计数，达到阈值触发熔断。
  "consecutive_failures" integer NOT NULL DEFAULT 0,
  "disabled_reason"     text,
  "last_delivered_at"   timestamp with time zone,
  "last_error"          text,
  "expires_at"          timestamp with time zone,
  "created_at"    timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"    timestamp with time zone
);
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_one_owner_ck"
  CHECK (("api_key_id" IS NOT NULL) <> ("user_id" IS NOT NULL));
CREATE INDEX "subscriptions_key_idx" ON "subscriptions" ("api_key_id");
CREATE INDEX "subscriptions_user_idx" ON "subscriptions" ("user_id");
CREATE INDEX "subscriptions_enabled_idx" ON "subscriptions" ("enabled") WHERE "enabled";

-- 0015 续：投递日志
CREATE TABLE "webhook_deliveries" (
  "id"              text PRIMARY KEY,
  "subscription_id" text NOT NULL REFERENCES "subscriptions"("id") ON DELETE CASCADE,
  -- 幂等键：同一批的多次重试共用一个，重试时不变。
  "event_id"        text NOT NULL,
  "event"           text NOT NULL,
  "payload"         jsonb NOT NULL,          -- 存原文，重试时发同一份字节
  "watermark"       timestamp with time zone NOT NULL,
  "attempt"         integer NOT NULL DEFAULT 1,
  "status"          text NOT NULL,          -- pending | delivered | failed
  "http_status"     integer,
  "error"           text,
  "next_attempt_at" timestamp with time zone NOT NULL DEFAULT now(),
  "delivered_at"    timestamp with time zone,
  "created_at"      timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "webhook_deliveries_event_idx" ON "webhook_deliveries" ("event_id");
CREATE INDEX "webhook_deliveries_retry_idx"
  ON "webhook_deliveries" ("next_attempt_at") WHERE "status" = 'pending';
CREATE INDEX "webhook_deliveries_sub_idx" ON "webhook_deliveries" ("subscription_id");
```

`webhook_deliveries.payload` 存**原文**而不是重新序列化：重试必须发同一份字节，
否则 `eventId` 相同而签名不同，接收方的重放窗口会拒掉（也正是签名要存在的原因）。

**过滤器不建成独立的 `subscription_filters` 表**，而是直接放在 `subscriptions` 上：
过滤条件永远是一对一跟着订阅走的，没有独立生命周期，也没有"多个订阅共享一个过滤器"的用法。
拆表只会多一次 join 和一个需要级联删除的东西。

**过滤器不入库为 JSON**，而是一组带类型的列。理由：`project_types` 要参与
`projects.type = ANY(...)` 的索引扫描，JSONB 里的数组做不到这一点——
过滤发生在每次推送时，不是一次性的。

### 6.2 创建订阅

```http
POST /api/v1/subscriptions
```

```jsonc
{
  "name": "web-marketplace",
  "callbackUrl": "https://web.example.com/api/hooks/console",
  "secret": "自行生成，至少 32 字节熵",     // 可选，不传则服务端生成并返回一次
  "cadence": "daily",
  "scopes": ["repos.stats", "repos.rankings", "repos.metadata", "repos.user_repos"],

  "filters": {
    // 显式白名单。给了就完全覆盖下面的类型过滤器 —— 优先级最高，也最容易解释。
    "repoIds": ["V1StGXR8Z5jd"],

    // 项目形态（projects.type），至少一项。取值：client|server|application|skill|persona。
    "projectTypes": ["skill", "persona"],

    // 运营分类（categories.code，0021 新增），至少一项。见 §1.5 坑一/坑二/坑三。
    "categoryCodes": ["mcp-server"],

    // 是否纳入平台收录的项目（有 projects 行的仓库），以及它们的形态。
    "includePlatformProjects": true,
    "platformTypes": ["skill"],

    // 是否纳入"还没有 project 行"的候选仓库。它们必然没有分类（§1.5 坑三）。
    "includeUncurated": false,

    // 是否纳入该主体自己的 user_repos（见 §6.7）。
    "includeOwnSubmissions": true
  },

  "mode": "batch",
  "expiresAt": "2027-01-01T00:00:00Z"      // 可选
}
```

过滤器的完整语义（每一条的判定规则、默认值、互斥关系）在 §6.6。

订阅级 `scopes` 与 key 的 `scopes` 是**两个不同的东西**，职责不同：

- key 的 `scopes` 管"能不能创建/管理订阅"。
- 订阅的 `scopes` 管"这个订阅推哪些内容"。

服务端在投递时用订阅自己的 `scopes` 读库，**不借用调用方 key 的权限**。
这样一条只有 `subscriptions:write` 的 key 也能订阅 `repos.stats`，
而 key 被降权或吊销时，订阅要么一起被删（级联），要么按订阅自身的 scope 继续——行为可预测。

响应里 `secret` 仅此一次：

```jsonc
{
  "id": "sub_abc123",
  "name": "web-marketplace",
  "callbackUrl": "https://web.example.com/api/hooks/console",
  "secretPrefix": "kPq3",         // 仅用于之后人工比对
  "secret": "kPq3_…",            // ← 只此一次，之后任何接口都不再返回
  "cadence": "daily", "mode": "batch",
  "scopes": ["repos.stats", "repos.rankings", "repos.metadata"],
  "enabled": true, "watermark": null
}
```

### 6.3 触发时机

订阅推送**严格挂在两个排行任务都成功之后**。这是需求的核心约束：
"console 拉完全部排行数据之后，再把更新的数据推给订阅者"。
若在 `update-github-data` 之后就推，接收方拿到的排行会缺尚未闭合的周期。

```
/api/cron/github  (0 18 * * * UTC)
  └─ update-github-data     fetchRepos + upsertRepo + recordCurrentPeriods（写日/周/月当期）
  └─ snapshot-stars         stargazers/history 补写已闭合周期
  └─ build-weekly-rankings  落 weekly 排行
  └─ build-monthly-rankings 落 monthly 排行
  └─ notify-subscriptions   ← 新增任务，投递订阅
```

⚠️ **本文早期版本写的 `build-rankings` 这个任务名不存在。** `registry.ts:48-66` 注册了 17 个任务，
排行是两个独立任务 `build-weekly-rankings` / `build-monthly-rankings`，由
`tasks/build-rankings.ts:43` 用 `build-${period === "week" ? "weekly" : "monthly"}-rankings`
生成后分别注册（`registry.ts:56-57`），并在 `definitions.ts:96` / `:110` 播种了调度。
`build-rankings` 只是文件名。写 registry 依赖时必须引用真实任务名，否则依赖永远不成立且不报错。

`notify-subscriptions` 作为**独立任务**而不是排行任务尾部的一行调用：
任务框架已经有 `taskDefinitions` / `taskExecutions` 的调度、重入保护
（`task.alreadyRunning`）和历史，混进行情任务会让"排行失败"和"推送失败"共用一条
执行记录，运维看不出是哪一环坏了。它需要两个排行任务刚成功这一前置条件。

> **落地注意：现有任务重入保护是数据库锁，不是 Redis 锁。** `tasks/runner.ts:185` 调
> `acquireTaskLock(...)`，未拿到就把这次执行标成 `skipped` / `task.alreadyRunning`（`runner.ts:198-208`）。
> `lib/redis/lock.ts` 的 `withLock` / `acquireLock`（含正确的 CAS 释放与 TTL 续期）已经写好并有测试，
> 但**全仓零生产调用方**。所以本文 §2.8 承诺的 `notify-subscriptions:lock` 目前是一个空承诺：
> 要么让 runner 支持"这个任务用 Redis 锁"，要么承认 DB 锁已经够了并删掉那段设计。
> 二选一，不要两层都留——两层都留时没人说得清哪一个才是生效的那道。

### 6.4 增量与水位线

`mode: "batch"`（默认）：

1. 读订阅的 `watermark`（首次为 null → 取"所有已存周期的起点"，即给订阅建立时的全量）。
2. `resolveSubscriptionRepos(db, subscription)` 算出本订阅命中的仓库集合（§6.6）。
3. `listStatsSince(db, cadence, watermark, repoIds)` 取该之后的所有变更行。
4. 组装 payload，`payload.watermark` = 本批覆盖到的最大 `period`。
5. **写一条 `webhook_deliveries`（`status: pending`）**，然后才发。
6. 发成功 → 该 delivery 置 `delivered`，`subscriptions.watermark` 推进到本批 watermark。
7. 发失败 → `attempt + 1`，按退避重排`next_attempt_at`；**watermark 不动**。

因此失败重试会重发同一批（同一 `eventId`、同一 payload 字节），不会跳过数据，
也不会重复计入已投递的部分 —— 因为 watermark 只在成功时前进。

**过滤器变更时 watermark 怎么办**：不重置。
水位线表示"这个订阅的数据读到哪了"，而过滤器决定"读哪些"。改了过滤器之后，
新的命中集合里可能有从未推送过的仓库，但它们的 `period` 早于 watermark，
按 `period > watermark` 取就取不到。

处理方式：`PATCH /api/v1/subscriptions/{id}` 命中任何过滤字段时，在同一个事务里
把 `subscriptions.filters_version` 加一，并把 watermark **回退**到
"新命中集合的最早已存周期"，让新纳入的仓库至少推一次完整的现有历史，
而不是静默地永远收不到。

> `filters_version` 这一列此前只存在于 payload 里、没有落库，导致"消费方拿什么判断
> 补发"这个问题没有答案——payload 里的 `filtersVersion` 无从产生。现已补进 §6.1 的表结构。
> 它必须是**列**而不是运行时算的：投递是异步的（cron 里跑），"这次投递对应哪一版过滤器"
> 只有在投递被组装的那一刻才能确定，而那时已经不在 HTTP 请求上下文里了。

代价是已推送过的数据可能重复一次——消费方按 `eventId` 去重挡不住这种（`eventId` 不同）。
因此 payload 里带 `filtersVersion`，消费方可以据此判断是"新数据"还是"过滤器变更后的补发"。

还有一个本文没写够的边界：**回退目标"最早已存周期"在空命中集合上没有定义。**
若新过滤器一个仓库都不匹配（例如运营把唯一的分类 retire 了），就没有"最早已存周期"。
此时必须**不推进也不回退 watermark**，把 `filters_version` 照常加一，并让
`GET /api/v1/subscriptions/{id}` 返回 `matchedRepos: 0`。理由：把 watermark 回退成一个
"当前没有任何仓库"的集合的起点，等于把水位线退到数据库的最开头，让下一次投递把全表重推一遍。

这个取舍写在文档里，是因为它是一个真实的语义选择：
要么漏推，要么可能重推。选"可能重推"，因为漏推是静默的，重推是可见的。

退避：`1s → 5s → 30s → 5min → 30min`，最多 8 次，之后 `status: "failed"`，
但 **watermark 依然不动**：下一轮 cron 会重新生成一批新的 delivery（新的 `eventId`），
消费方靠 `eventId` 去重即可，而漏掉的数据会在下一批补上。

熔断：`consecutive_failures >= 20` → `enabled = false`，
`disabled_reason = "too_many_failures"`，队列保留。
消费方修好后 `PATCH /api/v1/subscriptions/{id}` 恢复。
不做的事：永不熔断。永远失败的订阅如果一直重试，会把 cron 的时间预算吃光，
连带影响其他订阅。

`mode: "snapshot"`：每次推该订阅范围内**全部**最新一期，不带 watermark，不做增量。
给"只要当前状态"、自己管存储的消费方。

### 6.5 payload

```jsonc
{
  "eventId": "evt_batch_20260401",
  "event": "data.daily.updated",
  "deliveredAt": "2026-04-01T18:12:44.902Z",
  "watermark": "2026-04-01T16:00:00Z",
  "timezone": "Asia/Shanghai",
  "cadence": "daily",
  // 过滤器每次变更 +1。消费方据此区分"新数据"与"过滤器变更后的补发"（§6.4）。
  "filtersVersion": 3,
  "counts": { "repos": 128, "periods": 128 },
  "repos": [
    {
      "repoId": "V1StGXR8Z5jd",
      "fullName": "owner/name",

      // 订阅主体的关系信息。仅当 scopes 含 repos.user_repos 时输出。
      // 只包含该主体自己的行；别人的提交关系永远不出现在任何 payload 里。
      "userRepo": {
        "source": "api",
        "status": "active",
        "pinned": true,
        "note": "重点跟踪",
        "submittedAt": "2026-01-05T02:11:00Z",
        "platformStatus": "curated",
        "platformSyncedAt": "2026-04-01T18:00:00Z"
      },

      // 过滤器命中时推送这个仓库的原因。消费方可以用它调试"为什么我订的没推"。
      "matchedBy": ["categoryCode", "platformType", "ownSubmission"],

      // 分类结果，四轴全给，不适用的为 null / []。字段语义见 §1.5。
      // 未策展仓库（matchedBy 含 "uncurated"）这四项必然全空，见 §6.6 陷阱四。
      "classification": {
        "projectTypes": ["skill"],        // 该仓库所有 project 的 type（可能多个）
        "categoryCode": "mcp-server",    // 取 categories.code；该仓库有多个 project 时取任一非空
        "categoryReviewed": true,         // category_reviewed_at 是否已由运营确认
        "isPlatformProject": true,
        "platformStatus": "curated",
        "tags": ["mcp", "agent"]          // 公开站 /categories 的实际分类轴
      },

      "daily":   { /* §4.1 单期 */ },
      "weekly":  { /* 最近一期，仅当 scopes 含 repos.stats */ },
      "monthly": { /* 最近一期，仅当 scopes 含 repos.stats */ },
      "rankings": {
        "weekly":  { "period": {"year": 2026, "week": 14}, "trending": [...], "byRelativeGrowth": [...] },
        "monthly": { "period": {"year": 2026, "month": 3},  "trending": [...], "byRelativeGrowth": [...] }
      }
    }
  ]
}
```

`userRepo.note` 是**私有列**（`USER_REPO_PRIVATE_COLUMNS`，`apps/console/src/db/schema.ts`），
只有行主人能读。一个 M2M key 订阅返回的是"这个 key 自己提交的仓库"的 note，
不会泄露任何 console 用户的私有备注 —— 因为投递时按 `subscription.api_key_id` /
`subscription.user_id` 精确匹配 `userRepos`，不带"该仓库的全部提交者"。

请求头与 §3.5 完全一致（`X-Webhook-Id` / `X-Webhook-Timestamp` / `X-Webhook-Signature` /
`X-Webhook-Event`），验签流程也一致。**一套签名格式覆盖回调和订阅**，否则消费方要实现两套。

> ⚠️ **现有 `sendWebhook` 只会发两个签名头。** `lib/webhook/client.ts:146` 的 `sendWebhook`
> 实际设置的 `content-type` / `x-webhook-timestamp` / `x-webhook-signature`（有 secret 时）
> / `authorization`（有 token 时），**不发 `X-Webhook-Id`，也不发 `X-Webhook-Event`**
> （全仓 grep 两个头名均无命中）。所以本文的回调与订阅都不能直接调 `sendWebhook`，
> 要么给它加两个可选参数，要么新写一个发送函数——但**签名与验签必须继续复用**
> `signPayload` / `verifySignature`（`client.ts:63` / `:81`），不要另造一套。

- `eventId` 在 batch 模式下由 `subscriptionId + watermark` 派生（同一水位线的重试必然相同），
  snapshot 模式下由 `subscriptionId + 日期` 派生。
- 单个 payload 上限 2MB / 1000 个仓库。超限时拆多个 delivery，**按 `repoId` 字典序切分**，
  顺序投递，且只有最后一个 delivery 成功后才推进 watermark。
  拆分后 `eventId` 必须**带上分段序号**（`subscriptionId + watermark + partIndex`），
  否则同一水位线的 3 段会撞成同一个 `webhook_deliveries_event_idx` 唯一键，
  第二段直接插入失败。而 §6.4 的"失败重试重发同一批"也随之按段独立成立：
  第 1 段成功、第 2 段失败时，只重发第 2 段，watermark 不动，因此第 1 段不会被重复投递——
  这比"整批重发"更省，也更容易向消费方解释。

### 6.6 过滤器语义

这是本文最容易实现错的一节，因为四个集合互相重叠，而且其中一个（`projects`）可以一行都没有。
先定义数据来源，全部以 `repos` 行 `r` 为主表：

| 来源 | 判定 | 基数 |
|---|---|---|
| **项目形态** | `EXISTS (SELECT 1 FROM projects p WHERE p.repo_id = r.id AND p.type = ANY($projectTypes))` | 一个仓库可有**多个** project 行，因此可有多个 type |
| **运营分类** | `EXISTS (SELECT 1 FROM projects p JOIN categories c ON c.id = p.category_id WHERE p.repo_id = r.id AND c.code = ANY($categoryCodes))` | 同上（每个 project 只有一个 category，仓库可有多个 project） |
| **平台项目** | 该仓库有**至少一个**未被标记 `hidden` 的 `projects` 行 | 同上。注意是"至少一个"：`listCuratedRepos`（`service/repo.ts:373-382`）必须显式去重，测试 `curated-repos.integration.test.ts:119-134` 就在测这个 |
| **自己的提交** | `EXISTS (SELECT 1 FROM user_repos u WHERE u.repo_id = r.id AND u.user_id = $owner)` | 恰好 0 或 1 行（PK 是 `(user_id, repo_id)`）。M2M 的 `$owner` 取 `api_keys.submitter_id`，见 §11 待确认 #2 |

> 判定里**不带** `projects.status <> 'hidden'`，隐藏与否只在"平台项目"这一条上判定（陷阱三）。
> 若把隐藏过滤加进 `projectTypes` / `categoryCodes` 两条，会得到一个无法解释的行为：
> 订阅者明确点了 `skill` 类型，但那个 skill 项目被运营隐藏了，于是它从"按类型订阅"里消失，
> 而从 `includePlatformProjects` 那一支看它又不算平台项目——两条路都不推，仓库静默蒸发。
> 正确做法是按 §6.1 的设计把 `platform_status`/`hidden` 收敛到单独一支去判定。

过滤规则，按**求值顺序**（先命中即短路，语义上等价于 OR）：

| # | 条件 | 结果 |
|---|---|---|
| 1 | `repoIds` 非空 | **完全绕过下面所有规则**。只推名单内的仓库 |
| 2 | 自己的提交 且 `includeOwnSubmissions = true` | 命中，`matchedBy` 含 `ownSubmission` |
| 3 | 是平台项目 且 `includePlatformProjects = true` 且（`platformTypes` 为空 或 type 命中） | 命中，`matchedBy` 含 `platformType` |
| 4 | 有 project 行 且 `categoryCodes` 非空 且 category 命中 | 命中，`matchedBy` 含 `categoryCode` |
| 5 | 有 project 行 且 `projectTypes` 非空 且 type 命中 | 命中，`matchedBy` 含 `projectType` |
| 6 | **无** project 行 且 `includeUncurated = true` | 命中，`matchedBy` 含 `uncurated` |
| 7 | 其他 | **不推** |

四个必须写进文档和代码注释的陷阱：

**陷阱一：`projectTypes` / `categoryCodes` 一旦非空，所有没有 project 行的仓库会被静默排除。**
这几乎肯定不是订阅者的本意——他要"skill 项目"，而一个刚被 API 创建、还没来得及策展的
skill 仓库正是他最想看的。`includeUncurated` 的默认值因此按条件推导：

```
includeUncurated 的默认值 = (projectTypes 为空 AND categoryCodes 为空 AND platformTypes 为空)
```

即"没按类型/分类过滤时，全部都要（含未策展）；按类型过滤时，默认只要已策展的"，
订阅者想要更宽的范围得显式写 `"includeUncurated": true`。默认值写进 §6.2 的响应里回显，
不让它成为隐式行为。

注意这个默认值在 `0021` 之前只需考虑两个字段，现在必须把 `categoryCodes` 也算进去。
漏掉它的后果很具体：一条 `projectTypes: ["skill"]` + `categoryCodes: ["mcp-server"]` 的订阅，
若默认值按旧公式推导成 `true`，就会把**所有**未策展仓库也推给它——因为未策展仓库没有任何分类，
两个条件都"命中不了"，于是落到第 6 行被放行。公式漏一个字段，默认范围就从"已策展"静默放大到"全部"。

**陷阱二：`platformTypes` 和 `projectTypes` 都读 `projects.type`，语义上会重叠。**
目前只有一套项目形态枚举，所以两个字段是同一份数据的两个入口。这是有意为之——
分成 `radarType` 和 `platformType` 两套枚举，只会让运营在填表时面对一个说不清的问题。
若将来 radar 引入自己的形态分类，那时再拆；现在拆等于提前为不存在的问题付复杂度。

两个字段都存在的原因是**开关不同**：`includePlatformProjects` 决定"策展动作是否影响我的订阅"，
`projectTypes` 决定"哪些形态进我的订阅"。合并成一个字段就没法表达
"我只想要 skill 形态的，但策展成 person 的也别推"这种组合。

**`categoryCodes` 与上面两个字段不是同一类重叠，它是真正独立的一维。**
`platformTypes` / `projectTypes` 读 `projects.type`（形态枚举，5 个值，运营手填），
`categoryCodes` 读 `categories.code`（运营分类，**词表由运营自己定**，且由 `classify-projects`
自动提议，见 §1.5）。两者回答不同的问题——"它是个 server" 与 "它是个 MCP 服务器"——
所以这里不存在"要不要合并"的问题，只有"空词表时它返回空集"的问题（§1.5 坑一 —— 那是
**正确行为**，不是待修的缺陷）。
接口侧字段名必须区分清楚：`categoryCodes`（`categories.code`）不要叫 `categories`，
以免与 capabilities 的 `form` 轴撞名（§1.5 坑二 —— 那个轴在 `0026` 里已从 `category`
改名为 `form`）。

**陷阱三：`projects.status = 'hidden'` 的项目算不算平台项目。**
不算 —— 与公开页面一致（`lib/public/radar.ts:45` 的 `PUBLIC_WHERE = ne(projects.status, "hidden")`，
在六处调用点应用）。被运营隐藏的项目推给外部，等于绕过 `/console` 的可见性判断把它泄露出去。

**陷阱四：未策展仓库的分类字段恒为 `null`，不能编。**
四条分类轴都挂在 `projects` 上（§1.5），所以命中第 6 行 `uncurated` 的仓库在 payload 里必然是
`categoryCode: null` / `projectTypes: []` / `tags: []`。
这不是数据缺失需要补，是"分类是策展的产物"这个决定的推论。消费方若按
`categoryCode IS NOT NULL` 做本地二次筛选，会把所有未策展仓库丢掉——文档必须写明这一点，
否则会有人把 `null` 当成"分类未知，稍后再补"。

### 6.7 订阅归属与可见性

订阅有两个归属主体，由 §6.1 的 CHECK 约束二选一：

| 主体 | 创建入口 | 可见性 |
|---|---|---|
| API key | `POST /api/v1/subscriptions`（需 `subscriptions:write`，该 scope 不自助授予，§2.5） | `GET /api/v1/subscriptions` 只返回 `api_key_id = 当前 key` |
| console 用户 | `/console/subscriptions`（tRPC `subscriptionsRouter`，`protectedProcedure`） | 只返回 `user_id = 当前会话用户` |

**这是租户隔离的全部实现** —— 没有别的过滤条件。投递任务遍历所有
`enabled = true` 的订阅，按各自的归属主体算自己的过滤器。

管理员视图 `/dashboard/subscriptions` 与 key 一样走 §2.4 的"角色推进 WHERE"模式：
`subscriptions.list` 是 `protectedProcedure`，管理员看全部（两种归属都看），用户看自己的，
两个页面共用一个组件。

**但 admin 视图不再是纯只读的**（这是本文相对初版的一处修改，理由是运营需要止损能力）：
`subscriptions.disable` 用 `adminProcedure`，置 `enabled = false` 并写
`disabled_reason = "admin"`，同时按 §2.13 写审计。

为什么必须有这个动作：一个用户可以把 `callbackUrl` 设成任意外部地址并订阅全量数据
（`includeUncurated: true` + 空过滤器 = 整个仓库库）。用户自己可以取消，但**用户不会主动取消**
才是常态。没有管理员停用能力，唯一剩下的手段是改 `SKILLS_WEBHOOK_TOKEN` 之类的全局密钥，
那会连带打掉所有健康订阅。

只读的那部分仍然保留：投递历史、`consecutiveFailures`、`lastError` 在 admin 视图里可见，
但 admin **不能**改订阅的过滤器或 callbackUrl —— 那些是订阅方的意图，不是运营的。
需要改 filter 时让订阅方自己在 `/console/subscriptions` 改。

两套入口共用 `createSubscription` / `updateSubscription` / `deleteSubscription`
三个服务函数，服务层接受 `{ apiKeyId } | { userId }` 的判别联合。
不共用 HTTP 层：API key 走 Bearer，console 用户走会话 cookie，
把两者混在一个 handler 里会让鉴权分支出现在每一行。

用户订阅 `includeOwnSubmissions = true`（默认）时，
推送的每条记录带自己的 `userRepo` —— 这就是需求里"每个用户都有自己的 user-repo，
订阅之后 user-repo 会返回"。

### 6.8 投递失败对订阅方可见

`GET /api/v1/subscriptions/{id}` 返回 `lastDeliveredAt`、`lastError`、
`consecutiveFailures`、`enabled`、`disabledReason`，以及最近 20 条
`webhook_deliveries` 的 `{eventId, status, attempt, httpStatus, error, createdAt}`。

不给这个，订阅方唯一的排障手段是"等明天看数据有没有更新"。

`POST /api/v1/subscriptions/{id}/test` 发一条 `subscription.test` 事件的探测 payload
（内容极小、含一份真实的当前快照），**不推进 watermark**，让订阅方能在改过滤器时立刻验证回调地址。
鉴权与签名路径和正常投递完全一致——如果测试事件能验签通过，正常事件也能。

---

## 7. 鉴权总表

| 方向 | 机制 | 实现 |
|---|---|---|
| 客户端 → console（读/写 API） | `Authorization: Bearer mcp_radar_<prefix>_<secret>`，查 `sha256` | §2.6新增 `lib/api/guard.ts` |
| console → 客户端（回调/订阅） | `X-Webhook-Signature` HMAC-SHA256 over `<ts>.<raw body>` + 300s 时间窗 | 复用 `lib/webhook/client.ts` |
| 接收方去重 | `X-Webhook-Id` 落幂等表 | 消费方责任 |
| 用户 → console（自助签发/订阅） | better-auth 会话 cookie + `protectedProcedure` + §2.10 滥用防护 | §2.4 / §2.10，**新增** |
| 管理员 → console（治理） | better-auth 会话 cookie + `adminProcedure` | 现有 tRPC |
| web → console（配对兑换） | 一次性配对码，**无需凭据**，`returnUrl` 精确相等 + fail-closed 限流 | §2.11，**新增**，唯一豁免 |

`/api/v1/connections/redeem` 是上表里唯一不需要凭据的 `/api/v1` 端点。它的安全边界**完全**
由配对码承担（单次 + 5 分钟 TTL + 绑定 `returnUrl` + 按 IP fail-closed 限流），
等价于 OAuth device flow。任何人往这个表里再加一个"先认证再放行"的豁免端点，都要重新评审。

未配置任何凭据时，`/api/v1/*` 全部返回 **404**，与 `/api/internal/repos` 一致。

### 7.1 `GET /api/v1/openapi.json`

`apps/console` 已引入 `better-auth` 并启用 `openAPI()` 插件（`lib/auth.ts:130`），
本API 的 spec 另出一份，聚合 zod schema 生成，避免两处手写漂移。
`/api/v1/openapi.json` 本身需要有效 key（防止被当作免费的接口发现服务），
但返回的 spec 里不含任何实例专属信息。

---

## 8. `apps/web` 覆盖情况

| web 的需求 | 覆盖 | 说明 |
|---|---|---|
| **接入前注册 + 创建 key** | ✅ §2.11 | **前置条件**，不是可选项：web 必须先在 console 注册、拿到 key 才能调任何 `/api/v1`。web 自己的 `api_keys` 表**不算**（§2.11） |
| 提交 URL 触发拉取 | ✅ §3 | 替换 `apps/web/src/lib/console/client.ts:192` 的 `POST /api/internal/repos`（**这条现在会建 project**，见 §12.2） |
| `checkGithub` / `connectFromGithub` / `pollSync` | ✅ §3.5 + §6 | 现在轮询自己的 `repos` 行；改回调或订阅后可由推送驱动，**轮询可以去掉** |
| `repos` 表同步 | ⚠️ 需 web 侧新增接收端 | `POST /api/webhook/daily` 至今不存在，`packages/db/src/mcp-schema.ts` 里的 `repos` / `repo_snapshots` 没有写入方 |
| `repo_snapshots.subscribers` | ✅ §4.4 | console 侧**已经在存**（`total_watchers` / `delta_watchers`），无需迁移。web 侧改映射即可 |
| `repo_snapshots.watchers` | ⚠️ 需要 web 侧修正 | 当前存的是 REST `watchers_count`，实际是 star 数，与 `stars` 列重复 |
| 按项目类型 / 平台项目订阅 | ✅ §6.6 | `projectTypes`、`platformTypes`、`includePlatformProjects` |
| 周/月排行驱动 UI | ⚠️ 有意隔离 | radar 排行不进 web workflow rankings（§5.3） |
| 发布门控 / 扫描 | ❌ 有意不做 | console 只给证据，发布是 web 的职责（`SKILLS_PUBLISH_POLICY.md`） |
| stargazer 明细 | ❌ 有意排除 | GitHub 对非管理员 403，覆盖不完整，不对外 |

**这一版修正了上一版一处过时的事实。** 上一版写的是"`apps/web/src/lib/github-nextjs/client.ts`
里的失效路径"，但那个文件**已经不存在了** —— `apps/web/src/lib/github-nextjs/` 整个目录被
`2b572f6` 删除，真正的调用方是 `apps/web/src/lib/console/client.ts`。它的文件头注释把现状
写得很清楚，本文照抄其中的关键事实：

- 该文件是 web 调 console 的**唯一**通道，明确列出三个端点，且强调"全部是机器对机器"：
  `POST /api/internal/repos`、`GET /api/skills-sync/export`、`POST /api/cron/github`。
- 三个 token 是**分开**解析的（`consoleApiToken()` / `consoleSkillsToken()` / `consoleCronSecret()`），
  注释明确说明理由："console 对两者读同一个变量名（`SKILLS_WEBHOOK_TOKEN`、`CRON_SECRET`），
  在这里分开解析而不是合并成一个 console token —— 允许拉技能而不允许驱动调度是合法部署。"
  这个分离值得保留，本文 §12.4 只要求换掉 token 的取值方式，不动这个结构。
- `CONSOLE_API_*` 是新名，`GITHUB_NEXTJS_API_*` 是 console 改名前的旧名，仍被接受。
- 所有调用点用 `consoleApiConfigured()` 之类先问再调，把 404 当成"未配置"而不是错误 ——
  因为"未配置的 console 是正常的单应用部署"。这个 fail-closed 语义本文沿用。

**`triggerConsoleSync` 是死代码**：全仓库只搜到它自己的定义（`client.ts:249`），无任何调用方。
它自己的注释也劝别用（"这是 console 的整个任务图，不是单个任务……会返回 409"）。
按 §12.5 随 `POST /api/cron/github` 的 web 侧调用一并删除。

**web 的 API Key 表面与 console 的 API Key 是两个产品。** `apps/web` 自己有一张 `api_keys`
表（`packages/db/src/auth-schema.ts:237`，`userId NOT NULL`）和一个自助发 key 的页面
（`apps/web/src/app/[locale]/(protected)/(console)/dashboard/apikeys/page.tsx`），
逻辑与 console 的 §2.10 高度相似 —— 但它**不能**调 console 的任何接口。
必须假定下一个读到这两处代码的人会想把它们合并，然后在合并过程中接上跨库读 `user` 表。
§2.11 的配对流程就是为了让两条线各自保持独立。

---

## 9. 定位契合

`CONSOLE_RADAR_COMMERCIAL_PLAN.md` 把 console 定义为**雷达与决策引擎**，不是市场。
本文的接口恰好都是"读证据 + 推证据"，没有一个是"卖东西"或"管账号"：

- API Key 签发留在 console 的账号体系内（自助签自己名下 + admin 签发别人的，§2.4），
  **不与 web 打通账号** —— web 的用户必须自己在 console 注册并配对（§2.11），
  这是账号独立约束在自助签发之后的必然结果，而不是例外。
- 仓库创建只写 `repos` + `user_repos(source: "api")`，**不动 `repos.created_by`**，
  **也不建 `projects` 行** —— radar 记录"这个仓库存在并被跟踪"，不主张"这个仓库属于谁"，
  更不主张"这个仓库值得被发布"（§1.4）。
- 订阅是**读**推送，console 不要求接入方把数据写回来。
- 排行是信号，不覆盖 web 的行为排行。
- 不提供发布能力，不做扫描门控。

`§1.4` 那个"提交不自动建 project"的决策在这里有一个正向的推论值得单独说：
**开放 API 不是 console 的公开面，它是 console 的上游数据通道。**
`POST /api/v1/repos` 只能让一个仓库"被知道、被跟踪"，不能让它"被发布"。
能发布的仍然只有 `/dashboard/projects` 那条 admin 路径，也就是**有人看过**这件事本身。
一个持有 API key 的接入方，在可见性上和一个匿名用户完全平级。

过滤器里的 `includePlatformProjects` 需要额外小心：它让 console 的策展动作
（"把这个仓库收录成一个项目"）直接影响外部订阅者的数据流。
这正是 radar 想要的——**策展是雷达的核心动作，它应该有对外可见的后果**——
但也意味着 `/dashboard/projects` 的编辑权限等于对外的数据分发权限。
这不是缺陷，是要记住的耦合。

新增的 `categoryCodes` 让这个耦合多了一层：`/dashboard` 里给项目选分类，
现在也会改变外部订阅者收到什么（§6.6 陷阱二）。同样地，
`classify-projects` 自动提议分类 → 运营确认 → 对外可见，这条链上每一环都会外溢。
这是"分类是策展的产物"的自然结果，不是新问题，但**分类比形态更贴近运营的日常动作**，
所以外溢的频率会高得多。

一句话：console 通过这套 API 成为 web 和第三方的**上游数据源**，而不是它们的一个页面。

---

## 10. 实施顺序

### 10.1 实际进度（逐条核对代码，不是估计）

HTTP 层与凭据层都已落地。13 条 `/api/v1` 路由存在，`/api/v1/openapi.json` 也在。
下表逐条核对代码；偏离设计的地方都写出来，而不是留一个 ✅ 了事。

| 步骤 | 内容 | 迁移 | 状态 |
|---|---|---|---|
| 0 | `lib/redis/{client,lua,lock}.ts` 双驱动 + 限流 + 分布式锁 | — | ✅ **已实现**。偏离设计：限流用**固定窗口** `INCR`+`EXPIRE`（`lua.ts`）而非设计的滑动窗口 zset；key 前缀 `openmcp:console:api:rate-limit:` 而非 `rl:rpm:`。`RedisLike` 有 7 个原语而非 3 个（锁需要）。锁被 `notify-subscriptions` 用作跨实例单飞 |
| 2 | `api_keys` 表 + 管理员签发/吊销/轮换 + `lib/api/guard.ts` + 限流 | `0015_api_keys.sql` | ✅ **已实现**。scope 枚举与 §2.5 完全一致，tRPC 有 admin 与自助两族 |
| 2' | **用户自助签发 + 管理员治理**（§2.10 / §2.12 / §2.13） | `0022` + `0023` | ✅ **已实现**。`createMine` / `updateScopes` / `assertSelfServiceQuota` / `api_request_audit` 全部存在。**本轮修**：`createdBy` 曾被写成 `null`，现已改为 `input.userId`（§2.2） |
| 2'' | **接入方注册与配对**（§2.11） | `0025`（与幂等表同一次迁移） | ✅ **已实现**。`POST /api/v1/connections/redeem` + `/console/connections` + `connectionsRouter`。**偏离**：key 在**兑换时**签发而非建码时签发，见 §2.11。**本轮补**：建码曾绕过 §2.10 的邮箱验证（未验证小号可拿到能调的 key），现由 `createPairing` 内的 `assertEmailVerified` 挡住；兑换侧补 403 `quota_exceeded`（事务回滚，码不消费，撤销一把 key 后可重试）；`input.ip === null` 从"跳过限流"改成 fail-closed |
| 1 | `listStatsRange` + zod DTO + `GET /api/v1/repos/{id}/stats` | — | ✅ **已实现**。`listStatsRange`（`stats.ts:432`）/ `listStatsSince`（`stats.ts:544`）。**本轮修**：date-only 边界曾被 400（见 §4.1） |
| 3 | `POST /api/v1/repos` + 幂等表 + 登记回调 | `0025` | ✅ **已实现**。**偏离**：没有抽 `ingestRepo`，登记逻辑仍分散在路由与 service；回调事件名是 `repo.registered`、payload 是瘦的（§3.5 / §3.6）。幂等回放存 JSONB，所以**语义**一致而键序可能变；回放保留首次的状态码（新登记的重试仍是 201） |
| 4 | 排行与周期目录路由 | — | ✅ **已实现**。`/api/v1/rankings/{weekly,monthly,periods}` |
| 5 | `GET /api/v1/repos` 过滤器 + 分页 | — | ✅ **已实现**。过滤器与订阅共用 `lib/api/repo-filter.ts`；keyset 分页（§3.7）。**本轮修**：`platformTypes` / `categoryCodes` / `projectTypes` 的 `IN` 子句曾缺括号（`lib/api/repo-filter.ts` 的 `inList`） |
| 6 | `subscriptions` / `webhook_deliveries` 表 + `notify-subscriptions` + 重试/熔断 | `0024` | ✅ **已实现**。`lib/api/subscriptions.ts` 全套服务函数 + `/api/v1/subscriptions/*` 六条路由 + `notify-subscriptions` 任务 |
| 7 | `/console/subscriptions` + `/dashboard/subscriptions` | — | ✅ **已实现**。`subscriptionsRouter`（`listMine` / `create` / `update` / `remove` / `rotateSecret` / `sendTest` + `list` / `detail` / `disable`），两个页面共用 `components/subscriptions/subscriptions-table.tsx`。admin 侧只有 `disable` 可写，过滤器与 `callbackUrl` 不可写（§6.7）。**本轮补**：`api_request_audit.action` 加 `subscription.disable`，`api_key_id` / `key_prefix` 放宽为可空（订阅可以完全不属于任何 key） |
| 12 | **清理现有 `/api/*`**（§12） | — | 🟡 **部分**。`/api/internal/repos` 已删；4 个 `.json` 端点尚未收敛到 `/api/v1` 的服务函数 |

### 10.2 剩余步骤

§10.1 之后真正剩下的只有这些，其余标记 ✅ 的行不需要再排期：

| 剩余 | 内容 | 风险 |
|---|---|---|
| 3b | 抽 `lib/github/service/ingest-repo.ts`，让 `POST /api/v1/repos` 与 `repos.create` 真正共用一段逻辑（§3.1） | 低。纯重构，当前两者行为已一致 |
| 3c | 幂等的 `in_flight` 租约超时（§3.3 已知边界） | 中。要与业务写入同事务，或给预占加租约 |
| 5b | 分类可读化：`/dashboard/categories` 维护页 + `categories` tRPC router（消费 `listCategoryReviewQueue` / `categoryUsage`） | 中。**不是上线阻塞项**（§1.5 坑一：空词表是合法状态），但不做则运营无处配置 |
| 12a | 4 个 `.json` 端点收敛到 `/api/v1` 的服务函数（§12.3） | 低。纯内部重构 |
| 12b | 删除 web 侧死代码 `triggerConsoleSync`（`client.ts`） | 低 |
| 12c | `POST /api/v1/{repos,projects}` 与 `/connections/redeem` 的集成测试（鉴权 / scope / 语义 / 幂等 / 配对约束） | 中。当前只有手工验证 |

## 11. 待确认

**已由本轮确认并写死的（不再列为问题）**

- `repo_snapshots.subscribers` → console 侧的 `total_watchers` / `repos.watchers_count`，无需迁移（§4.4）。
- 限流载体 → 本地 Redis + Vercel Upstash，双驱动同一 `RedisLike` 接口（§2.8）。
- `mode: "snapshot"` → 保留，为第三方接入（§2.9）。
- 订阅支持项目类型多选、平台项目开关、平台项目类型、自己的 user-repo（§6.2、§6.6、§6.7）。
- **用户提交的 repo 不自动创建 `projects` 行**（§1.4）。理由是"建 project == 发布"，
  自动创建等于开一条未鉴权的写入公开面的路径。tRPC `repos.create` 与
  `POST /api/v1/repos` 语义保持一致。
- **`projectTypes` / `platformTypes` 是否拆成两套枚举 → 不拆**（§6.6 陷阱二）。
  新增的 `categories` 表已经提供了正交的一维，所以原来的 #3 由此得到答案：
  要拆的不是"radarType vs platformType"，而是 `categories`（运营分类）这一维本身。
- **第三方 key 的签发路径 → 已定**（原来的 #1，本轮关闭）。见 §2.10 / §2.11 / §2.12：
  用户自助签发自己名下（scopes 限子集、fail-closed 滥用防护），
  接入方走"console 侧发起的配对码 + 唯一豁免端点 redeem"，
  admin 保留 `tier: "service"` 的机器对机器签发。
  设计细节不再推迟 —— 推迟的理由（"需求细节取决于接入方是谁"）已经被
  "`apps/web` 就是那个接入方"这个事实消除了。
- **`categories` 空词表不是缺陷**（原来的 #6，本轮降级）。§1.5 坑一已重写：
  分类是运营配置的数据，程序只保证四条空状态断言，不保证词表非空。
  因此**没有"运营录入第一批分类之前不能上线"这种前置条件**。
  仍需拍板的只剩"谁写词表、粒度多少"，而它是运营决策不是工程阻塞 —— 见下面新的 #1。
- **管理员能否停用他人的订阅 → 能**（本轮新增，非待确认）。`/dashboard/subscriptions`
  的 `disable` 从只读改为可操作，理由见 §6.7。

**仍需拍板的**

1. **`categories` 词表谁来写、粒度多少**（§1.5 坑一衍生，**已不再是工程阻塞**）。
   表刻意不预置种子是对的（空词表让分类器闭嘴好过猜运营的分类法），
   现在需要的是运营决策：由谁写这份词表（运营 / 产品 / 从现有 `tags` 词表迁移），
   以及它与 `tags`（读者检索词，来自 GitHub topics）的边界。
   工程侧该做的都列在步骤 5b 里了；这一步只等运营给答案。
2. **`includeOwnSubmissions` 对 M2M key 的含义**。key 可以带 `submitterId`
   （§2.2），此时"自己的提交"= 该 `submitterId` 名下的 `userRepos`。
   但一个接入方通常提交了几百上千个仓库，都记在一个 `submitterId` 名下——
   这条订阅就会**几乎不过滤**，退化成"推全部"。
   是否给 `api_keys` 加一个"订阅不隐含 user_repo 关系"的默认？倾向默认 `false`
   （M2M 订阅默认不含 `includeOwnSubmissions`），因为 M2M 通常只想按类型订阅全量。
   注意这条与 §2.5 的"自助不给 `subscriptions:write`"是两件事：那条管的是谁可以签发 key，
   这条管的是 key 签发之后订阅的默认行为。
3. ~~**`platformTypes` 与 `projectTypes` 的重叠是长期状态还是过渡状态**~~ → **已回答，见上面
   "已写死"一节。** 原问题引用的是 `tags.confidence`，需要更正两处：
   `tags` 上的 `confidence` / `evidence` / `reviewed_at` 三列**在 schema 里存在
   （`db/schema/github.ts:374-376`），但 `apps/console/src/lib` 里没有任何代码写它们**。
   真正在跑的分类器是 `tasks/classify-projects.ts`，它写的是
   `projects.category_id` / `category_confidence` / `category_evidence`（0021）。
   所以这个问题原来的前提（"分类器打标是在 tags 上已经在做的事"）已经不成立，
   而它问的"要不要拆一套独立分类"已经有了现成答案：**就是 `categories` 表**。
   这条从"待确认"移到"已定"，且**不再附带"必须先做步骤 5b"这个条件**（§1.5 坑一已重写）。
4. **web 侧 `repo_snapshots.watchers` 列怎么处理**。§4.4 指出它当前存的是 star 数。
   是删列、还是保留并在写入时改成订阅数？删列需要 web 侧迁移，保留则名字继续骗人。
5. **`subscribers_count` 的实际信息量**。GitHub 在 2020 年调整过 watch 功能，
   很多仓库的 `subscribers_count` 可能与 `stargazers_count` 相等。
   建议在实现前先跑一次真实分布统计（`repos` 里两列的比例分布），
   再决定 web 侧要不要为它建列——如果 90% 的仓库两者相等，这一列的价值有限。
   console 侧无论如何都已经在存，不受影响。

---

## 12. 现有 `/api/*` 的清理与迁移

console 现在有 **21 个 API route 文件**，而本文到今天为止一条 `/api/v1` 都没有建。
这不是"还没开始"，是"两套并存的鉴权模型"：老端点用静态共享 token，新端点用可撤销的 key。
两套并存时，任何一次"哪个 token 该用在哪儿"的判断都是口头知识。

**处置原则（用户已确认：与本文设计冲突的，以本文为准）。**

1. **先分类，再动手。** 下表逐条给出处置，不允许"顺手删"。
2. **产品端点不参与这次清理。** auth / trpc / user / newsletter / cron 是 console 自己的
   页面后端，不是 Radar 开放 API。把它们算进"要清理的暴露 API"会导致删掉产品功能。
3. **有调用方的不能直接删。** `apps/web` 正在调三个端点，切换顺序见 §12.2。
4. **Radar 数据读取只留 `/api/v1` 一个入口。** 老 `.json` 端点保留 URL，但实现收敛到
   `/api/v1` 的同一个服务函数，避免两套计算逻辑漂移。

### 12.1 逐条处置

| 路由 | 现状 | 冲突 | 处置 |
|---|---|---|---|
| `POST /api/internal/repos` | ~~`CONSOLE_API_TOKEN` 静态 bearer~~ | ~~严重，两条~~ | ✅ **已删除**，见 §12.2 |
| `GET /api/skills-sync/export` | `SKILLS_WEBHOOK_TOKEN` bearer | 无（见 §12.4） | 保留 |
| `POST /api/cron/github` | `CRON_SECRET` bearer | 无 | 保留 + 删 web 侧死代码 |
| `POST /api/webhook/[task]` | `CRON_SECRET` bearer | 无 | 保留 |
| `GET /api/rankings/week.json` | **匿名**，无鉴权 | **中**（§12.3） | 保留 URL，收敛实现 |
| `GET /api/rankings/month.json` | **匿名**，无鉴权 | **中**（§12.3） | 保留 URL，收敛实现 |
| `GET /api/rankings/rising-stars.json` | **匿名**，无鉴权 | **中**（§12.3） | 保留 URL，收敛实现 |
| `GET /api/anomalies.json` | **匿名**，无鉴权 | 无（本文不做 anomalies 接口） | 保留不动 |
| `/api/auth/*`（含 `open-api/*`） | better-auth | 见 §12.5 | 保留，单独记一条 |
| `/api/trpc/*` | 会话 | 无 | 保留，产品内部 |
| `/api/user/*` | 会话 | 无 | 保留 |
| `/api/newsletter/subscribe` `/unsubscribe` | 匿名 | 见 §12.5 | 保留，单独记一条 |
| `/api/cron/github` 的 web 侧封装 `triggerConsoleSync` | 死代码 | — | **删**（`apps/web/src/lib/console/client.ts:249`） |

#### 12.2 `POST /api/internal/repos` 是必须下线的那一条

它同时踩中本文两条已经写死的决策，而且**现在就在生产被调用**：

**冲突一：它会创建 `projects` 行，直接违反 §1.4。**
`ingestFromUrl` 在 `route.ts:130` 调 `createProjectFromRepo(db, { url, type }, { logger })`，
文件头注释自己写得很清楚："the heavy lifting is `createProjectFromRepo`, the same call the
console's create dialog makes, so a repository registered from the web app is **indistinguishable
from one an operator curated by hand**"。

而 web 的 `ingestRepoByUrl`（`apps/web/src/lib/console/client.ts:184-196`）发出去的正是
`{ url, type }`，其中 `type: ConsoleProjectType = 'skill'`（`:40`）。**也就是说，
web 侧每一次创作者粘贴仓库 URL，都会同步创建一条 `projects` 行。**

按 §1.4，"建 project == 公开发布"。一个持有 `CONSOLE_API_TOKEN` 的接入方因此获得了
**把任意仓库推上公开站的权限** —— 这正是 §1.4 要消除的那条未鉴权写入公开面的路径，
只不过今天它是鉴权过的，而 §1.4 的论点不是"没有鉴权"，是"提交不应该有发布的副作用"。

**冲突二：它的权限模型是一个静态共享 token，没有 scope、没有归属、不可撤销、不可审计。**
`CONSOLE_API_TOKEN` 是**全站一个值**（`env.ts:157-159`（`apiToken()`））：拿到的 web 与拿到的任何人都一样，
无法区分"web 提交的"与"某个第三方提交的"，也无法在怀疑泄露时只吊销一方而保住另一方。
对比 §2.2 的 `api_keys`：每把 key 有 `user_id`、`scopes`、`expires_at`、`revoked_at`、
`last_used_at`。

**冲突三（次要）：它还耦合了 skills 文档投递。** `ingestFromUrl` 在建完 project 后调
`deliverSkills(projectId, logger)`（`route.ts:173`）把 skill 文档推给 web，
并在 `created.status === "existing"` 时补一次 `syncSkillsForProject`（`route.ts:148-152`）。
这条链把"Radar 仓库登记"和"技能文档投递"耦在一个 handler 里，与 §6 的订阅推送重复表达
同一件事。

**已实施（2026-10）**：不再是计划，代码已落地。

原方案的第 2 步是"把 web 改调 `/api/v1/repos`"，**这一步是错的**，而且是照抄会写坏功能的
那种错：`/api/v1/repos` 按 §1.4 不建 project，于是 web 侧每一次创作者粘贴仓库 URL 都会
**只登记、不发布**——`repos` 里有行，`projects` 里没有，站上那个 listing 指向一个不存在的
project。原来的 `/api/internal/repos` 虽然越权，但它至少**创建了** project，所以直接换过去
等于把"越权发布"换成"静默不发布"，后者更难发现。

因此拆成两个端点，让 web 拿 `projects:write` 走需要它的那一个：

| 端点 | scope | 写 | 公开面可见 |
|---|---|---|---|
| `POST /api/v1/repos` | `repos:write` | `repos`、`user_repos` | 否 |
| `POST /api/v1/projects` | `projects:write` | `projects` + README + 技能文档 | **是** |

实际改动：

- 新增 `apps/console/src/app/api/v1/repos/route.ts`（`repos:write`，不接受 `type`）
  与 `apps/console/src/app/api/v1/projects/route.ts`（`projects:write`）。
- `apps/console/src/lib/api/scopes.ts` 增加 `projects:write`。
  现有 `apiKeys.create` 用 `z.enum(API_SCOPES)` 动态校验，所以**管理员已经能逐 key 授予**它，
  不需要新的 mutation。
- 删除 `apps/console/src/app/api/internal/repos/route.ts`，并从 `apps/console/src/lib/env.ts`
  移除 `CONSOLE_API_TOKEN` 与 `apiToken()`。**没有**留 `410` 过渡期：`/api/internal/repos`
  的唯一调用方是同 repo 内的 web，可以同一个 PR 换完。
- web `apps/web/src/lib/console/client.ts` 的 `ingestRepoByUrl` 改调 `POST /api/v1/projects`，
  凭据从 `CONSOLE_API_TOKEN` 换成 `CONSOLE_API_KEY`（`turbo.json` 同步改名）。
  **旧的 `GITHUB_NEXTJS_API_BASE_URL` / `CONSOLE_API_TOKEN` / `GITHUB_NEXTJS_API_TOKEN`
  都不再作为 fallback 接受**，否则一个本该在部署里显式更新的集成会继续静默工作。
- `deliverSkills` 从 route 里抽成 `apps/console/src/lib/github/service/deliver-project-skills.ts`
  的 `deliverProjectSkills(db, projectId, deps)`：保留"调用方在等"的语义（§12.2 冲突三），
  但它不再是某个 handler 的私产。**只在 `type === "skill"` 时调用**——别的类型没有技能文档可投，
  跑了也只会得到一个关于零个技能的、调用方无从判断真假的 `delivered: true`。
- 文档站 `console-api/ingest` 页改名为 `console-api/projects`，重写为两个端点。

> **一条容易漏的检查**：`CONSOLE_API_TOKEN` 删除后，
> `apps/web/src/lib/console/client.ts` 的 `consoleApiConfigured()` 在没配 `CONSOLE_API_KEY`
> 时是 `false`，`ingestRepoByUrl` 抛 `ConsoleApiError(..., 404)`。调用点会把它显示成
> "console 未配置"，而用户看到的其实是"我们的部署漏了一步"。所以换凭据和删端点
> **必须同一个 PR 或相邻 PR**，中间留一天就会有一批用户看到误导性的报错。

#### 12.2.1 `/api/v1/projects` 里那个同步等待

新端点保留了在响应前同步推完技能文档的行为，`maxDuration = 300`。这不是新耦合，是
§12.2 冲突三那条链的搬运：唯一还在同步等待技能到达的调用方是 `apps/web` 的创作者流程，
删掉它会让创作者在下一次调度之前一直看到"未就绪"。失败不报错——行已进 `push-skills`
的重试队列，`delivered` 让调用方自己决定怎么提示。

**待办**：两个新端点都还没有集成测试；`/api/v1/repos` 的幂等表与首次拉取回调（步骤 3）
也还没做。

#### 12.3 四个匿名 `.json` 端点

`week.json` / `month.json` / `rising-stars.json` / `anomalies.json` **都没有鉴权**，
且与 §5 的 `/api/v1/rankings/*` 争夺同一批数据。这不是"要不要开放"的问题 ——
它们已经公开了 —- 而是"要不要让它们继续自己算一份"。

三个具体问题：

- **每次请求都重算。** 排行靠 `buildRankingsForWeek` / `buildRankingsForMonth` 生成，
  而 `.json` 端点在请求路径上调用它，没有物化表也没有缓存头，
  公开流量下等于每个爬虫一次全表扫。
- **`week.json` 返回"带 body 的 404"。** 它把"未构建"表达成 404 + JSON body。
  对人类读者没问题，对客户端是个陷阱：多数 HTTP 客户端见到 404 就不解析 body 了。
- **两个排行来源会漂移。** 匿名端点算一份，`/api/v1/rankings/*` 再算一份，
  §5 定的 `filters_version`、`tie_break`、`RANKING_FIELDS` 三处约定只对后者有效。

**处置**：保留这四个 URL（它们已写进 `apps/doc`、进 `llms.txt`、landing hero 在宣传），
但把实现改成 `/api/v1/rankings/*` 所用的**同一个服务函数**的薄投影：

```
/api/v1/rankings/*        ← 有 key，可鉴权，带 filters_version 等完整字段
/api/rankings/week.json   ← 匿名，投影到同一个 service 函数，只保留历史字段子集
```

`anomalies.json` 在本文没有对应的 `/api/v1` 接口（§5 不含 anomalies），所以它不涉及
"两套实现"，**本次不动**。

**为什么不干脆给 `.json` 端点加 key**：`week.json` 的 URL 已经在 `llms.txt` 里公开，
加上鉴权会让所有已发布的链接立刻 401。这是一次破坏性变更，而收益（防止爬虫）
可以用物化表 + 缓存头拿到，成本低得多。**先优化，后鉴权。**

#### 12.4 `/api/skills-sync/export`

不属于 Radar 开放 API，是"console → web 的技能文档拉取"，垂直方向独立，**保留**。
但要改一处：**现在 `SKILLS_WEBHOOK_TOKEN` 同时承担两个方向的凭据** —— console 用它校验
web 的入站拉取（`GET /api/skills-sync/export`），也用它签名出站推给 web
（`POST` 到 `SKILLS_WEBHOOK_URL`）。一个 secret 双向通用，意味着**能读全部 skill 文档
就能伪造任意 skill 推送**。

改为两个独立变量（`SKILLS_EXPORT_TOKEN` / `SKILLS_PUSH_SECRET`），web 侧对应的
`consoleSkillsToken()` 拆成两个。`apps/web/src/lib/console/client.ts:104-116` 那段注释
已经把两个方向分开表达的意图写清楚了，这一步只是把 console 侧也分开。

#### 12.5 不在本次范围、但记一笔的两处

- **`GET /api/newsletter/subscribe` / `unsubscribe` 匿名且无限制。** 它是一个开放的邮件中继：
  任何人可以用它给任意地址发信（走 Resend）。业务上确实是订阅语义，风险靠 Resend 侧的
  域名信誉和限流兜。要治就该加 IP 限流 + 双重确认，属于 newsletter 的范围，不是 Radar。
- **better-auth 的 `openAPI()` 插件把整个鉴权接口面匿名暴露在 `/api/auth/open-api/*`。**
  它是 better-auth 的调试便利功能，生产环境应该关掉或用 `NODE_ENV` 挡掉。
  这不是本文引入的，但"清理暴露 API"这个需求理应覆盖它。

这两条都写在这里，是因为**它们属于"目前暴露的 API"这个问题**，
但删掉/改掉它们不需要等 `/api/v1` 上线，可以独立处理。