# 管理端定价域分离设计补充：毛利可比、成本锁点与商业口径

> 状态：设计补充（待合入主设计决策）
> 关联原文：`docs/admin-pricing-domain-split-design.md`（**不修改原文**；本文件只追加约束与验收）
> 来源：对原文「逻辑完备性 / 商业闭环」评审后的补强项
> 分支建议：可与 `develop-ontoroute-media` 同批实施，或作为该设计的前置决策附录

---

## 0. 本补充解决什么

原文已确认 B2（零售 per-model + COGS per-line）、P0-6/P0-7 修正路径、三条不变量与迁移/验收主清单。实施前仍缺五类会直接导致**毛利算错、验收说不清、或账期不可信**的约束：

| # | 缺口 | 若不补的后果 |
|---|---|---|
| S1 | 毛利率列的比较单元未定义 | 管理端数字与按线路归集毛利对不上；AC#9 不可验 |
| S2 | 零售与 COGS 用量/舍入计算器可能分叉 | `retailAmount − cogsAmount` 系统性偏差 |
| S3 | `occurredAt = created_at` 缺产品语义 | 超时/长 pending 订单毛利口径扯皮 |
| S4 | History 联合类型判别与写入约束未钉死 | LLM/媒体 history 混读 silently 取错 |
| S5 | 商业口径门禁（历史回填、Proxy 双计、P0-3）未声明 | 报表误用、双计收入、定价闭环在资金层断裂 |

以下条款**覆盖并细化**评审建议；与原文冲突时，以本补充为实施约束，原文决策表（B2、路由删除、同批范围等）仍以原文为准。

---

## 1. S1 — 毛利率列：比较单元与矩阵相减规则

### 1.1 产品定义

管理端 `MediaPricesTable` 的「毛利率」列展示的是**标价毛利率（list margin）**，不是「某次真实请求的已实现毛利」。

比较单元固定为：

1. **主单位价（primary unit price）**
   - image：`billingConfig` / `cogs_media_profile` 的基础 `pricePerImage`（或与 `models.inputPrice` 兜底对齐的那一档），**不含** size/type/resolution 矩阵加价
   - video：基础 `pricePerSecond`（或文档约定的默认时长档，见下），**不含** resolution 矩阵
   - audio：`pricePerRequest`（或 `per_minute` / `per_second` 的基础单价），**不含**矩阵
2. 公式：

```text
marginRate = (retailPrimary − cogsPrimary) / retailPrimary
```

3. 展示：
   - COGS 缺失 → `—` 并标红（与原文 §5.3 一致）
   - `retailPrimary <= 0` → `—` 并标红（禁止除零；视为配置错误）
   - 币种不一致 → `—` 并标黄，tooltip 写明「零售/COGS 币种不一致，禁止相减」（见 §1.3）

### 1.2 矩阵与 `resolutionPriceMode`

零售与 COGS 的矩阵**不得在毛利率列里做 cell-by-cell 隐式相减**。矩阵仅用于：

- 运营编辑与摘要展示（原文 §4.4）
- 真实请求结算（S2 的同构计算器）

额外校验（管理端保存 COGS / 零售时执行）：

| 条件 | 行为 |
|---|---|
| 一侧有 `resolutionPrices`，另一侧缺失 | 允许保存；毛利率列仍只用主单位价；巡检列出「矩阵不对称」 |
| 两侧都有 `resolutionPriceMode`，且一个为 `absolute`、一个为 `surcharge` | **拒绝保存**，错误信息明确要求模式对齐 |
| 两侧 `unit` 不一致（如零售 `per_second`、COGS `per_request`） | **拒绝保存** |

可选增强（本批不做 UI，只留数据巡检）：按矩阵 key 求 `(retail_cell − cogs_cell) / retail_cell` 的 min/max，写入运维巡检报表，不进主表列。

### 1.3 币种

- `MediaCogsProfileV1.currency` 必填；回填迁移时缺省补与零售一致的币种（与平台记账币，通常 `CNY` 或现网 `models`/`billingConfig` 已用币种）
- 零售侧若无独立 currency 字段，以平台默认记账币为准，并在 resolver 返回中显式带出 `currency`
- **毛利率列与按线路 `SUM(retail)−SUM(cogs)` 报表**：仅在币种一致时计算；否则排除并计入对账差异

### 1.4 验收（增补原文 §7）

