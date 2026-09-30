# GitHub 仓库与 Skills 数据 Webhook 同步设计方案


> **上架策略（2026-09-20）**：以扫描门控为准，见 [SKILLS_PUBLISH_POLICY.md](./SKILLS_PUBLISH_POLICY.md)。禁止「同步即 published」。

> **路径说明（2026-09-20）**：本文接口路径已与当前实现对齐为 `/api/webhook/daily`（仓库）与 `/api/webhook/daily/skills`（Skills）。旧稿中的 `/api/webhooks/repos|skills` 已废弃。

## 1. 背景与目标

- **github-nextjs**：用户录入 GitHub 仓库 URL 与类型（skill / persona / application 等），应用自动抓取 GitHub 信息入库，并通过 Webhook 将结果同步到 openmcp。
- **openmcp**：提供两个 Webhook 接口接收同步数据：
  - **Repos Webhook**：接收仓库与作者信息，写入 `repos`、`authors`，统计数据写入 `repo_snapshots`（按天一条，重复则更新）。
  - **Skills Webhook**：接收同步后的 skill 数据，写入 `skills` 表。

## 2. 数据流总览

```
[用户] 录入仓库 URL + 类型 (github-nextjs)
    ↓
createProjectAction / 定时任务
    ↓
updateGitHubDataTask：抓取 GitHub 数据 → 更新 repos → 写 snapshots → 发送 Repos Webhook
    ↓
(若 type=skill) runSkillSyncForProject：拉取 SKILL.md → 解析/翻译 → 发送 Skills Webhook
    ↓
openmcp POST /api/webhook/daily   → 写 authors / repos / repo_snapshots
openmcp POST /api/webhook/daily/skills  → 写 skills
```

## 3. 表与职责

| 系统 | 表 | 职责 |
|------|---|------|
| openmcp | `authors` | 作者信息，由 repos webhook 根据 `owner` / `owner_id` 创建或更新 |
| openmcp | `repos` | 仓库主信息，与 github-nextjs 的 repos 字段对应（含 type） |
| openmcp | `repo_snapshots` | 按天一条的统计数据（含 `week` 周数），同一天同一仓库重复同步则只更新统计字段 |

## 4. Repos Webhook 设计

### 4.1 接口

- **URL**：`POST /api/webhook/daily`
- **请求体**：沿用 github-nextjs 现有格式 `RepoWebhookRequest`（见 `apps/github-nextjs/src/lib/webhook/repo-webhook-schema.ts`）
  - `event_type: 'repo_updated'`
  - `timestamp`: ISO 字符串
  - `data`: `RepoWebhookData`（id, full_name, name, owner, owner_id, 描述/统计/时间/README/Release/processing_status/meta 等）

### 4.2 扩展约定（可选）

- 若希望 openmcp 的 `repos.type` 与录入类型一致，可在 **github-nextjs** 侧在构造 webhook 时增加字段：
  - `data.type?: 'skill' | 'persona' | 'tools' | 'apps'`（来自当前 project.type，未传时 openmcp 默认 `'skill'`）。

### 4.3 处理逻辑（openmcp）

1. **校验**  
   - 仅接受 `event_type === 'repo_updated'`。  
   - 校验 `data` 必填：`id`, `name`, `owner`, `owner_id`。  
   - 可选：校验签名（如 `x-webhook-signature` / `DAILY_WEBHOOK_TOKEN`），与 wechat webhook 类似。

2. **作者（authors）**  
   - 以 `data.owner` 作为唯一标识（对应 `authors.username`）。  
   - 若不存在则插入：`username = owner`，`name` 可用 `owner`，`avatarUrl` 可用 `https://avatars.githubusercontent.com/u/${owner_id}`，其余可选。  
   - 若已存在则按需更新（如 `avatarUrl`）。  
   - 得到 `authorId` 供 repos 使用。

3. **仓库（repos）**  
   - 将 `data` 的 snake_case 映射为 openmcp `repos` 的 camelCase 字段（与 mcp-schema 中 `repos` 一致）。  
   - `id`、`name`、`owner`、`owner_id`、`pushed_at`、`created_at` 必填；其余按 payload 有则填。  
   - `authorId` 使用上一步的 `authorId`。  
   - `type`：若 payload 带 `data.type` 则用，否则默认 `'skill'`。  
   - 使用 **upsert**：存在则更新，不存在则插入（以 `repos.id` 或 `(owner, name)` 唯一索引为准）。

