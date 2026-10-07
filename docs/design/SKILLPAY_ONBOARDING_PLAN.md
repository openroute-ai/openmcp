# SkillPay 入驻实现方案（抓取内容 + 落地规划）

> 状态：**方案文档（未写代码）**。本文抓取 SkillHub 使用指南中两篇入驻教程的原文，
> 并据此给出 `openmcp` 的分阶段实现方案。
> 抓取日期：2026-10-07。

## 0. 抓取来源与方式

| 项 | 值 |
| --- | --- |
| 源页面 | `https://www.skillhub.cn/tutorials` |
| 目标锚点 1 | `#agent-pay-onboard` → 教程《企业接入》（微信集成） |
| 目标锚点 2 | `#alipay-pay` → 教程《个人接入》（支付宝 AI 按量付费） |
| 抓取方式 | 页面 SSR HTML 中只有首篇教程；锚点对应内容打包在前端 bundle `skill-hub.*.js` 的教程数据结构里（`{id,title,subtitle,scenario,outcome,readMinutes,blocks:[]}`）。从 bundle 中按对象字面量括号匹配取出，再按 block 类型渲染为 Markdown。 |
| 产物 | 本文附录 A / 附录 B（原文全量，含表格、代码块、图片、FAQ、自定义组件说明） |
| 原文校验 | 标题、锚点 id、字数与页面「文档导航 / 本篇内容」目录一致 |

抓取过程中的一处事实：`#agent-pay-onboard` 与 `#alipay-pay` 是**前端路由锚点**，不是服务端独立 URL，
直接 `curl` 该 URL 只会拿到首篇《通过 CLI 和 Agent 发布 Skill》。因此内容以 bundle 内数据为准。

---

## 1. 两篇教程结构速览

| | 企业接入 `#agent-pay-onboard` | 个人接入 `#alipay-pay` |
| --- | --- | --- |
| 阅读时长 | 30 分钟 | 20 分钟 |
| 面向人群 | 企业开发者 | 个人开发者 |
| 支付通道 | 微信支付 Agent Pay（**X402 协议**） | 支付宝 **AI 按量付费**（A2M，402 账单） |
| 入驻门槛 | 企业认证 + 微信商户号绑定 | 手机号验证码验证（无营业执照要求） |
| 章节 | 一、入驻 → 二、升级改造 → 三、对外发布 → 四、最佳实践 | 一、入驻 → 二、接入支付宝 → 三、改造 Pay Skill → 四、发布 → 五、买家验证 → 六、最佳实践 |
| 顶部组件 | `DemoDownloadCard`（mch-demo.zip，Go / Java） | `PersonalRoadmap`（5 步路线卡片） |
| 关键码块数 | 18 | 18 |
| FAQ 数 | 9 | 9 |

### 1.1 关键事实（后续实现必须对齐）

**入驻（两条轨）**

| 主体 | 入驻动作 | 完成标志 | 前置依赖 |
| --- | --- | --- | --- |
| 企业 | ① 团队注册 + 企业认证（腾讯统一身份平台，可人脸核身）<br>② 商户中心取 `SkillHub 商户号` + `SkillHub Token` → 微信商户平台绑定<br>③ 回平台刷新状态 | 企业认证 = 已通过；商户号 = **已入驻** | 企业认证通过后才能绑定商户号 |
| 个人 | 商户中心 →「SkillPay 个人入驻」→ 手机号 + 验证码 | 页面显示「已入驻」 | 无营业执照要求 |

**改造（能力侧）**

| | 企业（微信 X402） | 个人（支付宝 AI 按量付费） |
| --- | --- | --- |
| 密钥 | SkillHub 开发者密钥 RSA2048（`pub_key_id` / `private_key_pem`，仅展示一次，每商户最多 3 组） | 支付宝开放平台应用密钥 + 支付宝公钥；`seller_id`、`serviceId`、正式网关 |
| 协议 | `POST /palmpayminiapp/clawagentpay/preorder`，**纯 Body 鉴权**，L1/L2 两层，签名串固定 5 行（含末尾 `\n`），`SHA256withRSA` | 402 + `Payment-Needed` 响应头 → 支付后携 `Payment-Proof` 重试 |
| 返回 | `payment_code` → 响应 Header `WeixinPay-Required`（+ Body `WeixinPay` 提示块）+ `X-Out-Trade-No` | 402 账单 / 200 交付 |
| 有效期 | `payment_code` 最长 **15 分钟**；`expires_at` 最长 15 分钟 | 订单可恢复、幂等 |
| 两套密钥易混点 | 微信支付 API 证书（下单/查单）≠ SkillHub 开发者密钥（AI 预下单） | 沙箱 `api_mock_service_id` 上线前必须换成生产 `serviceId` |

**发布（计费）**

| 模式 | 说明 | 门槛 |
| --- | --- | --- |
| 免费 | 0 元 | 无需商户入驻 |
| 按调用量计费（推荐） | 元 / 次，用户每次调用按单价结算 | **必须完成商户入驻** |

价格三处一致：支付宝登记价 = 服务端 402 账单价 = SkillHub 展示价。

**发布约束**：ZIP / 文件夹必须含 `SKILL.md`；单包 ≤ 10 MB、建议 ≤ 200 文件；Slug 小写字母/数字/连字符且**提交后不可改**；审核 1–2 个工作日；发布成功后补最多 3 个效果案例。

**买家验证（上架后必做）**：从平台安装**已上架版本** → 真实表达调用 → 核对展示价/账单价 → 用与卖家不同的买家账号付款 → 确认交付 + 卖家查到交易 + 履约确认。

---

## 2. 落地到 `openmcp` 的实现方案

### 2.1 与现状的对应关系

| SkillHub 概念 | `openmcp` 现有物 | 状态 |
| --- | --- | --- |
| 双轨入驻（个人 / 企业） | `/provider/onboarding` + `/individual` + `/company`，`entityType` | ✅ 已有（`PROVIDER_ONBOARDING_UED.md` Batch A–C） |
| 入驻状态机 | `verificationStatus`: `null/unverified/pending/verified/rejected` | ✅ 已有 |
| 商户号绑定 / 收款账户 | `/provider/payout`，`payChannelType`（wechat/alipay）+ `metadata.payoutAccounts`，`payChannelStatus` | ⚠️ 已有「手填账户/二维码」版，**缺平台级商户号绑定与状态回执** |
| 计费模式（免费 / 按次） | `skill.priceType`（`free`/`paid`） | ⚠️ 只有买断/授权语义，**缺 per-call 单价与按次结算** |
| 402 / A2M 调用网关 | 无 | ❌ 缺失 |
| 充值与钱包 | `packages/payment` + `recharge_orders`（方案见 `docs/payment-plan.md`） | ⚠️ 与「按次扣款」是另一条链路，勿混 |
| 付费才可用闸门 | `apps/web/src/web/skills/acquire.ts` 的 entitlement 校验 | ✅ 已有，可复用 |
| 发布审核队列 | `ADMIN_REVIEW_QUEUE_UED.md` + `provider_kyc_submissions` | ✅ 已有 |

### 2.2 目标架构（调用时序）

```
Agent / 买家
   │  ① POST /api/pay/{skillSlug}/invoke   （携带会话，不含凭证）
   ▼
OpenMCP 计费网关（新增）
   │  ② 校验 skill.priceType / 单价 / 结算渠道状态 payChannelStatus=ready
   │  ③ 向支付通道预下单（微信 X402 预下单 / 支付宝账单）
   ▼
   │  ④ 返回 402 + 支付码（Header）+ 订单号（Header）
   ▼
Agent 调用支付能力 → 买家付款
   │  ⑤ 同一订单重试，携带支付凭证 Header
   ▼
   │  ⑥ 服务端验付（回调或验签）→ 幂等记账 → 履约
   ▼
   │  ⑦ 200 + 付费结果
```

三条硬约束（来自抓取原文 + `docs/payment-plan.md` §4）：

1. **金额与状态只认服务端**：前端不可传 `status=paid`、不可传金额。
2. **幂等**：同一 `out_trade_no` / 订单号只履约一次，重复请求返回缓存结果。
3. **验签失败一律拒绝**，且回调业务失败不返回 `failure`（避免平台无限重试），改记录 + 告警。

### 2.3 分阶段实施

#### P0 — 入驻中心统一（UI 层，纯前端可先落）

1. `/provider/onboarding` 升级为**双轨入驻中心**：顶部步骤条（选主体 → 填资料 → 结算绑定 → 审核中 → 完成），主体卡片直接展示两条轨的差异（下表）。
2. 个人轨步骤 2 从「身份证 + 人脸」扩展为**手机号验证码验证**（复用 `apps/web` 现有短信验证能力）。
3. 企业轨新增 **Step 2：结算渠道绑定**（商户号 / 收款账户），未绑定时给出「已入驻 / 未入驻」回执状态，而不是只有 `payChannelStatus`。
4. 完成检查清单（三件事）落到成功页：支付可用、业务可封装、发布权限齐备。

| 主体 | 步骤条 | Step 2 内容 |
| --- | --- | --- |
| 个人 | 选主体 → 手机号验证 → 结算绑定 → 审核中 → 完成 | 结算绑定（支付宝 / 微信，可选） |
| 企业 | 选主体 → 企业认证 → 商户号绑定 → 审核中 → 完成 | 商户号绑定（必填，未入驻不可发布付费 Skill） |

#### P1 — 结算渠道状态化