| # | 项 | 验证方式 |
|---|---|---|
| S1-a | 主单位价毛利 | 零售主价 4.00、COGS 主价 2.80，断言毛利率列 = 30%，且不受 sizePrices 影响 |
| S1-b | 模式不一致拒存 | 零售 `resolutionPriceMode=absolute`、COGS=`surcharge`，断言 mutation 失败 |
| S1-c | 币种不一致 | 零售 CNY、COGS USD，断言毛利率列为 `—`，不产生数值 |

---

## 2. S2 — 零售与 COGS 共用用量/舍入实现

### 2.1 不变量

对任意一次已结算媒体订单：

```text
retailAmount = f(usage, retailPriceTable)
cogsAmount   = f(usage, cogsPriceTable)
```

其中 **`f` 必须是同一套实现**（同一 round-up、`videoMinDuration`、`billingUnit`、`imagesPerBatch`、duration 取整规则），只替换价表。禁止 COGS 路径手写第二套 `duration * price` 公式。

### 2.2 实现约束

1. 将现有 `calculateImageCost` / `calculateVideoCost`（及 audio 等价逻辑）抽象为：

```ts
calculateMediaCost(usage, priceTable: MediaBillingLike): { amount; breakdown; unit }
```

`MediaBillingLike` 同时覆盖 `billingConfig.*` 与 `MediaCogsProfileV1` 的同构字段（原文已要求同形）。

2. `writeFacts` / `recordMediaSpend`：
   - 零售金额：继续用结算已得出的 `totalPrice`（与冻结/结算一致），并写入 `retailInputPriceApplied` / `retailOutputPriceApplied`（补齐原文 §9.1）
   - 成本金额：`calculateMediaCost(actualUsage, resolvedCogsProfile)`，写入 `cogsAmount` / `cogsBreakdown` / `cogs*PriceApplied` / `priceUnitApplied`

3. `MediaCogsProfileV1` 与 `billingConfig` 字段映射表（实施时落代码注释 + 单测）：

| billingConfig（零售） | MediaCogsProfileV1（成本） |
|---|---|
| image/video/audio 子配置的 unit / 矩阵 / round-up | 同名字段 |
| （无 version） | `version: 1` |
| 平台默认币 | `currency` |

### 2.3 验收（增补）

| # | 项 | 验证方式 |
|---|---|---|
| S2-a | 同构舍入 | 构造需 round-up 的视频时长，断言零售与 COGS 使用的计费秒数相同 |
| S2-b | 仅价表不同 | 同一 usage，COGS=零售×0.7，断言 `cogsAmount === round(retailAmount * 0.7)`（在同一舍入规则下） |
| S2-c | 无平行公式 | 静态检查：media COGS 金额路径不得绕过 `calculateMediaCost` |

---

## 3. S3 — `occurredAt = created_at` 的产品语义

### 3.1 决策（本补充确认）

媒体订单取 COGS 的时间点为 **`media_orders.created_at`（下单/冻结时刻）**，不是结算完成时刻。

产品含义：

- **下单锁成本**：与「客户零售价在下单时刻可解释」对称——成本也按下单时刻生效的 `model_vendor_price_history` 区间选取
- 供应商在 pending 期间涨价：**不影响**该订单的 `cogsAmount`；新价只作用于 `validFrom` 之后新创建的订单（与原文 C2 / AC#10 一致，并明确适用于长 pending）

### 3.2 与 P0-3 / 终态的关系

| 订单结局 | COGS / facts |
|---|---|
| 正常结算成功 | `writeFacts` 按 `created_at` 取 COGS，落 facts |
| 超时释放 / 取消（P0-3） | **不写**收入/成本 facts（或写明确的 void 记录，若另有审计表）；不得用结算时刻重取 COGS |
| 结算重试（幂等） | 复用首次成功写入的 `modelVendorPriceHistoryId` 与金额；禁止重算导致漂移 |

原文将 P0-3 列在本设计外，但本补充把它标为**发布门禁**（见 §5）：无超时释放时，双锁会导致无法下单，定价闭环在资金层不成立。

### 3.3 验收（增补）

| # | 项 | 验证方式 |
|---|---|---|
| S3-a | 长 pending 涨价 | 创建订单后改 COGS（新 `validFrom`），再结算；断言该单 `cogsAmount` 仍按创建时 history |
| S3-b | 新单用新价 | 涨价后新订单断言按新 COGS |
| S3-c | 取消不落成本 | 超时/取消路径断言无 `commercial_usage_facts` 成功收入行（或符合 void 约定） |

---

## 4. S4 — History 联合类型：判别与写入约束

### 4.1 活表 vs 历史表不对称（接受，但要约束）