4. **快照（repo_snapshots）**  
   - 以 `data.meta.processed_at` 的日期为准（若无则用服务端当前日期），得到 `year`、`month`、`day`。  
   - **周数 `week`**：根据同一日期计算“当年第几周”（如 ISO 8601 周，或 `getWeek(processed_at)`），写入 `week` 字段，用于按周聚合或筛选。  
   - 统计字段从 `data` 映射：stars, forks, watchers_count → watchers, mentionable_users_count, pull_requests_count → pullRequests, releases_count → releases, contributor_count → contributors 等（与 `repo_snapshots` 列名一致）。  
   - **唯一性**：同一 `repoId` + `year` + `month` + `day` 仅保留一条记录。  
   - 若该日已有记录：仅更新统计字段（及 `updated_at`）；若无则插入新行。  
   - 为实现“每天一条、重复则更新”，需在 `repo_snapshots` 上增加唯一约束（或唯一索引）`(repo_id, year, month, day)`，便于 upsert。

### 4.4 响应与错误

- 成功：`200`，Body 可为 `{ ok: true }` 或空。  
- 校验失败：`400`。  
- 服务端错误：`500`，并打日志。

---

## 5. Skills Webhook 设计

### 5.1 接口

- **URL**：`POST /api/webhook/daily/skills`
- **请求体**：沿用 github-nextjs 现有 `SkillWebhookPayload`（见 `apps/github-nextjs/src/lib/skill-sync/send-skill-to-web.ts`）
  - `event_type: "skill_updated"`
  - `timestamp`
  - `data`: repo_full_name, repo_name, repo_owner, skill_dir, name, description, description_zh, readme, readme_zh, version, category_id, features, scenario, license, tools

### 5.2 处理逻辑（openmcp）

1. **校验**  
   - `event_type === 'skill_updated'`，且 `data` 必填：`repo_full_name`、`repo_owner`、`skill_dir`、`name`。  
   - 可选：与 repos 一致做签名校验。

2. **作者（authors）**  
   - 以 `data.repo_owner` 作为 `authors.username` 查找或创建（与 repos webhook 一致，可用 GitHub 头像 URL），得到 `authorId`。

3. **Skill 写入（skills）**  
   - `referenceId`：唯一标识，建议 `repo_full_name + '#' + skill_dir`（或与现有 openmcp 约定一致）。  
   - `slug`：可复用 `referenceId` 或做 URL 安全化。  
   - `title` ← `data.name`，`description` ← `data.description`，`readme` ← `data.readme`，`descriptionEn` / `readmeEn` 用英文字段（若有）。  
   - `authorId` 为上一步得到的作者 ID。  
   - `categoryId`：**入库时置空**，由后续「Skill 分类与安全 enrichment」异步任务通过 AI 填写。  
   - **入库先进入扫描门控**：`status: 'scanning'`，`publishedAt: null`，`certified: false`（未人工认证）。其余默认：`priceType: 'free'`，计数为 0。  
   - **upsert**：按 `referenceId`（或 `slug`）唯一，存在则更新，不存在则插入。  
   - **不阻塞响应**：异步调用 `runSkillSecurityScan`；扫描结束后按 [SKILLS_PUBLISH_POLICY.md](./SKILLS_PUBLISH_POLICY.md) 写入 `securityGrade` 与最终 `status`（safe/caution→按规则自动 `published`；unsafe→`pending_review`；reject→`rejected`）。  
   - **Enrichment**：仅在自动上架档（现行 safe/caution）扫描成功后异步执行，**不得**单独决定上架。

### 5.3 响应与错误

- 成功：`200`。  
- 校验失败：`400`。  
- 服务端错误：`500`，并打日志。

### 5.4 Skill 分类与安全 Enrichment（同步结束后异步执行）

- **触发时机**：所有同步结束之后异步执行。即 Skills Webhook 成功写入 DB 后，在**不阻塞响应**的前提下触发（如 fire-and-forget 或入队），对**当前写入或更新的 skill** 执行一次 enrichment；若为批量同步，可在批量结束后对本次涉及的所有 skill 统一触发一次。
- **输入**：数据库中**全部分类列表**（`categories` 表，仅 `isActive = true`），以及该 skill 的 `title`、`description`、`readme`（中英文均可）。
- **AI 职责**（结构化输出）：  
  1. **唯一分类**：根据 skill 内容从给定分类列表中选出**恰好一个**分类（返回分类 slug 或 id）。  
  2. **（可选）内容标签**：enrichment **不再**作为上架门控；门控评级以扫描写入的 `securityGrade` 为准。`securityLevel` 仅为遗留镜像字段。  
  3. **应用场景**：短文本描述应用场景，写入 `skills.metadata.scenario`。  
  4. **特性**：若干关键词或短语，写入 `skills.metadata.features`（数组）。