1. `provider_profiles` 增加结算回执字段（或复用 `metadata.payoutAccounts[channel]` 扩展）：
   `merchantNo`（平台商户号）、`bindStatus`（`unbound`/`pending`/`bound`）、`boundAt`、`channel`。
2. 提供 `providers.checkBindStatus` 查询（前端轮询或手动「刷新状态」按钮，对应原文「回到 SkillHub 刷新状态」）。
3. 门控：`priceType='paid'` 的发布提交要求 `bindStatus='bound'`；免费 Skill 不要求。

#### P2 — 按次计费发布

1. 发布向导「完善计费」步骤支持 `per_call` + `amount`（元/次，≤2 位小数），与 `SKILL.md` frontmatter `pricing.model/amount_fen` 对齐。
2. 三处价格一致性校验：详情页展示价 = 发布登记价 = 网关下发账单价。
3. 提交前**付费改造预检查**（对应原文「付费改造预检查」）：检查项见 §2.4 验收清单前 5 项。

#### P3 — 402 计费网关（服务端）

1. 新增 `apps/web/src/app/api/pay/` 下的 invoke + webhook 路由（`runtime='nodejs'`、`dynamic='force-dynamic'`）。
2. 复用 `packages/payment` 的微信/支付宝 Provider（**不要改 Provider 实现**，见 `payment-plan.md` §7）。
3. 新增订单表 `skill_call_orders`（`out_trade_no` 唯一、`status`、`proof`、`fulfilledAt`、`payload` jsonb）。
4. 响应约定统一为：`402` + `X-Payment-Required` + `X-Out-Trade-No`（Header），Body 附 `prompt` 提示块以兼容只读 Body 的 Agent。
5. 支付码有效期 ≤ 15 分钟，过期重新预下单。

#### P4 — 买家验证闭环

1. 「上架后验证」引导页 / 清单（安装上架版本 → 调用 → 核对价格 → 付款 → 交付 + 履约）。
2. 卖家侧「我的交易」查询入口（对应支付宝商家中心「我卖出的交易」）。

### 2.4 门控矩阵

| 能力 | 个人 verified | 企业 verified | 额外条件 |
| --- | --- | --- | --- |
| 发布免费 Skill | ✅ | ✅ | — |
| 发布付费 Skill（按次） | ✅ | ✅ | `bindStatus='bound'`（结算渠道已绑定） |
| 调用 402 网关 | ✅ | ✅ | 订单存在且未过期 |
| 发布 MCP / A2A | ❌ | ✅ | Batch D 服务端门控（维持现状） |
| 结算提现 | ✅ | ✅ | `payChannelStatus='ready'` |

### 2.5 交付物清单（本方案只列不改码）

| 文档 / 代码 | 说明 | 状态 |
| --- | --- | --- |
| `docs/design/SKILLPAY_ONBOARDING_PLAN.md` | 本文：抓取原文 + 实现方案 | ✅ 本次新增 |
| `docs/design/SKILLPAY_ONBOARDING_UED.md` | 依据本方案重画的入驻 UED + 线框图 | ✅ 本次新增 |
| `docs/design/PROVIDER_ONBOARDING_UED.md` | 既有入驻 UED（Batch A–F） | 不改动 |
| `docs/payment-plan.md` | 充值 / 钱包链路 | 不改动 |
| 应用代码 | — | **按要求本次不修改** |

---

# 附录 A：抓取原文《企业接入》

> 锚点 `#agent-pay-onboard`　副标题：面向企业的 SkillPay 全流程：入驻、升级改造、对外发布与最佳实践。

# 企业接入

> 锚点：`/tutorials#agent-pay-onboard`　|　副标题：面向企业的 SkillPay 全流程：入驻、升级改造、对外发布与最佳实践。
> 预计阅读：30 分钟

**场景**：我是企业开发者，想一站式完成微信集成的 SkillPay 入驻、服务升级、发布与最佳实践。

**产出**：完成企业微信集成的 SkillPay 全流程：入驻（企业认证 + 商户绑定）、升级为 Pay Skill（X402）、对外发布、掌握改造最佳实践。


## <a id="enterprise-onboard"></a>一、入驻 SkillPay 指南