| 层 | LLM | Media |
|---|---|---|
| 活表 | `model_vendors.cogs_pricing_profile` | `model_vendors.cogs_media_profile`（新列） |
| 历史表 | 同一列 `model_vendor_price_history.cogs_pricing_profile`，类型为 `PricingProfileV1 \| MediaCogsProfileV1` | 同左 |

不在本批把 history 拆成两列（避免大迁移）；用**显式判别**代替约定。

### 4.2 判别规则（读取）

```ts
function isMediaCogsProfile(p: unknown): p is MediaCogsProfileV1 {
  return !!p && typeof p === 'object'
    && (p as any).version === 1
    && 'unit' in (p as object)
    && !('prompt' in (p as object)) // 示例：与 PricingProfileV1 的 token 结构互斥字段；实施时以真实 V1 字段为准
}
```

实施要求：

1. 用 **discriminated union**（`version` + 互斥字段 / 或显式 `kind: 'llm' | 'media'`——若加 `kind` 需同步迁移 LLM 写入；**本补充推荐媒体写入时在 profile 内加 `kind: 'media'`**，LLM 侧保持现有 `PricingProfileV1`，读取时：有 `kind==='media'` 或 media 独有 `unit` 枚举 → media）
2. `pickApplicableHistory` 之后必须先判别再解析；判别失败 → 抛错（与 COGS 缺失同级），不得当 0
3. `priceUnit` 与 profile.unit 交叉校验（如 profile.unit=`per_image` 则 `priceUnit` 应类似 `1 Image`）

### 4.3 写入约束

| 操作 | 约束 |
|---|---|
| 媒体 COGS 变更 | 只写 `cogs_media_profile` 活列 + history 行的 media profile；`cogs_input/output_price` 填 0；`price_unit` 写媒体单位 |
| LLM COGS 变更 | 行为不变；禁止写入 `unit: per_image|per_second|...` 形态 |
| 禁止 | 同一 `modelVendorId` 在同一 `validFrom` 下写入无法判别的 profile |
| DB 层 | 保持 `unique(modelVendorId, validFrom)`；应用层 upsert 路径复用 `web/model-vendors/price-history.ts` |

### 4.4 验收（增补）

| # | 项 | 验证方式 |
|---|---|---|
| S4-a | 共存判别 | 同线路先后写 LLM history 与 media history（若业务上不应发生则测「错误写入被拒」）；读取路径断言解析器选对分支 |
| S4-b | 坏数据抛错 | 插入无法判别的 jsonb，断言 `resolveMediaCogsUnitPrice` 抛错 → Router `normPrice=0` |
| S4-c | retail 单价列 | 新媒体结算断言 `retailInputPriceApplied` / `retailOutputPriceApplied` 非 null（能表达的一侧；另一侧按媒体语义填 0 或同值，需在实现注释写死） |

### 4.5 L1 验收（原文同批修复，原文 §7 未单列）

| # | 项 | 验证方式 |
|---|---|---|
| S4-d | 归因歧义 | 同一 `modelName` 两条 active 线路，走 `modelName` 兜底路径时断言 `modelVendorId=null` 且标记 `attribution_ambiguous`（或等价可观测字段/日志） |
| S4-e | 单候选仍可用 | 仅 1 条 active 时 `modelName` 兜底仍可归因 |

---

## 5. S5 — 商业口径门禁与闭环声明

### 5.1 本设计闭合的范围（写进发布说明）

本设计 + 本补充闭合的是：

> **新媒体订单**：客户价与线路无关、选路按线路 COGS、收入/成本写入 `commercial_usage_facts`、按 `model_vendor_id` 可归集毛利、供应商涨价不改历史单成本。

**不宣称**闭合：

- 上线前已产生的媒体订单毛利（见 5.2）
- LiteLLM 与本地 media 双开时的收入唯一性（见 5.3）
- 资金入口可用性（P0-3 等，见 5.4）
- 折扣、退款、贷记、发票红冲（见 5.5）

### 5.2 历史订单与回填

- 上线前：`media_orders.model_vendor_id` / facts COGS 多为 null → **上线前账期不做媒体毛利正式报表**
- 回填脚本（原文可选）若执行：
  - 必须标记 `source = 'backfill'`（或 facts 上等价字段）
  - 无法唯一确定的保持 null，计入对账差异
  - 回填数据与 `media_direct` 正式链路分开展示，禁止混进「正式毛利」看板默认视图

### 5.3 媒体线路与 LiteLLM Proxy 同步互斥

原文 §4.4 将「同步到 Proxy」显式化；§8 将行为收敛另批。本补充增加**发布前最低安全约束**：