- **执行流程**：读取全部分类 → 调用 AI（传入分类列表 + skill 内容）→ 解析出 category slug、securityLevel、scenario、features → 根据 slug 解析出 `categoryId` → 更新该 skill 的 `categoryId`、`securityLevel`、`metadata`（合并 scenario、features，不覆盖其他 metadata）。  
- **失败与重试**：单条 enrichment 失败仅打日志，不影响其他 skill；可选后续通过定时任务对 `categoryId` 为空或 `securityLevel` 为 `pending` 的 skill 重试。

---

## 6. Skills 展示需求与数据满足度分析

### 6.1 页面实际使用的字段

- **列表页**（`getSkills`）：仅查询 `status === 'published'` 的 skill。展示字段：id, slug, title, titleEn, description, descriptionEn, imageUrl, priceType, certified, views, downloads, likes, publishedAt, createdAt，以及关联的 author（id, name, username, avatar, verified）、category（id, name, nameEn, slug）。排序可选 publishedAt、downloads、views、popularity 等。
- **详情页**：title/titleEn、description/descriptionEn、readme/readmeEn、imageUrl、author、category、certified、priceType、createdAt、updatedAt、views、downloads。

### 6.2 Webhook 入库能提供的字段

| 展示需求 | Webhook 来源 | 是否满足 |
|----------|--------------|----------|
| title | data.name | ✅ 直接映射 |
| titleEn | 无 | ⚠️ 可缺省或与 name 一致 |
| description | data.description | ✅ |
| descriptionEn | 无（当前 payload 仅 description_zh） | ⚠️ 英文用 description，或后续 payload 增加 |
| readme / readmeEn | data.readme, data.readme_zh | ✅ 可映射为 readme/readmeEn 或中英分离 |
| author | data.repo_owner → 查/建 authors | ✅ 可满足 |
| category | data.category_id → categoryId | ⚠️ 依赖 openmcp 已有对应分类，否则为 null |
| imageUrl | 无 | ❌ payload 未传，可用 repos 表同仓库 icon_url 或占位图 |
| priceType / certified / views / downloads | 无 | ✅ 用默认值（free、false、0）即可 |
| publishedAt | 无 | ⚠️ 未传则列表按日期排序会退化为 createdAt 或需单独“发布”时写入 |
| **status** | 先 `scanning`，扫描后按门控规则 | ✅ 见 SKILLS_PUBLISH_POLICY |
| **certified** | 默认 false；仅人工 pass 为 true | ✅ 与「扫描自动上架」区分 |

### 6.3 结论与建议

- **已约定（扫描门控）**：入库 `status: 'scanning'`，不可对用户可见；扫描完成后按规则自动上架或进人工复核。`certified` 仅人工审核通过后为 true。分类 enrichment 在可上架档扫描成功后异步填写。
- **需补齐或约定**：
  1. **imageUrl**：webhook 不传时可从同仓库的 `repos.iconUrl` 带出（通过 referenceId 解析 repo），或使用统一占位图。
  2. **category**：由异步 enrichment 根据全部分类列表 + AI 判断唯一分类后写入，无需 payload 提供。

---

## 7. 配置与安全

- **github-nextjs**  
  - Repos：`DAILY_WEBHOOK_URL`（可多个，逗号分隔）、`DAILY_WEBHOOK_TOKEN`（可选）。  
  - Skills：`SKILLS_WEBHOOK_URL`、`SKILLS_WEBHOOK_TOKEN`（可选）。  
- **openmcp**  
  - 若使用 Token 校验，需配置与发送端一致的 secret，并在两个 webhook 的 POST 中校验 `x-webhook-signature` 或等价头。

## 8. 数据库变更（openmcp）

- **repo_snapshots**：
  - 已增加字段 **`week`**（integer, notNull）：表示该条快照所属“当年第几周”，由写入时的 `year/month/day`（或 `processed_at`）计算得出，便于按周统计与展示。
  - 为支持“同 repo 同天只保留一条并更新”，增加唯一约束（或唯一索引）`UNIQUE (repo_id, year, month, day)`，便于 upsert。

## 9. 实现顺序建议

1. **openmcp**  
   - 为 `repo_snapshots` 增加 `(repo_id, year, month, day)` 唯一约束/索引。  
   - 实现 `POST /api/webhook/daily`（authors → repos → repo_snapshots，含 `week` 计算）。  
   - 实现 `POST /api/webhook/daily/skills`（authors → skills；`status=scanning`，`certified=false`；异步 `runSkillSecurityScan`；按 SKILLS_PUBLISH_POLICY 上架）。  
   - 实现 **Skill 分类 Enrichment**（扫描通过可上架档之后）：更新 categoryId / scenario / features 等；**不**覆盖 `securityGrade` 门控。  
2. **github-nextjs**（可选）  
   - 在构造 `RepoWebhookRequest` 时注入 `data.type`（来自 project.type），便于 openmcp 正确设置 `repos.type`。

---

确认本方案后，按上述顺序修改代码。