> 还不了解 SkillPay 与 Pay Skill 是什么？先看 [SkillPay 概览](/tutorials#skillpay-overview)。本篇讲**企业微信集成**的入驻与改造。


## <a id="agent-pay-onboard-wechat"></a>微信集成（企业版）

> 本段讲**微信集成（企业版）**。SkillPay 与 Pay Skill 的完整介绍见 [SkillPay 概览](/tutorials#skillpay-overview)。

面向**企业**：需完成企业认证并绑定微信商户号。完成后即具备发布微信 Pay Skill 的前置条件。想让 API 支持自动收款，可前往 [升级为微信 Pay Skill](/tutorials#enterprise-upgrade)。

**① 注册企业账号并完成企业认证**：发布 Pay Skill 前，企业需要先完成团队账号注册与企业认证。企业认证用于确认服务主体，认证通过后才能进入商户入驻、微信商户号绑定和后续发布链路。


1. 选择团队登录并注册新团队。
2. 在腾讯统一身份平台完成手机号验证，并创建或选择企业。
3. 进入管理后台的「基础信息」→「认证管理」，选择企业认证并提交材料。

**② 绑定微信商户号入驻 SkillPay**：企业认证通过后，在 SkillHub 商户中心获取 SkillHub 商户号与 SkillHub Token，并前往微信商户平台完成绑定。绑定状态刷新为已入驻后，企业就具备发布和结算 Pay Skill 的前置条件。


1. 在商户中心获取 SkillHub 商户号与 SkillHub Token。
2. 前往微信商户平台完成绑定。
3. 回到 SkillHub 刷新状态，确认显示为已入驻。

**③ 入驻完成后检查**：建议先确认三件事——企业认证状态为已通过，微信商户号绑定状态为已入驻，团队成员中负责支付改造和 Skill 发布的人都已具备相应权限。


1. 支付负责人确认微信商户号、回调地址和支付下单能力可用。
2. 业务负责人确认要发布的服务已能被封装为 Skill，并明确输入、输出和计费边界。
3. 发布负责人确认后续可进入「发布团队 Skill」完成上传、定价和审核提交。


## <a id="enterprise-upgrade"></a>二、升级改造

将已有服务升级为 Pay Skill：企业基于微信支付 Agent Pay [X402 协议](https://pay.weixin.qq.com)，需完成企业认证并绑定微信商户号。下面是完整的接入步骤。


### <a id="agent-pay-upgrade-wechat"></a>微信集成（企业版）


### <a id="agent-pay-upgrade-intro"></a>什么是 Pay Skill

Pay Skill 是 SkillHub 上支持微信 Agent Pay 支付的付费技能。AI Agent 发现并调用 Skill 时，服务端可以触发微信支付流程；用户授权支付后，Agent 再继续获取付费能力或结果。

它的价值在于：企业把已有付费服务封装为可调用 Skill，收费通过微信支付完成，SkillHub 负责来源认证、内容完整性校验和可信调用入口。对开发团队来说，改造重点不是重写业务服务，而是在现有服务上增加开发者签名、X402 预下单和支付触发返回。


### <a id="agent-pay-upgrade-prerequisites"></a>改造前确认

在开始改造之前，请确认以下事项已完成：

| ✅ | 前置条件 | 操作位置 |
|:---:|---|------|
| ☐ | 企业认证通过 | SkillHub 后台 → 团队设置 |
| ☐ | 绑定微信商户号 | SkillHub 后台 → 商户入驻 → 前往微信商户平台绑定 |
| ☐ | 已有微信支付下单能力 | 已接入微信支付下单接口（[Native](https://pay.weixin.qq.com/doc/v3/merchant/4012791877) / [JSAPI](https://pay.weixin.qq.com/doc/v3/merchant/4012062524) / [H5](https://pay.weixin.qq.com/doc/v3/merchant/4012791832) 均可） |
| ☐ | 已发布 Skill 并设置定价 | SkillHub 后台 → 发布 Skill → 设置定价 |

> 💡 **关于微信商户号**：如果你还没有微信商户号，请先前往 [微信支付商户平台](https://pay.weixin.qq.com) 注册。


### <a id="agent-pay-upgrade-architecture"></a>整体架构

Pay Skill 基于微信支付 Agent Pay X402 协议接入。一次调用分成四段：企业服务生成微信支付订单 → 用 SkillHub 开发者密钥签名，调用 X402 AI 预下单换取 `payment_code` → 通过 `WeixinPay-Required` 返回给 Agent → Agent 向用户申请支付授权，然后继续获取付费内容。


![Pay Skill X402 架构与调用时序图](https://cloudcache.tencent-cloud.com/qcloud/tea/app/skillhub/assets/a2a/skillpay-docs/skillpay-architecture-diagram.3027a3a1.png)
*Pay Skill 基于微信支付 Agent Pay X402 协议完成服务开发者模式接入。*


## <a id="agent-pay-upgrade-steps"></a>接入步骤


### <a id="agent-pay-upgrade-key"></a>Step 1：生成开发者密钥

进入 SkillHub 商户中心的「开发者密钥」页面，生成一组 RSA 2048 密钥对。生成后得到两个信息：


1. `pub_key_id`：形如 `PUB_KEY_` + 32 位大写 HEX，填入预下单请求，告诉平台用哪把公钥验签。
2. `private_key_pem`：RSA 2048 私钥（PEM 格式），用于对签名串做 SHA256withRSA 签名。**仅展示一次，SkillHub 不存储**，请交给服务端安全保存，不要放到前端或公开仓库。
3. 同一商户最多保留 3 组有效密钥，建议测试和生产环境分开。


### <a id="agent-pay-upgrade-wechat-order"></a>Step 2：接入微信支付下单

调用微信支付下单接口，获取订单标识。Native 支付返回 `code_url`，JSAPI / H5 场景返回 `prepay_id`。这是标准的微信支付下单流程，使用微信支付 API 证书签名。

微信支付官方文档：[Native](https://pay.weixin.qq.com/doc/v3/merchant/4012791877) | [JSAPI](https://pay.weixin.qq.com/doc/v3/merchant/4012062524) | [H5](https://pay.weixin.qq.com/doc/v3/merchant/4012791832) | [AI支付](https://pay.weixin.qq.com/doc/v3/merchant/4035576700)

> 💡 如果团队已有微信支付下单能力，这一步无需额外开发。只需将返回的订单标识（`code_url` 或 `prepay_id`）传递给 Step 3 即可。

以 Native 下单为例：


```http
POST https://api.mch.weixin.qq.com/v3/pay/transactions/native
Content-Type: application/json

{
  "appid": "wx1234567890abcdef",
  "mchid": "1900000001",
  "description": "图片生成 Pay Skill 调用",
  "out_trade_no": "skillpay_202606260001",
  "notify_url": "https://example.com/pay/notify",
  "amount": { "total": 30, "currency": "CNY" }
}
```


```json
{
  "code_url": "weixin://wxpay/bizpayurl?pr=example"
}
```


### <a id="agent-pay-upgrade-x402"></a>Step 3：调用 X402 AI 预下单

拿到 `code_url` 后，使用 SkillHub 颁发的密钥，调用微信支付 **AI 预下单接口**，换取 `payment_code`。

本接口不依赖微信支付 v3 API 证书，采用**纯 Body 鉴权**：鉴权字段与业务内容全部置于 HTTP Body，不使用 `Authorization` 头。请求体采用 **2 层结构**：

| 层级 | 说明 |
|:---:|---|
| **L1** — HTTP Body（鉴权外层） | 包含签名相关字段（`signature_type`、`developer_platform`、`developer_id`、`pub_key_id`、`nonce_str`、`timestamp`、`signature`），以及封装后的业务字段 `payment_required` |
| **L2** — 业务 JSON | 将实际的业务内容序列化为 JSON 后，做 **Base64 编码**，填入 L1 的 `payment_required` 字段 |

**核心步骤：** 先构造 L2 → Base64 编码 → 得到 `payment_required` → 用其构造签名串 → 组装 L1 → 发送请求。

**3.1 构造 L2 业务 JSON**


```json
{
  "skill_info": {
    "skill_id": "your-skill-slug",
    "skill_version": "1.0.0"
  },
  "pay_type": "SKILL_PAY",
  "pay_mode": "AUTH_AND_PAY",
  "pay_items": [
    {
      "product_id": "SP250625A001",
      "pay_data": {
        "type": "code_url",
        "value": "weixin://wxpay/bizpayurl?pr=NwY5Mz9&groupid=00"
      }
    }
  ],
  "expires_at": "1750924500"
}
```

| 字段 | 说明 |
|------|------|
| `skill_info.skill_id` | 你在 SkillHub 发布的 Skill slug |
| `skill_info.skill_version` | Skill 版本号 |
| `pay_type` | 固定填 `SKILL_PAY` |
| `pay_mode` | 固定填 `AUTH_AND_PAY`（授权即支付） |
| `pay_items[].product_id` | 保留字段，格式为 `SPxxx`，值任意填写 |
| `pay_items[].pay_data.type` | 填 `code_url` |
| `pay_items[].pay_data.value` | Step 2 获取的 `code_url` |
| `expires_at` | 过期时间，Unix 秒级时间戳，最长 **15 分钟** |

**3.2 Base64 编码**

将 L2 JSON 做标准 Base64 编码（非 URL-safe，不带换行），得到 `payment_required`：


```text
payment_required = Base64Encode(L2_JSON)
```

**3.3 构造签名串（5 行）**

签名串为 5 行，每行以换行符 `\n`（0x0A）结尾，**包括最后一行**：


```text
POST\n/palmpayminiapp/clawagentpay/preorder\n{timestamp}\n{nonce_str}\n{payment_required}\n
```

| 行 | 内容 |
|:--:|---|
| 1 | HTTP 方法，固定 `POST` |
| 2 | 请求路径，固定 `/palmpayminiapp/clawagentpay/preorder` |
| 3 | Unix 秒级时间戳（10 位数字） |
| 4 | 32 位随机字母数字串 |
| 5 | 上一步的 `payment_required` |

**3.4 SHA256withRSA 签名**

用 Step 1 的私钥对签名串做 **SHA256withRSA**（PKCS#1 v1.5），结果 Base64 编码即得 `signature`：


```text
signature = Base64( RSA_PKCS1v15_Sign( private_key, SHA256(sign_string_bytes) ) )
```

**3.5 组装 L1 请求体并发送**


```http
POST https://payapp.weixin.qq.com/palmpayminiapp/clawagentpay/preorder
Content-Type: application/json
```


```json
{
  "signature_type": "SKILLHUB-SHA256-RSA2048",
  "developer_platform": "SKILLHUB",
  "developer_id": "sh-XXXXXXXX",
  "pub_key_id": "PUB_KEY_408B07E79B8269FEC3D5D3E6AB8ED163",
  "nonce_str": "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
  "timestamp": "1750924200",
  "signature": "BASE64_RSA_SIGNATURE...",
  "payment_required": "eyJza2lsbF9pbmZvIjp7..."
}
```

| 字段 | 值 | 说明 |
|------|-----|------|
| `signature_type` | `SKILLHUB-SHA256-RSA2048` | 固定值 |
| `developer_platform` | `SKILLHUB` | 固定值 |
| `developer_id` | `sh-XXXXXXXX` | 你的 SkillHub 商户号 |
| `pub_key_id` | `PUB_KEY_xxx` | Step 1 生成的密钥 ID |
| `nonce_str` | 32 位随机字符串 | 每次请求唯一 |
| `timestamp` | Unix 秒级时间戳 | 当前时间 |
| `signature` | Base64 签名值 | 3.4 步骤的输出 |
| `payment_required` | Base64 编码的 L2 JSON | 3.2 步骤的输出 |

**成功响应：**


```json
{
  "payment_code": "xY9zAbc123def456"
}
```

> 📖 更多语言的完整签名代码示例，请参考 [SkillHub 平台商户签名指南](https://doc.weixin.qq.com/doc/w3_ANYA8AbAACcCN7584Yhi8SAWBzaBt?scode=AJEAIQdfAAoHdcXSV7ANYA8AbAACc)。


### <a id="agent-pay-upgrade-return"></a>Step 4：返回支付触发标识

拿到 `payment_code` 后，在你的 Skill API 响应中通过 `WeixinPay-Required` 告知 Agent 需要支付。

**方式一：HTTP Header（推荐）**

适用于 HTTP 服务 / MCP 接口：


```http
HTTP/1.1 402 Payment Required
WeixinPay-Required: xY9zAbc123def456
Content-Type: application/json

{
  "data": { "message": "本次查询需要付费" },
  "WeixinPay": {
    "WeixinPay-Required": "xY9zAbc123def456",
    "prompt": "本次使用微信支付，请将 WeixinPay-Required 的值作为 paymentCode 交给 weixinpay_pay，以向用户申请支付授权。"
  }
}
```

> 💡 **建议同时在响应体中附加 `WeixinPay` 提示块**，兼容只读 body 的 Agent。HTTP 状态码支持 `402` 或 `200`（兼容模式）。

**方式二：CLI 输出**

适用于本地 CLI 服务：


```json
{
  "WeixinPay-Required": "xY9zAbc123def456",
  "prompt": "本次使用微信支付，请将 WeixinPay-Required 的值作为 paymentCode 交给 weixinpay_pay，以向用户申请支付授权。"
}
```


### <a id="agent-pay-upgrade-check"></a>改造完成后检查


1. 微信支付下单成功，能通过 `out_trade_no` 或回调确认支付结果。
2. X402 预下单请求中 `developer_id` 为 SkillHub 商户号，签名串格式正确。
3. 服务响应同时包含 `WeixinPay-Required` Header 和 `WeixinPay` Body。
4. Agent 能识别 `payment_code` 并触发微信支付授权，并且能正常拉起微信支付 AI 专属卡。


## <a id="agent-pay-upgrade-faq"></a>常见问题


**Q：支付和业务分属不同团队怎么分工？**

A：如果是同一团队，全流程自己搞定即可。如果分属不同团队：支付团队负责微信支付下单、证书和回调，对外暴露一个内部下单接口（如 `POST /internal/pay/create`）；业务团队负责 X402 预下单签名和响应组装，持有 SkillHub 开发者密钥。

**Q：weixinpay 插件如何获取安装？**

A：weixinpay 插件默认在最新版本的 WorkBuddy / QClaw 中已安装，商户改造无需关心。

**Q：`developer_id` 填什么？**

A：填 SkillHub 商户中心的商户号（`sh-XXXXXXXX` 格式）。

**Q：`pay_data.type` 该选哪个？分别对应什么下单接口？**

A：根据已接入的微信支付下单方式选择，下单返回值原样填入 `pay_data.value`：

| `pay_data.type` | 来源下单接口 | value 示例 |
| --- | --- | --- |
| `code_url` | Native 下单 `POST /v3/pay/transactions/native` | `weixin://wxpay/bizpayurl?pr=xxx` |
| `prepay_id` | JSAPI / 小程序 / APP 下单，对应 `/v3/pay/transactions/jsapi` 或 `/app` | `wx201410272009395522657a690389285100` |
| `h5_url` | H5 下单 `POST /v3/pay/transactions/h5` | `https://wx.tenpay.com/cgi-bin/mmpayweb-bin/checkmweb?prepay_id=...&package=...` |

**Q：怎么确认支付成功？**

A：以微信支付 `notify_url` 回调或按 `out_trade_no` 查单为准，不依赖 Agent 侧消息。

**Q：`payment_code` 过期了怎么办？**

A：最长有效期 15 分钟，过期后需重新走 Step 2 → Step 3 流程。

**Q：签名验证失败怎么排查？**

A：按顺序排查：① 签名串是否严格 5 行，每行以 `\n` 结尾（含最后一行）；② `payment_required` 在签名串和 L1 请求体中是否完全一致；③ 时间戳是否为 Unix 秒（10 位数字）；④ 私钥与 `pub_key_id` 是否匹配；⑤ 是否使用标准 Base64（非 URL-safe，不带换行）。更多代码示例参考 [SkillHub 平台商户签名指南](https://doc.weixin.qq.com/doc/w3_ANYA8AbAACcCN7584Yhi8SAWBzaBt?scode=AJEAIQdfAAowmHXxTOANYA8AbAACc)。

**Q：商户 Agent Pay Skill 指的是什么？**

A：商户 Agent Pay Skill 是指商家在 SkillHub 上发布的、支持微信 Agent Pay 支付的付费技能。技能名称商家可按照实际情况定义。当 AI Agent（如 WorkBuddy、QClaw）发现并调用这个 Skill 时，商户服务端可以通过微信支付 X402 协议触发支付流程——用户授权支付后，Agent 继续获取付费内容。

**Q：可以同时使用多个密钥吗？**

A：可以。每个商户最多持有 3 对有效密钥，支持无缝轮换。


## <a id="enterprise-publish"></a>三、对外发布


### <a id="agent-pay-publish-checklist"></a>发布前检查清单

发布 Pay Skill 前，先确认企业资质、Skill 文件、计费策略和案例素材都已经准备好，避免进入发布页后反复补材料。

| 检查项 | 要求 |
| --- | --- |
| 企业与商户 | 企业认证通过，商户入驻已完成 |
| Skill 文件 | ZIP 包或 Skill 文件夹内必须包含 `SKILL.md` |
| 文件大小 | 单次上传 ≤ 10.00 MB，建议 ≤ 200 个文件 |
| 计费策略 | 免费模式无需商户入驻；按调用量计费需要完成商户入驻 |
| 案例素材 | 建议提前准备 3 个真实使用场景，便于发布后补充效果案例 |


## <a id="agent-pay-publish-upload"></a>选择并上传 Skill

登录 SkillHub 商家后台后，从左侧菜单进入「发布团队 Skill」，选择本地 Skill 文件夹或 ZIP 包上传。上传包内必须包含 SKILL.md。


![SkillHub 发布团队 Skill 上传页面](https://cloudcache.tencent-cloud.com/qcloud/ui/static/other_external_resource/16b726f1-89fe-49d9-88b1-c5ab545a4165.jpg)
*进入「发布团队 Skill」后，上传包含 SKILL.md 的 ZIP 包或 Skill 文件夹。*


### <a id="agent-pay-publish-basic"></a>填写基本信息


1. 上传 ZIP 包或 Skill 文件夹，确认根目录包含 SKILL.md。
2. 填写 Slug、显示名称和图标。Slug 是 Skill 的唯一标识，仅允许小写字母、数字和连字符。
3. 显示名称建议直观表达能力，例如「智绘图片生成」；图标建议使用品牌色或服务 Logo。
4. Slug 一旦提交后不可修改，请在首次发布时谨慎命名。


## <a id="agent-pay-publish-pricing"></a>设置价格与计费模式

SkillHub 支持免费和按调用量计费两种模式。企业发布 Pay Skill 时，通常选择按调用量计费（推荐），并填写合理的单次调用价格。


![Pay Skill 价格与计费模式设置页面](https://cloudcache.tencent-cloud.com/qcloud/ui/static/other_external_resource/05be3db8-69ce-4a27-84e4-19b135f2a657.jpg)
*按调用量计费需要填写单次调用价格，用户每次调用时按次结算。*


1. 选择「按调用量计费」，填写单次调用价格，单位为元 / 次。
2. 补齐描述、版本号和变更说明。描述要清楚说明输入、输出和适用边界。
3. 参考同类服务设置价格，避免过高或过低影响通过率和转化。


```markdown
---
name: 智绘图片生成
description: 根据文本提示生成图片，适合海报草图和视觉创意预览
tags: [图片生成, 设计]
version: 1.0.0
capability: image_generation
pricing:
  model: per_call
  amount_fen: 30
---
```

| 模式 | 说明 | 适用场景 |
| --- | --- | --- |
| 免费 | 0 元，所有用户免费使用，免费模式无需商户入驻 | 开源工具、引流能力、内部试用 |
| 按调用量计费（推荐） | 自定义元 / 次，用户每次调用按单价结算 | 商业化 API、AI 服务、SaaS 能力 |


## <a id="agent-pay-publish-submit"></a>提交审核并进入案例补充

所有信息填写完成后，点击底部「发布 Skill」提交审核。系统会自动检查 Skill 文件完整性、SKILL.md 格式、计费配置合理性和案例数量。


1. 提交前再次确认服务说明、调用价格、版本号和变更说明准确无误。
2. 提交后等待审核；一般情况下 1-2 个工作日完成，如遇高峰可能延长。
3. 发布成功后会进入「发布成功，添加效果案例」页面，可继续补充案例。


![Pay Skill 发布成功后添加效果案例页面](https://cloudcache.tencent-cloud.com/qcloud/ui/static/other_external_resource/f5d372d4-6a8e-4dd7-b979-c51e69d60cd8.jpg)
*发布成功后，可继续补充最多 3 个效果案例。*


### <a id="agent-pay-publish-cases"></a>生成并保存效果案例

效果案例是用户理解 Pay Skill 能力的重要窗口。发布成功后，建议点击「对话式补充案例」，保存最多 3 个效果案例。


![Pay Skill 对话式补充案例编辑器](https://cloudcache.tencent-cloud.com/qcloud/ui/static/other_external_resource/940d9a66-927a-490e-8a1e-9856bb643edf.jpg)
*在案例编辑器中补充场景标题、描述、示例问题和触发条件。*


1. 在案例编辑器中确认 Skill ID、名称和实际功能说明。
2. 为每个案例补充场景标题、场景描述、示例问题和触发条件。
3. 尽量覆盖 3 个不同使用场景，让用户更快判断这个 Pay Skill 是否适合当前任务。


### <a id="agent-pay-publish-best-practice"></a>发布通过率与运营建议


1. 描述要具体说明输入输出，避免只写「提升效率」这类模糊表达。
2. 提交前在本地或测试环境完整跑通一次核心流程。
3. 版本迭代时写清变更日志，便于审核和用户判断是否升级。
4. 用关键词优化名称、描述和标签，让 Agent 与用户更容易发现 Skill。
5. 如果审核不通过，先查看审核意见，常见原因包括 SKILL.md 格式不规范、缺少测试案例、定价明显不合理或描述过于模糊。


### <a id="agent-pay-publish-faq"></a>常见问题

**审核多久完成？** 通常 1-2 个工作日，高峰期可能延长到 3-5 个工作日。

**Slug 能不能改？** Slug 一旦提交后不可修改，因为它会成为 Skill 的唯一标识和调用定位依据。

**为什么建议补满 3 个案例？** 案例会直接影响用户理解和 Agent 选择，建议覆盖核心能力、典型行业场景和边界说明。

**审核不通过怎么处理？** 先查看审核意见，优先修正 SKILL.md 格式、测试案例、计费配置和描述清晰度，再重新提交。


## <a id="enterprise-best-practice"></a>四、最佳实践


### <a id="best-practice-overview"></a>这份最佳实践能帮你什么

前面几篇讲清了 Pay Skill 的原理与配置，这一篇给你一份**可直接运行、可直接抄改**的完整商户接入示例。我们提供 Go / Java 两种语言的 Demo，演示如何通过 SkillHub 平台接入微信 Agent Pay（X402 协议），实现 Agent 付费资源获取。

付费改造本质上只做两件事：**后端服务改造**（实现 402 → 查单 → 履约流程）和 **Skill Prompt 改造**（指导 Agent 识别支付、完成支付、重试取内容）。两者缺一不可。


> 组件：`DemoDownloadCard`（商户接入 Demo 代码包下载卡）

- 标题：**商户接入 Demo 代码包** · `mch-demo.zip` · 含 Go / Java 双语言完整示例
- 语言卡：Go（net/http 原生实现）、Java（Spring Boot）
- 说明：下载后配置密钥即可本地运行，替换业务逻辑后接入你的服务。
- 下载地址：https://skillhub-1388575217.cos.ap-guangzhou.myqcloud.com/mch-demo/mch-demo.zip


## <a id="best-practice-flow"></a>协议流程总览

一次完整的付费调用会经历首次请求、返回 402、发起支付、支付后重试、查单履约五个关键节点。整体时序如下：


```text
① Agent      → 商户服务   POST /demo/skill/invoke {"query":"xxx"}
② 商户服务    → 微信支付   Native 下单（微信支付 API 证书签名）→ code_url
③ 商户服务    → 微信支付   AI 预下单（SkillHub 开发者密钥签名）→ payment_code
④ 商户服务    → Agent      HTTP 402 + WeixinPay-Required + X-Out-Trade-No
⑤ Agent      → 微信支付    调用 weixinpay_pay(paymentCode=xxx)
⑥ 用户       → 微信支付    确认并完成支付
⑦ Agent      → 商户服务    POST /demo/skill/invoke {"query":"xxx"} + Header X-Out-Trade-No
⑧ 商户服务    → 微信支付    查单验证（微信支付 API 证书签名）→ trade_state=SUCCESS
⑨ 商户服务    → Agent      HTTP 200 + 付费内容
```


### <a id="best-practice-keys"></a>关键前提：区分两套密钥

这是整个改造中最容易踩坑的地方。Demo 涉及**两套完全不同的密钥**，务必区分清楚：

| 密钥 | 用途 | 签名算法 | 获取方式 |
| --- | --- | --- | --- |
| 微信支付 API 证书 | Native 下单、查单等标准支付接口 | WECHATPAY2-SHA256-RSA2048 | 微信支付商户平台申请 |
| SkillHub 开发者密钥 | AI 预下单接口 | SKILLHUB-SHA256-RSA2048 | SkillHub 商户后台一键生成 |

⚠️ AI 预下单接口**不使用**微信支付 API 证书签名，而是使用 SkillHub 颁发的开发者密钥签名。微信支付后台会向 SkillHub 验签，确认商户身份。


### <a id="best-practice-endpoint"></a>统一接口设计

Demo 用一个 `POST /demo/skill/invoke` 接口承载两种场景：通过请求头 `X-Out-Trade-No` 是否存在决定走"创建订单"还是"验证履约"分支。


```json
{
  "query": "用户查询内容"
}
```

**场景一：首次请求（无 X-Out-Trade-No Header）→ 返回 HTTP 402**，在响应头和响应体中携带支付码（`WeixinPay-Required`）和订单号（`X-Out-Trade-No`），引导 Agent 发起支付。


```json
{
  "code": "PAYMENT_REQUIRED",
  "message": "需要支付后才能获取内容",
  "WeixinPay": {
    "WeixinPay-Required": "payment_code_xxx",
    "prompt": "本次使用微信支付，请将 WeixinPay-Required 的值作为 paymentCode 交给 weixinpay_pay，以向用户申请支付授权。"
  },
  "out_trade_no": "WX402_20260630120000abcdef123456",
  "amount": "0.01",
  "currency": "CNY"
}
```

**场景二：支付后重试（携带 X-Out-Trade-No Header）→ 查单验证通过后返回 HTTP 200**，交付付费内容。


```json
{
  "code": "SUCCESS",
  "message": "付费内容",
  "out_trade_no": "WX402_20260630120000abcdef123456",
  "transaction_id": "4200001234202306300000000001",
  "content": "【付费内容】...",
  "already_fulfilled": false
}
```


### <a id="best-practice-preorder"></a>AI 预下单签名（核心难点）

AI 预下单采用 L1 / L2 两层结构：L2 是业务 JSON，Base64 编码后放入 L1 的 `payment_required` 字段；L1 是最终发送的请求体，携带签名等元数据。


```text
L1 请求体
  signature_type: "SKILLHUB-SHA256-RSA2048"
  developer_platform: "SKILLHUB"
  developer_id: "sh-XXXXXXXX"
  pub_key_id: "PUB_KEY_xxx"
  nonce_str: "32位随机串"
  timestamp: "Unix秒级时间戳"
  signature: "Base64(RSA签名)"
  payment_required: "Base64(L2 JSON)"

  └─ L2 业务 JSON（Base64 编码后放入上方字段）
       skill_info: { skill_id, skill_version }
       pay_type: "SKILL_PAY"
       pay_mode: "AUTH_AND_PAY"
       pay_items: [{ product_id, pay_data }]
       expires_at: "Unix秒级时间戳"
```

签名串固定为 5 行，每行都以 `\n` 结尾（最后一行也要保留换行）。这是签名失败最常见的根因：


```text
POST\n
/palmpayminiapp/clawagentpay/preorder\n
{timestamp}\n
{nonce_str}\n
{payment_required}\n
```

用 SkillHub 开发者私钥对签名串做 SHA256withRSA（PKCS#1 v1.5）签名，再做标准 Base64 编码（非 URL-safe）。以下是 Go 版签名实现，可直接参考：


```go
func signWithSkillHubKey(signString string, privateKeyPEM []byte) (string, error) {
    block, _ := pem.Decode(privateKeyPEM)
    if block == nil {
        return "", errors.New("invalid private key pem")
    }

    privateKey, err := x509.ParsePKCS8PrivateKey(block.Bytes)
    if err != nil {
        return "", err
    }

    rsaKey, ok := privateKey.(*rsa.PrivateKey)
    if !ok {
        return "", errors.New("private key is not RSA")
    }

    digest := sha256.Sum256([]byte(signString))
    signature, err := rsa.SignPKCS1v15(rand.Reader, rsaKey, crypto.SHA256, digest[:])
    if err != nil {
        return "", err
    }

    return base64.StdEncoding.EncodeToString(signature), nil
}
```


### <a id="best-practice-order-no"></a>商户订单号与幂等

两个容易被忽略但会影响线上稳定性的细节：

- **out_trade_no 长度 ≤ 32 位**（微信支付 Native 下单要求）。Demo 采用 `WX402_` + 时间戳(14位) + 随机串(12位) = 32 位，你也可以自定义，只要满足唯一性和长度限制。
- **幂等控制**：同一 `out_trade_no` 只履约一次，重复请求返回缓存结果（`already_fulfilled: true`）。生产环境建议用数据库事务保证幂等。


### <a id="best-practice-skill-prompt"></a>Skill Prompt 怎么写

后端改造完成后，还要在 SKILL.md 里写清指导 Agent 的流程。关键是四条指令：**付费前置检查 → 请求资源 → 处理 402 发起支付 → 支付成功后通过 Header X-Out-Trade-No 携带订单号重试**。


```markdown
## 前置检查：当前智能体是否支持微信 AI 支付

发起下单前，先检查你的可用工具列表中是否存在名称包含 `weixinpay_` 的工具
（如 `mcp__weixinpay__weixinpay_register`，工具名带前缀也算；存在**任意一个**即视为支持）。

只以你的工具列表为证据，本文档中提到的工具名不算；无法确认时按「不支持」处理。

- 支持：静默继续本 Skill 的后续流程，不向用户提及本检查。
- 不支持：终止流程且不要发起下单。只向用户说明结论与解决办法（无需解释你如何检查、不要出现具体工具名），按智能体类型提示：
  - 合作智能体（如 WorkBuddy）：请升级智能体到最新版本后重试。
  - 开放智能体（如 OpenClaw / DeepSeek Harness）：请根据 [https://skillhub.cn/install/skillhub.md](https://skillhub.cn/install/skillhub.md)，安装 @tencent-adm/weixinpay-installer。
  - 无法判断类型：请升级智能体或安装微信支付 AI 支付插件后重试。

## 工作流程
### 第一步：请求资源
POST https://your-domain.com/demo/skill/invoke
Body: {"query": "用户的查询内容"}

### 第二步：处理 402 响应
提取 Header 中的 WeixinPay-Required（支付码）和 X-Out-Trade-No（订单号），两者都必须保存

### 第三步：发起支付
将 WeixinPay-Required 值作为 paymentCode，调用 weixinpay_pay

### 第四步：支付成功后获取资源（⚠️ 必须执行）
POST https://your-domain.com/demo/skill/invoke
Headers: WeixinPay-Required + X-Out-Trade-No（第二步保存的值）
Body: {"query": "原始查询内容"}（body 与第一步完全一致）
```

⚠️ 第四步是最容易被 Agent 遗漏的一步：不携带 `X-Out-Trade-No` Header 重试，就永远拿不到付费内容。body 保持与第一次请求一致，仅通过 Header 传递订单号和支付凭证。Prompt 里要用醒目措辞强调"支付成功后必须重新请求"。


### <a id="best-practice-quickstart"></a>本地快速运行

下载代码包后，配置好环境变量即可本地启动。以下以 Go 版为例：


```bash
cd go/
go mod tidy

# 微信支付商户配置
export MCH_ID="你的商户号"
export APP_ID="你的应用ID"
export SERIAL_NO="你的证书序列号"
export PRIVATE_KEY="你的微信支付商户私钥 PEM 内容"
export NOTIFY_URL="https://your-domain.com/notify"

# SkillHub 开发者密钥配置
export SKILLHUB_DEVELOPER_ID="sh-XXXXXXXX"
export SKILLHUB_PUB_KEY_ID="PUB_KEY_xxx"
export SKILLHUB_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----"

# Skill 信息
export SKILL_ID="your-skill-slug"
export SKILL_VERSION="1.0.0"

go run main.go
```

启动后可用 curl 验证两种场景：


```bash
# 首次请求（返回 402）
curl -X POST http://localhost:8080/demo/skill/invoke \
  -H "Content-Type: application/json" \
  -d '{"query": "帮我分析一下AI行业趋势"}'

# 支付后重试（通过 Header 携带 X-Out-Trade-No）
curl -X POST http://localhost:8080/demo/skill/invoke \
  -H "Content-Type: application/json" \
  -H "X-Out-Trade-No: WX402_xxx" \
  -d '{"query": "帮我分析一下AI行业趋势"}'
```


### <a id="best-practice-production"></a>从 Demo 到生产的注意事项

Demo 为了演示清晰做了简化，正式上线前请务必替换以下部分：

| 项 | Demo 状态 | 生产要求 |
| --- | --- | --- |
| 微信支付 V3 签名 | 占位实现（PLACEHOLDER） | 必须用微信支付官方 SDK 自动签名 |
| 订单存储 | 内存 map | 用数据库，并用事务保证幂等 |
| AI 预下单签名 | 完整实现 | 可直接复用 |
| 支付回调 | 未实现 | 建议实现 notify_url 回调处理支付结果通知 |
| 业务逻辑 | 模拟内容 | 替换 generatePaidContent 为你自己的服务 |

微信支付官方 SDK 推荐：

- **Go**：github.com/wechatpay-apiv3/wechatpay-go
- **Java**：com.github.wechatpay-apiv3:wechatpay-java

简言之：从 Demo 落地到你自己的服务，通常只需替换 `generatePaidContent` 业务函数，并把微信支付 V3 签名的占位实现换成官方 SDK，其余的 402、AI 预下单、查单、幂等等流程代码基本可以原样复用。

---

# 附录 B：抓取原文《个人接入》

> 锚点 `#alipay-pay`　副标题：个人开发者接入 SkillPay：入驻、接入支付宝、改造与测试 Pay Skill、发布与买家验证。

# 个人接入

> 锚点：`/tutorials#alipay-pay`　|　副标题：个人开发者接入 SkillPay：入驻、接入支付宝、改造与测试 Pay Skill、发布与买家验证。
> 预计阅读：20 分钟

**场景**：我是个人开发者，希望把已有 API 改造成可收款的 Pay Skill 并发布到 SkillHub。

**产出**：完成服务端收款接入、Skill 编排与发布，并验证买家能付款、收到结果。


> 组件：`PersonalRoadmap`（个人接入流程路线图卡片，5 张卡片锚点直达）

| # | 锚点 | 标题 | 描述 |
|---|------|------|------|
| 1 | `personal-onboard` | 入驻 | 手机号验证 |
| 2 | `personal-upgrade` | 接入支付宝 | 集成、部署、自测 |
| 3 | `personal-skill-upgrade` | 改造 Pay Skill | 接入付费、本地验证 |
| 4 | `personal-publish` | 发布 | 填写信息、提交审核 |
| 5 | `personal-validation` | 买家验证 | 付款与结果交付 |


## <a id="personal-prepare"></a>开始前准备

本指南面向个人开发者，使用支付宝 AI 按量付费完成收款。依次完成下方五步；已有结果的步骤可直接跳过。完成主流程后，可继续阅读文末的 [六、最佳实践](#personal-best-practice)。

| 准备项 | 要求 |
| --- | --- |
| SkillHub 账号 | 已注册并登录 |
| 卖家支付宝账号 | 用于开通收款产品 |
| 不同的买家支付宝账号 | 真实付款测试时使用，不能与卖家相同 |
| 可运行的业务 API | 明确请求方式、参数与响应；尚无 API 时，可让 Agent 先生成并跑通业务接口 |
| 本地开发环境 | [Node.js（含 npm）](https://nodejs.org/zh-cn/download) 和支持加载 Skill 的 AI 编程助手；版本以官方安装器及生成项目要求为准 |
| 部署环境 | 正式验证前准备公网 HTTPS 地址；部署方式见第二步「没有服务器怎么办」 |


## <a id="personal-onboard"></a>一、入驻 SkillPay

按当前个人入驻规则，个人开发者可通过手机号验证完成入驻，无需企业认证；具体以页面审核要求为准。支付宝收款产品另行开通。概念说明见 [SkillPay 概览](/tutorials#skillpay-overview)。


### <a id="personal-onboard-entry"></a>完成手机号验证


1. 登录 SkillHub 后，在商户中心进入「SkillPay 个人入驻」。
2. 输入手机号和验证码，提交验证。

**完成标志**：SkillHub 显示「已入驻」。继续接入支付宝收款。


**Q：个人开发者真的不需要营业执照吗？**

A：当前 SkillPay 个人接入支持个人用户完成手机号验证，无需营业执照或企业认证；具体以入驻页面要求为准。如需以企业身份接入，可选择「企业接入」。


## <a id="personal-upgrade"></a>二、接入支付宝并部署服务

本章为业务 API 接入支付宝 [AI 按量付费](https://aipay.alipay.com/products/machine-pay)，使 Agent 调用接口时可以按次收费，并完成生产部署。

**接入流程**（[支付宝官方接入指南](https://aipay.alipay.com/docs/ai-receive/MACHINE_PAY.html)）：技术集成与沙箱测试 → 产品开通 → 服务注册 → 密钥配置与部署 → 线上验证。完成本章后，再进入[第三章](#personal-skill-upgrade)改造或创建 Pay Skill。


### <a id="personal-upgrade-install"></a>2.1 技术集成与沙箱测试

使用支付宝官方集成 Skill `alipay-aipay` 为业务 API 添加收费逻辑，并在沙箱环境中验证服务端支付链路。本节不使用真实资金：

- **付款前**：请求接口，返回 402 账单。
- **付款后**：携凭证重试，服务端验付后返回资源，并发送履约回执。


#### <a id="personal-upgrade-install-command"></a>安装集成 Skill

在业务项目目录的终端执行：


```bash
npx -y @alipay/alipay-aipay@latest install
```


#### <a id="personal-upgrade-install-prompt"></a>发送接入提示词

将尖括号内容替换为真实业务信息后，发送给 AI 编程助手：


```text
请加载 alipay-aipay，为本项目的业务 API 接入支付宝 AI 按量付费，并在沙箱环境中完成测试。

业务信息：
- 接口用途：<例如：生成图片、查询数据或调用模型>
- 请求方式及路径：<例如：POST /api/resource>
- 请求参数、请求体和必要请求头：<按实际接口填写>
- 单次价格：<0.01～50 元，最多两位小数>

要求：
1. 保留接口原有业务逻辑和成功响应。
2. 验证 402 账单、Payment-Proof 验证、资源交付、履约回执和同一订单重试。
3. 输出测试结果、代码变更、启动方式、环境变量模板，以及上线前需要替换的生产配置；不要求我提供生产私钥。
4. 本轮不发起真实付款；缺少信息时先向我确认。
```


![Skill 自动集成流程](https://cloudcache.tencent-cloud.com/qcloud/tea/app/skillhub/assets/tutorials/skillpay/jishujicheng.c079a217.png)
*Agent 自动完成沙箱配置、代码生成和联调测试。*

等待 Agent 完成沙箱配置、代码生成和联调，并确认它明确给出各项测试结果。沙箱通过后，仍需继续完成产品开通、服务注册、生产部署和线上自测。


![沙箱测试通过结果](https://cloudcache.tencent-cloud.com/qcloud/tea/app/skillhub/assets/tutorials/skillpay/shaxiangceshijieguo.a5a63d07.png)
*沙箱联调通过：402 触发、收银下单、凭证重试、验付履约全部成功。*

记录沙箱测试结果。沙箱 `service_id` 使用 `api_mock_service_id`，上线前须替换为真实服务标识。


**Q：沙箱测试需要公网服务器吗？**

A：不需要。沙箱测试在本地 `localhost` 即可完成，测试脚本在本机发起请求并调用沙箱收银接口。公网 HTTPS 服务器仅在正式上线时需要。


### <a id="personal-upgrade-open"></a>2.2 开通收款产品

进入[支付宝 AI 按量付费](https://aipay.alipay.com/products/machine-pay)，点击「一站式接入」，使用卖家支付宝账号扫码登录。收款产品选择「AI 按量付费」，按页面完成身份验证和签约；经营类目与资质按实际业务填写，并等待产品审核通过。


![支付宝开放平台签约 AI 按量付费](https://cloudcache.tencent-cloud.com/qcloud/tea/app/skillhub/assets/tutorials/skillpay/chanpinkaitong.d3957c24.png)
*在支付宝 AI 按量付费页面选择「一站式接入」并开通收款产品。*

确认产品已开通、应用可用后再做真实交易验证。仅获得应用 ID 不代表收款能力已生效。


**Q：配置好 serviceId 后直接测试支付为什么失败？**

A：`serviceId` 需要产品开通审核通过后才能生效。虽然注册服务后立即获得 `API_` 开头的 serviceId，但如果 2.2 的「AI 按量付费」产品开通审核尚未通过，该 serviceId 不会真正可用，支付会失败。请确保产品开通审核通过后再进行线上验证。


### <a id="personal-upgrade-service"></a>2.3 注册服务

第二步「产品开通」完成后，进入下一步「服务注册」。注册完成后会获得 `API_` 开头的 `serviceId`，这是你在支付宝 AI 付体系中的商户身份标识。

| 字段 | 填写要求 |
| --- | --- |
| 服务名称、类型 | 与实际业务接口一致 |
| 服务地址 | 买家实际请求的完整业务 URL；正式使用时须公网 HTTPS 可达 |
| 服务单价 | 0.01～50 元/次，最多两位小数，与服务端账单一致 |
| 服务描述 | 说明能力，最多 500 字符 |
| 请求示例 | 与真实请求方式、参数一致 |


**Q：服务地址填错了会有什么影响？**

A：登记地址应与 Agent 实际调用的业务端点一致，包括协议、域名和路径；请求方式与参数也应与登记示例相符。信息不一致可能导致支付验证失败。修改后还要同步更新 Skill 中的资源 URL。


![AI 付站点注册服务](https://cloudcache.tencent-cloud.com/qcloud/tea/app/skillhub/assets/tutorials/skillpay/fuwuzhuce.5e733984.png)
*在支付宝 AI 付「服务管理」注册收款服务，获取 serviceId。*


#### <a id="personal-upgrade-service-update"></a>服务地址尚未就绪或发生变更

如果还没有公网地址，先按 2.4 部署业务端点，再返回本节注册服务；取得 `serviceId` 后补入生产配置并重新部署。地址发生变更时，在[支付宝 AI 付「服务管理」](https://aipay.alipay.com/open-flow/console)和 Skill 中同步更新，确保登记地址与实际调用一致。占位地址不能用于付款验证。


### <a id="personal-upgrade-online"></a>2.4 配置生产环境并部署

使用支付宝开放平台密钥工具生成密钥，将应用公钥配置到对应应用，并取得支付宝公钥。私钥由你保存在服务端，通过环境变量或密钥管理服务注入，不写入 Skill、日志或代码仓库。安装和操作方法见[密钥工具使用指南](https://opendocs.alipay.com/open/02kipk)。

将下列生产配置按生成项目的说明注入服务端，变量名以项目实际实现为准。

| 配置项 | 用途 |
| --- | --- |
| 应用 ID | 支付宝开放平台生产应用的 AppId |
| 应用私钥 | 账单签名及调用支付宝接口；格式须与 SDK 配置一致 |
| 支付宝公钥 | 验证支付宝响应签名 |
| 卖家支付宝用户 ID | 账单中的 `seller_id`，通常为 2088 开头的账号 ID |
| 服务标识 | 注册服务所得的真实 `serviceId` |
| 网关 | 正式网关 `https://openapi.alipay.com/gateway.do` |

将沙箱的 `api_mock_service_id`、沙箱账号与密钥、沙箱网关全部替换为生产值，部署后确认公网 HTTPS 业务地址可访问。应用公钥配置在支付宝开放平台，不作为服务端验签公钥使用。私钥格式须与 SDK 配置一致，具体见下方问答。


**Q：私钥应该使用哪种格式？**

A：以项目使用的 SDK 配置为准，不能仅按语言判断。支付宝 Node.js SDK 支持 PKCS#1、PKCS#8，可通过 keyType 指定；私钥内容、格式和配置必须一致。见「2.4 配置生产环境并部署」。


![密钥配置](https://cloudcache.tencent-cloud.com/qcloud/tea/app/skillhub/assets/tutorials/skillpay/miyaopeizhi.c1e22ef3.png)
*将沙箱配置替换为生产应用 ID、应用私钥、支付宝公钥、卖家账号 ID、serviceId 和正式网关。*


#### <a id="personal-upgrade-hosting"></a>没有服务器怎么办

如果暂时没有服务器，可使用腾讯云旗下的轻量应用服务器（Lighthouse）部署业务 API。它提供公网 IP 和常用应用镜像，适合轻量 Web 服务与开发测试。[查看轻量应用服务器活动信息与可选套餐 →](https://cloud.tencent.com/act/pro/lhsale)（配置、价格及适用条件以活动页为准）。

选择轻量应用服务器后，可按 [新手指引](https://cloud.tencent.com/document/product/1207/47147) 创建并登录实例，再根据所用技术栈部署服务、配置域名与 HTTPS。


#### <a id="personal-upgrade-connectivity"></a>验证部署结果

从服务器之外的设备请求公网**业务端点**，验证连通性。先将下方占位地址替换为完整业务 URL（包括查询参数），有鉴权要求时补充必要请求头。此命令适用于 GET；POST 接口需按实际接口添加请求方式、请求体和 Content-Type。只检查 402，不发起付款：


```bash
curl -i --connect-timeout 10 --max-time 30 'https://你的服务域名/你的接口路径'
```

应看到 HTTP 402 和 `Payment-Needed` 响应头。根路径 `/` 的 404 不能判断业务端点是否可用。确认支付宝登记地址与实际业务端点一致。

验证阶段可用 SQLite 等存储订单，但必须实现订单去重和幂等；容器本地文件可能随重建丢失，需使用持久化存储。


### <a id="personal-upgrade-online-verify"></a>2.5 服务上线自测

**线上验证会产生真实扣款**。开始前请确认以下两点：

- **买家账号**：须与卖家不同
- **金额**：与支付宝注册价一致（建议 0.01 元）

这一步验证已部署的服务端。先安装买家侧官方支付能力，让 Agent 确认可加载 `alipay-payment-skill` 并使用 `alipay-bot`。


```bash
npx -y @alipay/agent-payment@latest install
```

将真实资源 URL、请求方式和参数交给 Agent，使用以下提示词生成临时自测流程：


```text
请加载 alipay-payment-skill，对已部署的业务接口进行上线自测。

业务信息：
- 接口用途：<填写>
- 请求方式及完整 URL：<填写>
- 请求参数、请求体和必要请求头：<按实际接口填写>
- 支付宝服务注册价格：<填写>

要求：
1. 发起原始请求，核对 HTTP 402 和账单金额，并按官方流程生成支付入口；展示后等待我付款。
2. 我付款后，复用原请求和原订单获取资源，不重新下单。
3. 核对业务结果和商家履约记录；无法读取服务端日志时，列出需要我核对的项目。
4. 状态不明时先查询原订单，不重复付款或追加回执；缺少信息时先向我确认。
```


1. 在 Agent 中运行自测流程，提供真实业务参数，确认账单金额。
2. 按官方支付界面完成账号授权与付款。
3. 确认服务端验付后返回正确结果，并完成商家履约确认。
4. 在 [支付宝商家中心 - 我卖出的交易](https://b.alipay.com/page/mbillexprod/trade/order/sold) 核对交易；按 AI 付站点线上验证页面要求回填交易号。


![Agent 弹出支付二维码](https://cloudcache.tencent-cloud.com/qcloud/tea/app/skillhub/assets/tutorials/skillpay/zhifuerweima.c2a35d6c.png)
*Agent 弹出支付二维码，扫码付款后自动完成验付和履约。*


#### <a id="personal-upgrade-checklist"></a>服务自测验收

| 检查项 | 通过标准 |
| --- | --- |
| 产品与应用 | 收款产品已开通，生产应用可用 |
| 配置 | 密钥、网关、serviceId 均为生产值 |
| 地址 | 公网业务端点返回 402，登记地址与实际请求一致 |
| 价格 | 支付宝登记价与服务端 402 账单金额一致 |
| 买家账号 | 与卖家不同 |
| 交付与履约 | 付款成功、结果正确、商家履约已确认 |
| 订单恢复 | 同一订单重试不会重新扣费，服务端履约处理保持幂等 |

**完成标志**：生产服务自测通过，验证所需交易号已回填。


**Q：沙箱通过了，上线却支付失败，常见原因有哪些？**

A：最常见的三类：① 产品开通审核尚未通过，serviceId 未真正生效；② serviceId / 网关地址 / 密钥仍是沙箱配置未替换为生产值；③ AI 付站点注册的服务地址与实际接口地址不一致。逐项对照「服务自测验收（第二章末尾）」排查即可。


## <a id="personal-skill-upgrade"></a>三、改造与测试 Pay Skill

已有业务 Skill 时，直接在原有能力上接入付费流程；尚未创建 Skill 时，可根据业务 API 一并生成。两种方式都需要完成本地加载和 402 支付链路测试。服务端负责验付、交付资源与商家履约确认；Skill 负责发起请求、调用官方支付能力和展示结果。后端源码独立部署，不放入 Skill 包。


**Q：个人接入需要自己写支付代码吗？**

A：可使用官方 Skill 生成服务端集成代码，并复用官方买家支付能力。你仍需提供真实业务接口，完成生产配置、部署和验证。第三步提供改造或生成 Pay Skill 文件的提示词。


### <a id="personal-skill-dependencies"></a>确认买家侧依赖

买家侧依赖 `@alipay/agent-payment` 用于买家支付，已在 [2.5 服务上线自测](/tutorials#personal-upgrade-online-verify) 安装。若跳过了自测或换了新的 Agent 环境，先按该节重新安装并确认可用。`@alipay/alipay-aipay` 用于卖家集成收费接口，两者用途不同。


### <a id="personal-skill-script"></a>改造或生成 Pay Skill 文件

将下面的业务信息替换为真实值后发给 Agent。提示词不包含密钥；服务端的生产配置应已完成。


```text
请先检查当前项目是否已有业务 Skill，并遵循本机安装的 alipay-payment-skill。若已有，请保留原有业务能力、触发条件和输出，为它接入已经部署的收费接口；若没有，请根据以下业务信息创建完整的 Pay Skill。

业务信息：
- Skill 名称：<小写英文名称，例如 image-paid>
- 能力与触发词：<填写>
- 请求方式及完整资源 URL：<填写>
- 请求参数、请求体和必要请求头：<按实际接口填写>
- 单次价格：<与支付宝服务登记一致>
- 成功响应及展示字段：<填写>

要求：
1. 保留现有 Skill 的触发条件、输入和结果展示，只补充收费流程；如需新建，交付可直接使用的 SKILL.md 和所需脚本。写清输入、价格、依赖和调用方法。
2. 按已安装的官方文档调用支付能力，不自行实现付款或签名；保留原始请求及业务目的，支付后复用同一订单，状态不明时先查单，成功路径不追加独立回执。
3. 提供安装、运行、本地加载和打包说明；排除密钥、.env、状态文件和 node_modules。
4. 用模拟响应测试 402、支付处理中、成功、失败和同订单重试；再加载本地 Skill 验证触发、参数传递和 402 处理，停在付款确认前。
5. 列出仍需补充的真实配置；缺少信息时先向我确认，未经确认不发起真实付款。
```


### <a id="personal-skill-structure"></a>检查交付目录


```text
your-skill/
├── SKILL.md
├── scripts/
│   └── your-skill-paid.mjs
└── references/              # 可选业务资料
```


### <a id="personal-skill-manifest"></a>检查 SKILL.md 与运行结果

确认说明中包含触发词、输入参数、单次价格、依赖安装和调用流程。通过脚本或官方依赖封装支付流程即可，不要求在说明中逐字列出所有服务端 API。

先用模拟响应验证成功、失败和重试分支，再按 Agent 提供的说明，在买家侧 Agent 中加载待上传的本地 Skill。输入真实业务需求，确认 Skill 能被触发、参数传递正确，并能从已部署接口取得 402 账单，停在付款确认前。真实付款与结果交付在第五章验证。

**完成标志**：现有 Skill 已完成改造，或在没有现有 Skill 时已生成完整文件；依赖可用，模拟测试和本地加载验证通过，并指向已通过自测的真实服务端；包内没有密钥、测试状态或依赖目录。


**Q：履约确认失败怎么办？**

A：先确认资源是否已经交付及原订单状态。服务端重试同一订单的商家履约确认，保持幂等；买家 CLI 回执失败则按该 CLI 文档恢复。不要因为回执失败要求用户重新付款。


## <a id="personal-publish"></a>四、发布到 SkillHub


### <a id="personal-publish-entry"></a>进入发布向导

登录 SkillHub，点击「发布 Skill」，选择「发布付费 Skill」。确认个人入驻及支付宝改造已完成，进入「上传基本信息」。


### <a id="personal-publish-form"></a>上传文件并配置计费


1. 上传包含 `SKILL.md` 的 Skill 文件夹或 ZIP 包；最多 200 个文件，总大小不超过 10 MB。
2. 填写 Slug、版本、描述及页面其他必填信息。Slug 使用小写字母、数字和连字符。
3. 进入「完善计费」，填写单次调用价格。SkillHub 价格用于展示，实际收费以服务端账单为准；支付宝登记价、服务端账单价和 SkillHub 展示价保持一致。


### <a id="personal-publish-submit"></a>提交并查看审核结果

提交前可能出现付费改造预检查提示。根据缺失项补充调用流程、脚本或依赖说明；预检查提示与最终审核结果不同。

| 自查项 | 要求 |
| --- | --- |
| 402 账单 | 未付款时返回 402 与 `Payment-Needed` |
| 凭证重试 | 支付后携 `Payment-Proof` 重试，原请求参数保持一致 |
| 服务端验付 | 验证凭证与订单；无效或过期时不交付资源 |
| 商家履约 | 返回资源后发送履约确认，失败可重试 |
| 订单与幂等 | 订单状态可恢复，不重复扣费或交付 |

Skill 可以通过官方 CLI、脚本或依赖封装这些能力；不能仅凭文案声明替代真实可用的服务。


1. 提交后按向导进入「验证 & 案例」，补充使用效果案例。
2. 在个人中心查看发布与审核状态；若被退回，按审核意见修改并重新提交。

**完成标志**：审核通过，Skill 详情页可访问。提交成功或预检查通过不代表已上架。


## <a id="personal-validation"></a>五、上架后买家验证

**强烈建议上架后完成一次买家验证。** 沙箱和服务端自测无法覆盖 SkillHub 上架版本的安装、触发、生产配置及真实支付体验；请从 SkillHub 安装**已上架的版本**，按买家实际使用方式完成验收。


1. 买家打开 Skill 详情页，按安装指引安装上架版本，并确认官方支付依赖可用。
2. 使用真实用户常用的表达调用 Skill，确认触发正确、参数传递完整。
3. 核对详情页展示价格、付款前提示和实际账单金额是否一致。
4. 使用已确认的买家支付宝账号完成付款。
5. 确认买家收到正确结果，卖家可查到对应交易，服务端商家履约已确认。

**完成标志**：买家可安装、付款并收到结果，卖家可查到对应收款。


## <a id="personal-best-practice"></a>六、最佳实践

本节以 0.01 元/次的天气查询为例，说明一笔请求如何依次完成账单生成、用户付款和结果交付。实际金额以支付账单为准。


### <a id="personal-best-practice-example-reference"></a>先体验官方示例

可在[支付宝官方示例页](https://aipay.alipay.com/callpay)体验星座运势的“请求服务 → 用户付款 → 返回结果”流程。这项体验不是接入前置条件；如需付款，请先核对页面价格。


### <a id="personal-best-practice-example-structure"></a>示例说明

下方代码用于解释核心逻辑，不能拼接后直接运行。完整文件、依赖和生成提示词见[三、改造与测试 Pay Skill](/tutorials#personal-skill-upgrade)，并以当前安装的官方支付能力为准。`probe`、`pay`、`complete` 是本例脚本的子命令，不是 Pay Skill 的固定命名。


### <a id="personal-best-practice-example-probe"></a>触发 402 账单（probe）

用户提出“查询北京天气”后，`probe` 请求天气接口。由于尚未付款，服务端返回 `HTTP 402`，并通过 `Payment-Needed` 响应头提供账单。脚本保存账单和原始请求，供付款后继续使用：


```javascript
// 请求资源接口，未付款时预期返回 HTTP 402
const curlArgs = [
  '-s', '-D', headerFile,
  '--connect-timeout', '10',
  '-o', bodyFile,
  '-w', 'HTTP_STATUS:%{http_code}',
  resourceUrl, // 例如 https://your-api.example.com/api/resource
];
const { stdout } = await execFileAsync('curl', curlArgs, { timeout: timeoutMs });

const status = Number(stdout.match(/HTTP_STATUS:(\d+)/)?.[1] ?? 0);
if (status === 200) return { kind: 'resource', status, body };
if (status !== 402) throw new Error(`资源请求返回 HTTP ${status}`);

// 从响应头提取账单，落地为状态文件供后续支付使用
const paymentNeeded = headers.match(/payment-needed:\s*([^\r\n]+)/i)?.[1]?.trim();
if (!paymentNeeded) throw new Error('HTTP 402 缺少 Payment-Needed 响应头');
await writeFile(paymentNeededFile, paymentNeeded, { encoding: 'utf8', mode: 0o600 });
```

运行示例：


```bash
node scripts/weather-paid.mjs probe --city '北京' --state-dir '.state/SESSION_KEY'
```


### <a id="personal-best-practice-example-pay"></a>推进支付，用户扫码授权（pay）

`pay` 将 402 账单和原始资源请求交给支付宝官方 CLI（`alipay-bot`），展示查询用途、金额和支付入口，等待用户扫码授权。脚本只负责编排，不接触支付密钥，也不自行实现支付：


```javascript
// 组装 A2M 支付命令：把账单文件与原始资源请求交给官方 CLI
export function buildBuyerPayArgs(state) {
  return [
    '402-buyer-pay',
    '--session-id', state.sessionId,
    '--file', state.paymentNeededFile,
    '--resource-url', state.resourceUrl,
    '--method', state.method,
    '--intent-summary', `原始请求：查询${state.city}天气`,
  ];
}

// POST 请求还须传入原始请求体和必要请求头
await runAlipayBot(buildBuyerPayArgs(state));
```

运行示例：


```bash
node scripts/weather-paid.mjs pay --city '北京' --state-dir '.state/SESSION_KEY' --session-id 'SESSION_KEY'
```


### <a id="personal-best-practice-example-complete"></a>查询并交付结果（complete）

用户付款后，`complete` 使用订单号查询原订单，并继续原始资源请求。服务端验证付款凭证，返回天气结果并完成商家履约确认。

官方买家 CLI 取得非空资源后会按当前流程发送买家回执，成功路径不再调用独立回执。只有输出明确显示回执失败，并且用户要求恢复时，才按官方 Skill 文档处理；不重新付款或请求资源。


```javascript
// 原理片段：查询原订单，保留原始资源请求
async function complete(state) {
  const queryResult = await runAlipayBotCaptured([
    '402-query-payment-status',
    '--out-shake-no', state.outShakeNo,
    '--resource-url', state.resourceUrl,
    '--method', state.method,
  ]);
  // 原样保留官方 CLI 的结果或错误；成功路径不再追加买家回执
  process.stdout.write(queryResult.stdout ?? '');
  process.stderr.write(queryResult.stderr ?? '');
  return queryResult.exitCode;
}
```

运行示例：


```bash
node scripts/weather-paid.mjs complete --state-dir '.state/SESSION_KEY' --out-shake-no 'OUT_SHAKE_NO'
```

调用成功后，Agent 展示天气结果；支付过程中产生的状态或错误仍按官方 Skill 原样展示。


```text
📍 北京
🌤️ 天气：晴
🌡️ 温度：28°C
💧 湿度：45%
🌬️ 风力：东南风 3级
🕐 更新时间：2026-08-10 20:00:00
```


### <a id="personal-best-practice-example-flow"></a>完整链路

请求资源并取得 402 账单 → 用户确认付款 → 查询原订单并取得资源 → 服务端确认履约。用于其他业务时，需要同步调整触发词、请求方式、参数、资源接口、结果解析和服务登记，并重新完成验证。