1. 管理端媒体 COGS/线路编辑页：当 `syncToProxy=on` 时，展示强警告：「本地 media 计费与 LiteLLM spend 同时生效可能导致双计收入/双扣预算」
2. 默认值：新媒体线路 `syncToProxy=false`
3. 巡检：列出 `mode ∈ (image,video,audio)` 且 `syncToProxy=true` 的活跃线路，作为发布检查清单项
4. 行为级互斥（强制 `blocked=true` 等）仍按原文 §8 另批；本批至少做到 UI 默认关 + 警告 + 巡检

### 5.4 发布门禁（本设计外但阻塞商业闭环）

以下未完成则**不得宣称定价域分离已上线闭环**：

| 门禁 | 原因 |
|---|---|
| P0-3 超时释放 cron | pending 预占导致本地 frozen + LiteLLM spend 双锁，用户无法下单 |
| 原文「未提交的 4 个 P0 修复」已提交 | 终态幂等 / 并发双花等 |
| 本补充 S1–S4 对应实现与验收通过 | 否则毛利数字不可信 |

P0-1 / P0-5 / P0-8 / 安全项仍按原文优先级，不全部升为本门禁；但 P0-3 与未提交 P0 修复升为**硬门禁**。

### 5.5 折扣与实付

- 毛利率列（S1）= **标价毛利**（list）
- 财务报表「已实现毛利」= `SUM(retailAmount) − SUM(cogsAmount)`，其中 `retailAmount` 为**客户实付**（含折扣后）
- 若未来存在订单级折扣：不得把折扣摊进 COGS；折扣只影响收入侧
- 退款/贷记：另案；本设计不定义红冲是否回写 COGS（默认建议：退款回冲收入，成本侧保留或按财务政策另表，禁止静默改 history）

### 5.6 验收（增补）

| # | 项 | 验证方式 |
|---|---|---|
| S5-a | 回填隔离 | 回填行带 `backfill` 标记；默认毛利查询不含 backfill |
| S5-b | Proxy 默认关 | 新建媒体线路断言 `syncToProxy=false` |
| S5-c | 门禁清单 | 发布 checklist 含 P0-3、未提交 P0、S1–S4 验收 |

---

## 6. 与原文迁移清单的衔接

在原文 §6 步骤之外追加（**不改原步骤编号**；原 4→6 跳号保持不动，以下为补充步骤）：

| 补充步骤 | 内容 |
|---|---|
| S-M1 | 抽出 `calculateMediaCost(usage, priceTable)`，零售与 COGS 共用 |
| S-M2 | 毛利率列按 S1 主单位价；保存时校验 unit / resolutionPriceMode |
| S-M3 | history 写入 media 时带可判别字段（推荐 `kind: 'media'`）；读取路径加判别失败抛错 |
| S-M4 | `writeFacts` 补 `retail*PriceApplied`；COGS 经 `calculateMediaCost` |
| S-M5 | 新媒体线路默认 `syncToProxy=false` + 警告文案 |
| S-M6 | 发布 checklist 纳入 §5.4 门禁 |
| S-M7 | （可选）历史回填脚本 + `backfill` 标记 + 报表过滤 |

原文命名统一：实现与注释统一使用 `resolveMediaCogsUnitPrice`（废弃文案中的 `resolveLineCogs` 别名，避免检索分叉）。

---

## 7. 三条不变量的补充表述

在原文 §9 基础上不改表结构结论，仅追加操作语义：

1. **收入**：实付写入 `retailAmount`；标价单价写入 `retail*PriceApplied`；历史收入不因改价重算（原文已有）  
2. **成本**：按下单时刻 `created_at` 锁 `modelVendorPriceHistoryId`；金额由同构 `f(usage, cogsTable)` 得出  
3. **隔离**：活表分列；history 同列但**可判别**；毛利展示用标价主单位，毛利报表用实付−成本且同币种  

耦合检查追加一条：

| 共享物 | 性质 | 是否耦合 |
|---|---|---|
| `calculateMediaCost` | 无领域定价策略，只吃价表 + 用量 | 否——零售/COGS 两域共享原语，类似 `pickApplicableHistory` |

---

## 8. 总结

| 项 | 结论 |
|---|---|
| 是否改原文 | 否 |
| 是否开 PR | 由调用方决定；本文件可先作为 `docs/` 下独立文档合入 |
| 实施优先级 | S2 / S3 / S4 正确性 > S1 可运营性 > S5 口径与门禁 |
| 与 B2 关系 | 不改变 B2；补齐 B2 下落地时毛利可比与账期可信的前置约束 |

