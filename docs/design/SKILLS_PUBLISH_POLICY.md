# Skills 上架与扫描门控策略（统一规范）

> 状态：产品 + 实现对齐稿（2026-09-20）  
> 依据：产品方确认「同步后不可直接上架；须人工审核或按规则自动上架」；以 **扫描门控** 为准。  
> 代码锚点：`src/lib/security-scan/run-scan.ts`、`src/app/api/webhook/daily/skills/route.ts`、`src/web/skill-reviews/index.ts`

---

## 1. 原则

1. Webhook / ZIP 入库后 **不得** 直接对市场可见。  
2. 必须先完成安全扫描（规则 + 必要时 LLM）。  
3. 扫描结束后：  
   - **按规则自动上架**，或  
   - **进入人工复核**，通过后再上架。  
4. 市场列表仅展示 `status === 'published'`（见 `src/web/skills/index.ts`）。

---

## 2. 字段语义（统一）

| 字段 | 角色 | 取值 / 含义 |
|------|------|-------------|
| **`securityGrade`** | **唯一门控评级** | `safe` / `caution` / `unsafe` / `reject` / `unknown` |
| **`securityLevel`** | 遗留兼容 | 代码中与 `securityGrade` 同步写入；**新逻辑只读 `securityGrade`**，勿再扩展 Level 语义 |
| **`status`** | 资产生命周期 | 见 §3 |
| **`reviewStatus`** | 人工审核进度 | `pending_review` / `passed` / `rejected` / `needs_revision` |
| **`certified`** | **人工认证徽章** | 仅 Admin 审核 **通过（pass）** 时置 `true`（并写 `certifiedAt` / `certifiedBy`）。扫描自动上架 **不会** 置 true |

### 2.1 `certified` 统一含义

- `certified=true`：经过 **人工复核通过**（或未来「平台官方认证」流程），可信度高于「仅扫描通过」。  
- `certified=false`：未获人工认证——包括仍在扫描、待复核、已驳回，以及 **规则自动上架** 的 safe/caution。  
- 市场可用「已认证」筛选；自动上架资产可以带 `securityGrade` 徽标，但不等于 certified。

---

## 3. `status` 状态机（与代码一致）

```
[入库] → scanning
           │
           ▼  runSkillSecurityScan
     ┌─────┴─────────────────────────────┐
     │                                   │
 grade ∈ SKILLS_AUTO_PUBLISH_GRADES   grade = unsafe
 (默认: safe；caution 默认可进人工)        │
     │                                   ▼
     ▼                            pending_review
 published ◄──────── Admin pass ─────────┤
     │                                   │
     │                            Admin reject → rejected
     │                            needs_revision → needs_revision
     │
 grade = reject → rejected（自动，写 skill_reviews.auto_reject）
```

Schema 枚举：`draft` | `scanning` | `published` | `pending_review` | `rejected` | `needs_revision` | `archived`。

---

## 4. 自动上架规则（最优建议 + 现行实现）

### 4.1 现行代码规则（v1 — 可配置自动上架）

对应 `statusFromGrade()` + `getAutoPublishGrades()`（`src/lib/security-scan/run-scan.ts`）：

环境变量 **`SKILLS_AUTO_PUBLISH_GRADES`**：逗号分隔的可自动上架 `securityGrade` 列表。

| 配置示例 | 行为 |
|----------|------|
| **`safe`（默认）** | 仅 `safe` → `published`；`caution` → `pending_review` |
| `safe,caution` | 与旧宽松策略一致：safe/caution 均自动上架 |
| _(空字符串，显式设为空)_ | 解析时回退为默认 `safe`；若需「全部人工」请设为不含任何合法 grade 的值（如 `none`）或不包含 safe/caution |

| `securityGrade` | 结果 `status` | 说明 |
|-----------------|---------------|------|
| ∈ `SKILLS_AUTO_PUBLISH_GRADES` | `published` | 自动上架，`certified=false` |
| `caution`（且不在集合内） | `pending_review` | 人工复核；写 `skill_reviews` + 通知 admin |
| `unsafe` | `pending_review` | **硬规则**强制人工 |
| `reject` | `rejected` | **硬规则**自动驳回（`auto_reject`） |
| 其他 | `draft` | 兜底 |

**不可配置的硬规则（始终生效）：**

- `reject` → 永远自动 `rejected`  
- `unsafe` → 永远 `pending_review`  
- 未完成扫描 → 不可 `published`

```bash
# 推荐默认（比旧 v0 更严：caution 进人工）
SKILLS_AUTO_PUBLISH_GRADES=safe

# 冷启动宽松
# SKILLS_AUTO_PUBLISH_GRADES=safe,caution
```

入库时 webhook/ZIP 先写 `status: scanning`，`publishedAt` 保持空，直到扫描判定为 published 才写入时间。

### 4.2 档位对照

| 规则档位 | `SKILLS_AUTO_PUBLISH_GRADES` | 适用 |
|----------|------------------------------|------|
| **推荐默认** | `safe` | caution 走 `pending_review`，降低误上架 |
| **宽松** | `safe,caution` | 冷启动、内容少 |
| **更严** | 不含 safe（如 `none`） | safe/caution 均人工；reject/unsafe 硬规则不变 |

文档与产品验收以本节为准；改代码时同步改本表。

### 4.3 Enrichment

仅在扫描结果为已自动上架档（∈ `SKILLS_AUTO_PUBLISH_GRADES`）后异步跑分类 / 文案 enrichment（`runSkillEnrichment`）。**Enrichment 不得改变上架门控**（不得单独把 draft 改成 published）。

---

## 5. 人工审核（与 Admin UED / 代码对齐）

Admin `pass`：

- `status → published`  
- `reviewStatus → passed`  
- **`certified → true`**（统一语义）  
- 写入 `certifiedAt` / `certifiedBy`

Admin `reject` → `rejected`；`needs_revision` → `needs_revision`。

详见 `ADMIN_REVIEW_QUEUE_UED.md`。

---

## 6. 与 PRODUCT.md 的关系

核心闭环：Provider 上传 → **扫描门控 +（规则自动或人工）上架** → 用户免费/付费获取。  
用户侧获取见 `USER_MARKETPLACE.md`。
