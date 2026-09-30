# OpenMCP 商业方案（OpenWork 桌面 × OpenMCP 市场 × 平台网关）

> **文档类型**：商业 / 合作 / 投资向方案（只写文档，不改任何应用代码）  
> **撰写日期**：2026-09-29（Asia/Shanghai）  
> **受众**：商务、投资、合作伙伴、管理层  
> **证据基线**：`/workspace/docs/OPENWORK_OPENMCP_LITELLM_INTEGRATION.md`；OpenMCP `develop-mcp` tip `9c5e625d`  
> **姊妹文档**：[产品方案](./OPENMCP_PRODUCT_PLAN.md) · [技术实现方案](./OPENMCP_TECHNICAL_IMPLEMENTATION.md)  
> **约束**：不写入任何密钥；不对 `openwork` / `n8nshow` 做代码补丁。  
> **品牌提示**：终端用户只见 **OpenMCP** 与 **OpenWork**；**LiteLLM** 为实现对内供应商名，不作为用户可见产品品牌（见决策 #11）。

---

## 1. 摘要与决策锁定

### 1.1 一句话定位

**OpenWork** 是本地优先的桌面执行面（MIT）；**OpenMCP** 是公开市场、自研企业控制面，以及用户可见的**平台网关与密钥入口**；底层以 **LiteLLM** 为 **LLM + A2A + MCP** 统一实现网关（含 OpenWork 内置 OpenCode 的服务端 LLM 流量）。三者通过身份、资产目录、安装协议与计费事件对接，**不合并 monorepo，不把 OpenMCP 并入 `ee/apps/den-api`**。

**用户可见品牌层**：仅 OpenMCP + OpenWork 桌面。  
**实现 / 供应商层**：LiteLLM 单一网关栈（合作伙伴与工程文档可点名；面向用户的文案与 UI **不**出现「LiteLLM」品牌）。

### 1.2 产品所有者已锁定决策（覆盖旧稿冲突点）

| # | 决策 | 结论 |
|---|------|------|
| 1 | LLM / 市场网关是否走 OpenWork Den | **否**。LLM + A2A + MCP 流量走 **OpenMCP 平台网关**（实现为 LiteLLM），永不把 Den 当网关 |
| 2 | 企业控制面 | **OpenMCP 自研**；形态见决策 #13（独立可部署 `apps/enterprise`），规避 OpenWork EE / Den 许可证依赖 |
| 3 | Org / 策略 / 目录等企业能力 | 在 **OpenMCP 内开发**，不通过再分发或托管 Den 获得 |
| 4 | 企业客户默认能力来源 | **OpenMCP 公开市场**（MCP / A2A / Skills） |
| 5 | 个人用户可否仅用 OpenMCP、永不登 Den | **允许（是）**，对齐 OpenWork 桌面 MIT |
| 6 | Provider 分成是否透传到 Den | **否**。结算路径：OpenMCP ↔ 创作者 ↔（背后 LiteLLM 计量）；Den 不在资金链上 |
| 7 | 中国区是否提供 OpenWork Den 独立托管 | **不提供** |
| 8 | 网关供应商策略 | **LiteLLM 单一供应商**（实现层）；用户面不另立第二网关品牌 |
| 9 | caution 级 Skill 企业桌面策略 | **提示后允许**（默认不硬拦） |
| 10 | A2A 0.3 / 1.0 与客户端支持矩阵 | **由 OpenMCP 维护** |
| 11 | 统一网关范围与用户品牌 | LiteLLM 为 **LLM + A2A + MCP** 统一后端网关，并作为 OpenWork 内置 OpenCode 的**服务端 LLM 网关**；对终端用户 **不存在 LiteLLM 产品面**——密钥称 **OpenMCP 密钥 / OpenMCP Virtual Key / 平台网关 Key**，网关称 **OpenMCP 平台网关** |
| 12 | 网站 UI vs 客户端 API | 交付拓扑：**网站 UI**（`apps/openmcp`）+ **集成 API**（`apps/api`）+ **平台网关**（LiteLLM 实现）。不对用户售卖「API 中间层」独立品牌；用户仍只认 OpenMCP |
| 13 | 企业控制面私有化形态 | **阶段 B**：私有化 / 企业 SKU 的控制面 = **独立可部署模块**（**OpenMCP Enterprise Control Plane** / `apps/enterprise`），与主应用（市场/钱包/结算）**API-only**；**不做「先同仓再拆」**。可借鉴 Den 能力清单，**不**转售/托管 Den。控制面 **不是** 网关用量产品 |

### 1.3 商业闭环（简述）

```text
创作者上架 → 用户在 OpenMCP 发现/付费/充值
    → OpenWork（或其它 Agent）安装 Skill / 配置 OpenMCP 平台网关与平台密钥
    → 平台网关硬闸计费（LiteLLM 实现）→ OpenMCP 结算 → Provider 约 70% / 平台约 30%
    → 抽成补贴审核、扫描、获客（桌面免费分发）
```

桌面本身**不收费**；变现重心在**市场交易、平台网关用量、企业控制面模块订阅**。

---

## 2. 产品三角与边界

### 2.1 责任表

| 层 | 角色 | 运行时归属 | 商业 / 品牌形态 |
|----|------|------------|-----------------|
| **OpenWork Desktop** | 终端执行：本地文件、Skill、本地/远端 MCP、Agent 工作流；内置 OpenCode 的 LLM 请求走平台网关 | 用户机器 Electron + `openwork-server` + OpenCode | MIT 开源免费；**不强制**任何云账号；用户可见品牌之一 |
| **OpenMCP 网站** | 用户可见 Web UI：市场、账号、钱包/账单、企业控制面**页面** | `apps/openmcp`（如 `www.openmcp.cn`） | 获客与交易入口；**不**作为桌面集成合同宿主 |
| **OpenMCP 集成 API** | 桌面 / Agent 连接、安装、密钥与策略投影等 **BFF/API** | `apps/api`（独立服务；主机名 TBD） | 支撑市场与桌面交付；用户文案仍称 OpenMCP |
| **OpenMCP 企业控制面** | org/策略/目录/审计；**私有化核心交付物** | **`apps/enterprise`**（阶段 B 独立可部署） | 企业模块订阅 / 专有云项目；与主应用 API-only；**≠** Den、**≠** 网关 |
| **OpenMCP 平台网关** | 用户可见的 LLM+MCP+A2A 调用与硬闸入口 | 对外域名（如 `api.openmcp.cn`）；实现为 LiteLLM | 用量变现执行点；与网站、api、enterprise 分离 |
| **LiteLLM（实现层）** | **唯一**后端网关供应商：代理 LLM/A2A/MCP、Virtual Key、预算/限流、上游 OAuth 代持（Mode ①） | 部署在 OpenMCP 运维边界内（公有或专有云） | **不对终端用户售卖或冠名**；合同/采购/运维可写供应商名；OpenMCP 钱包余额镜像为 `max_budget` |

### 2.2 硬边界

1. **本地执行**（读文件、跑 Skill、stdio MCP）→ OpenWork / OpenCode，不经 OpenMCP 应用热路径。  
2. **公开市场发现、付费授权、创作者分成、密钥签发 UI** → OpenMCP **网站**（用户品牌）；背后数据经 **`apps/api`**。  
2b. **桌面 / Agent 集成契约**（Device Code、Store MCP、安装回调、策略拉取）→ **`apps/api`**，不以网站 origin 为 SoT。  
3. **LLM + A2A + MCP 调用路径与用量硬闸** → **同一套平台网关**（实现为 LiteLLM；不经网站或 `apps/api` 代理业务调用热路径，也**不经 Den**）。  
4. **OpenWork 内置 OpenCode 的服务端 LLM 流量** → 同一套 **OpenMCP 平台网关**，**不是** Den，也**不是**第二套用户可见网关品牌。  
5. **企业组织、桌面策略、能力目录、成员管理** → **`apps/enterprise`（阶段 B 独立模块）**，**不是**再分发的 OpenWork Den，也**不是**平台网关。  
6. **不把** OpenMCP 后端并入 `ee/apps/den-api`；**不在中国区**独立托管 Den。  
7. OpenWork 上游自有推理网关（`ee/apps/gateway`）与本方案平台网关 **账本隔离**；本方案市场与桌面 LLM 调用**不**写入 OpenWork Gateway 结算。

### 2.3 用户视角 vs 实现视角（摘要）

| 用户看到的 | 实现上是 |
|------------|----------|
| OpenMCP 平台网关 | LiteLLM 代理端点（热路径） |
| OpenMCP 平台 / 连接 OpenMCP（桌面） | **`apps/api` 集成契约** |
| OpenMCP 密钥 / OpenMCP Virtual Key / 平台网关 Key | LiteLLM Virtual Key（如 `sk-…`） |
| OpenMCP 钱包余额与用量账单 | 余额同步 `max_budget` + LiteLLM spend 回写 |
| 「在 OpenWork 里用平台模型/市场工具」 | OpenCode / 客户端 → 同一 LiteLLM 栈 |

详见表末附录「用户视角 vs 实现视角」。

### 2.4 交付拓扑（决策 #12 · #13，商业摘要）

对外售卖与交付的 OpenMCP 栈在工程上分层如下，**用户品牌仍统一为 OpenMCP**：

1. **网站**（`apps/openmcp`）— 获客与交易 UI；  
2. **集成 API**（`apps/api`）— 桌面 / Agent 连接与安装合同；  
3. **企业控制面**（**`apps/enterprise`**，阶段 B）— **私有化 / 企业 SKU 的独立可部署控制面模块**；与主应用（市场/钱包/结算）API-only；  
4. **平台网关**（LiteLLM 实现）— 用量与硬闸。  

**私有化 SKU 包装**：以 **独立控制面模块（`apps/enterprise`）+ 客户侧 API + OpenMCP 品牌网关**（± 控制台 UI）交付，**不必**向客户售卖「LiteLLM」或「Den」；中国区套件**仍不含 Den**。  
公开市场浏览与 **Provider settlement 权威**默认留在 OpenMCP 主应用（SaaS），专有云经签名 API 联通或按合同做镜像；空载细节见技术文档。完整拓扑 → [技术实现 §4.6](./OPENMCP_TECHNICAL_IMPLEMENTATION.md)。

### 2.5 与旧稿的关键纠偏

旧稿曾将「组织内能力分发」默认归 Den，并将企业包包装为「自托管 Den + OpenMCP」。**现行锁定**：中国区与本团队渠道**不以 Den 为控制面或托管商品**；企业能力以 **`apps/enterprise` 独立模块（阶段 B）** 建设；国际客户若自行采购上游 Den，与本平台资金与网关路径**解耦**。另：**不对用户售卖「LiteLLM」品牌**；统一网关覆盖 LLM+A2A+MCP 及 OpenCode 服务端 LLM；**网站与集成 API 分轨**（#12）；**控制面独立可部署、非同仓后再拆**（#13）。

---

## 3. 目标客户与价值主张

### 3.1 个人开发者 / 独立 Agent 用户

| 维度 | 内容 |
|------|------|
| 画像 | 可用 BYO 模型密钥，或改用 OpenMCP 平台网关；本地干活；可能用 Cursor / Claude Code / OpenWork |
| 桌面 | OpenWork MIT 免费；**无需登录 Den** |
| 市场 | 免费 Skills；付费 Skills（钱包）；市场 MCP/A2A 按平台网关用量 |
| 价值主张 | 「装上桌面就能干活；需要能力时打开 OpenMCP 安装；一把 **OpenMCP 平台密钥**搞定模型与市场调用」 |
| 明确回答 | **允许仅 OpenMCP、永不登 Den**；用户文案中**不出现** LiteLLM 品牌 |

### 3.2 中小团队（约 5–50 人）

| 维度 | 内容 |
|------|------|
| 画像 | 共享 Skills/MCP，要基础审计与预算池 |
| 能力来源 | **默认 OpenMCP 公开市场**；团队管理员在 OpenMCP 企业模块做白名单 / 策略 |
| 网关 | 共享或分发的 **OpenMCP 平台密钥** 预算池（背后同一 LiteLLM 栈） |
| 价值主张 | 统一采购与结算，无需引入第二套 EE 控制面，也无需向成员解释第三方网关品牌 |

### 3.3 中大型企业 / 高合规客户

| 维度 | 内容 |
|------|------|
| 画像 | SSO（路线图）、策略、数据驻留、私有审核 |
| 控制面 | **OpenMCP 企业模块**（组织、策略、目录、审计），非 Den 托管 |
| 能力默认源 | 公开市场 + 管理员审批 / 「仅 certified」等策略 |
| 部署 | **`apps/enterprise` + api + 网关** 专有云或本地；**中国区不附带 Den 托管**；采购合同可披露底层网关供应商为 LiteLLM |
| 价值主张 | 许可证路径清晰：桌面 MIT + 自有市场/控制面 + **单一平台网关品牌**，降低 EE 转售与多品牌纠缠 |

### 3.4 创作者 / ISV（Provider）

| 维度 | 内容 |
|------|------|
| 入驻 | 个人可上 Skills；企业可上 MCP + A2A + Skills（既有门禁） |
| 分成 | 约 **70% Provider / 30% 平台**（以现行 `PROVIDER_SETTLEMENT` 为准；可商务谈判） |
| 结算路径 | **OpenMCP ↔ 创作者**；用量计量在平台网关（LiteLLM）回写 OpenMCP；**分成不透传、不流经 Den** |
| 价值主张 | 一次上架，经 **OpenMCP 平台网关**触达多客户端（含 OpenWork） |

### 3.5 园区 / 政府（扩展，非 MVP 核心）

统一入口、本地审核、白标——项目制收入；须等核心市场与企业模块跑通后再售。中国区方案栈为 **OpenMCP（含平台网关）+ OpenWork 桌面**，**不含 Den 独立托管**；对内集成说明可写 LiteLLM。

---

## 4. 收入模型

### 4.1 四条收入线

| 收入线 | 说明 | 主要付费方 |
|--------|------|------------|
| **A. 桌面获客（免费）** | OpenWork MIT 分发，不直接收费；降低冷启动 | — |
| **B. 付费 Skills** | 钱包购买 / 未来直连支付；平台抽成 | 终端用户 |
| **C. 平台网关用量** | LLM + 市场 MCP/A2A 调用；余额硬闸；用户账单记在 **OpenMCP** | 终端用户 / 企业钱包 |
| **D. 企业控制面模块** | 组织、策略、目录、审计、专有云；**独立模块 `apps/enterprise` 订阅 / 项目制交付** | 企业客户 |

### 4.2 飞轮与单位经济（定性）

- **获客成本**：桌面开源 + 安装文档 + Store MCP，压低获客 CAC。  
- **变现**：付费资产与平台网关用量；企业模块提高 ARPU 与留存。  
- **供给**：70/30 与提现路径吸引 Provider；安全扫描与 `certified` 提升信任溢价。  
- **不依赖** Den 订阅转售作为中国区主收入；**不对用户销售 LiteLLM 牌照**，供应商成本计入平台 COGS。

### 4.3 包装示例（非法律报价，仅结构示意）

1. **创作者计划**：免费入驻；付费资产与调用平台约 30%；认证资产流量倾斜。  
2. **OpenMCP Pro 用户**：月费含平台网关额度包 + Skill 折扣（示例结构，具体价目另定）。  
3. **OpenMCP 企业版 / 私有化**：独立控制面（`apps/enterprise`）+ 预算池 + 策略（caution=提示后允许可配）+ 客户侧 API + 可选平台网关专有云（**不含 Den**）。  
4. **渠道桌面包**：预装 OpenWork + OpenMCP 入门页；**不含**中国区 Den 托管 SKU；入门页只教 OpenMCP 密钥，不教 LiteLLM。

### 4.4 明确不卖 / 不打包的内容

- 中国区 **OpenWork Den 独立托管**。  
- 以 Den 为 LLM/MCP/A2A **网关** 的任何 SKU。  
- 将 Provider 结算账本挂到 Den 或 OpenWork Gateway。  
- 面向终端用户的 **「LiteLLM 产品 / LiteLLM Key」** 独立 SKU 或品牌页。

---

## 5. Provider / 创作者分成与结算路径

### 5.1 锁定回答

> **Provider 分成是否透传到 Den？→ 否。**

资金与分成**不经过** Den，也不因「某企业曾使用上游 Den」而改变归属。计量可发生在 LiteLLM，**结算权与应付创作者账本在 OpenMCP**。

### 5.2 结算路径（唯一主路径）

```text
用户充值 / 购 Skill（OpenMCP UI）
  → OpenMCP balances / entitlements
  → syncUserGatewayBudget → 平台网关 max_budget / blocked（LiteLLM 实现）

用户经 OpenMCP 平台网关调用 LLM / 市场 MCP/A2A
  （含 OpenWork→OpenCode 的服务端 LLM）
  → 网关 spend（硬闸）
  → OpenMCP gateway-settlement（定时，幂等 request_id）
  → 扣减 balances → 再 sync 预算
  → provider_earnings（约 70%）→ 提现审批 → 创作者收款账户
```

| 环节 | 用户可见系统 | 实现 | Den 是否参与 |
|------|--------------|------|--------------|
| 购买 / 充值 / 密钥管理 | OpenMCP | OpenMCP + VK 同步 | 否 |
| 调用鉴权与硬闸 | 「平台网关」 | LiteLLM | 否 |
| 用量回写与分成 | OpenMCP 账单 / Provider 收益 | settlement ← spend logs | 否 |
| 提现 | OpenMCP Admin + Provider 收款信息 | OpenMCP | 否 |

### 5.3 与桌面的关系

OpenWork 仅作为**安装与执行客户端**。OpenCode 服务端 LLM 与市场工具调用共用 **OpenMCP 平台密钥与网关**。即使未来某国际客户自建上游 Den，**本方案流量仍走平台网关**，分成仍落 OpenMCP；Den 不出现在分成报表中。

### 5.4 货币与披露

OpenMCP 有意以 **CNY 额度裸数值**对齐网关 `max_budget`（不做隐式 CNY↔USD 换算）。对外用户合同与账单使用 OpenMCP 品牌；对供应商采购与财务 COGS 可单独列 LiteLLM / 云成本。跨境模型成本另表列示（示例要求，非具体汇率承诺）。

---

## 6. 区域与合规

### 6.1 中国区策略（锁定）

| 项 | 策略 |
|----|------|
| OpenWork Den 独立托管 | **不提供** |
| 市场与桌面 LLM 网关 | **OpenMCP 平台网关**（LiteLLM 实现；可公有云或客户专有云） |
| 企业控制面 | OpenMCP 自研模块 |
| 桌面 | MIT 分发；个人可零云账号 |
| 用户品牌 | 仅 OpenMCP + OpenWork |

### 6.2 许可证与商标

| 项 | 建议 |
|----|------|
| OpenWork 桌面 | 保留 MIT 与上游版权声明；文案用「兼容 OpenWork 桌面」，**非书面授权前不冒充官方发行版** |
| OpenWork `ee/` / Den | **不**作为中国区产品转售前提；不把 EE 源码拷进 MIT 发行物 |
| OpenMCP 品牌 | 网关、密钥、账单、控制台统一 OpenMCP 冠名 |
| LiteLLM | 实现供应商；用户 UI/Help/营销不主动输出该品牌（法务强制披露场景除外） |
| 贡献回馈 | 若需改 OpenWork 客户端行为，优先 upstream PR，降低分叉 |

### 6.3 数据与内容合规

- **KYC / 收款信息**：隐私政策、最短保存、加密编排（密钥仅运维配置，本文不记录值）。  
- **Skill 内容**：安全扫描门控 + caution 风险摘要；企业可策略「仅 certified」或私有复核队列。  
- **调用日志**：落平台网关实现层；结算回写 OpenMCP；企业版支持日志驻留 / 专有云。  
- **OAuth Mode ①**（平台代持上游 token）：合同披露；高合规客户导向自托管或未来 Mode ②。  
- **匿名下载 Skill**：不做（与 OpenMCP 既有决策一致）。

---

## 7. 与 OpenWork Den 的商业关系

### 7.1 关系定性

| 关系 | 说明 |
|------|------|
| 桌面（MIT） | **合作/兼容对象**：获客与执行面；OpenCode LLM 接 OpenMCP 平台网关 |
| Den / EE 控制面 | **非中国区商品、非本方案控制面、非网关、非分成节点** |
| 国际客户自选 Den | 允许客户自行对接上游；与本平台**解耦**，本团队**不**因此承担 EE 转售义务（除非另签合同） |

### 7.2 自研控制面替代逻辑（阶段 B）

旧稿依赖 Den 提供的 org、桌面策略、组织内 marketplace 等能力，改为：

1. 以 **`apps/enterprise`（OpenMCP Enterprise Control Plane）** 独立可部署模块实现企业所需子集——**从第一天起按私有化边界设计**；  
2. 能力目录默认对接**公开市场**（API 同步 / 镜像；airgap TBD）；  
3. 桌面策略（含 caution=提示后允许）由 enterprise 权威、经 `apps/api` 投影到桌面；  
4. **避免**再分发 / 托管 Den，从而规避 EE License 成为中国区商务前提；  
5. 控制面 **不**作为网关用量 SKU；网关用量仍走 OpenMCP 平台网关品牌。

### 7.3 双 MCP 表面（商业话术）

- **OpenMCP Store MCP**：公开市场发现与安装（主推）。  
- **上游 OpenWork `/mcp/agent`**：仅当客户**自行**使用国际 Den 时存在；**不是**本方案中国区交付物，也**不是**市场计费入口。

个人路径话术：**永不需要 Den**；模型与市场工具只认 **OpenMCP**。

---

## 8. Go-to-market 与里程碑

### 8.1 GTM 原则

1. **桌面免费获客** → OpenMCP 完成信任、交易与**平台密钥**发放 → 平台网关锁住用量。  
2. 先打穿个人与小团队，再卖企业控制面模块。  
3. Provider 供给与安全认证同步投流，避免「有客户端无资产」。  
4. 对外清晰声明：中国区无 Den 托管；用户只见 OpenMCP 网关；对内/对供应商坚持 LiteLLM 单一栈。

### 8.2 里程碑（粗框架，周数为量级示例）

| 阶段 | 目标 | 商业结果 |
|------|------|----------|
| **M0 文档与合规** | 本商业/产品方案定稿；隐私与 Mode ① 披露；商标与**品牌分层**话术 | 可对外讲解 |
| **MVP（约 4–8 周量级）** | runtime=`openwork` 安装说明；Device Code 闭环；Skill→`.opencode/skills`；**OpenMCP 平台密钥**文档；OpenCode LLM 接同一网关 | 首批个人付费与调用 |
| **P1** | 桌面 Library「OpenMCP」入口；企业控制面模块 MVP；OIDC 链接可选；全站文案去 LiteLLM 用户面 | 团队/企业试点合同 |
| **P2** | 专有云套件（**enterprise + api + 网关**）、深度链接、统一账单、Mode ② / 高合规 | 扩大 ARPU；园区项目可选 |

### 8.3 财务粗框架（仅结构，无虚构营收数字）

| 科目 | 说明 |
|------|------|
| 收入 | Skill 抽成 + **OpenMCP 平台网关**用量毛利 + 企业模块订阅 / 专有云项目 |
| 成本 | LiteLLM/云基础设施（COGS）、安全扫描/人工审核、支付通道、客服与获客 |
| 分成负债 | `provider_earnings` 应付创作者（约 70%） |
| 不纳入本模型 | Den 订阅转售收入；面向用户的「LiteLLM」独立许可收入 |

具体定价表、毛利率目标、回本周期由财务另表；本文不编造指标。

---

## 9. 风险与开放问题

### 9.1 风险

| 风险 | 影响 | 缓解 |
|------|------|------|
| 企业控制面自研工期 | 功能短窗弱于成熟 Den | 阶段 B 独立模块 MVP 子集；公开市场先跑通交易 |
| 单一网关供应商（LiteLLM） | 供应商锁定 / 故障面 | 运维 SLA、专有云副本；抽象层列为长期课题但不改 MVP |
| 用户面误露 LiteLLM 品牌 | 品牌分裂、支持成本 | 文案规范 + UI 审核清单（决策 #11） |
| Mode ① 代持合规 | 丢高合规单 | 披露 + 专有云 + Mode ② 路线 |
| CNY 额度 vs 国际模型成本语义 | 审计异议 | 合同与报表分列 |
| 结算窗口滞后（如约 5min） | 余额展示延迟 | 硬闸在平台网关；UI 提示 |
| 商标 / 冒充官方 | 法律风险 | 兼容话术 + 书面授权前不冒充 |
| caution 提示后允许 | 企业安全顾虑 | 可升级为「仅 certified」策略；默认保留用户确认 |
| 双身份（MVP） | 摩擦 | Device Code；P1+ OIDC |

### 9.2 仍开放、但不阻塞锁定决策的问题

1. OpenWork 作为一等 runtime 是否需上游商标书面许可？  
2. 企业模块首期功能切片（SSO 深度、SCIM 是否 P2）？  
3. 直连微信/支付宝购 Skill 的上线节奏？  
4. 园区白标是否独立法人与域名？  
5. 长期是否引入可替换网关抽象（与「单一供应商」运营策略的边界）？  
6. 法务强制披露第三方组件时，用户协议脚注的标准措辞？

---

## 10. 附录：术语

| 术语 | 含义 |
|------|------|
| OpenWork Desktop | MIT 桌面执行面（Electron + openwork-server + OpenCode） |
| OpenWork Den | 上游 EE 组织控制面；**本方案中国区不托管、不作控制面/网关/分成节点** |
| OpenMCP | 公开市场 + 自研企业控制面 + 用户可见的平台网关/密钥/钱包与结算 |
| OpenMCP 平台网关 | 用户可见的统一网关（LLM + A2A + MCP）；实现为 LiteLLM |
| OpenMCP 密钥 / 平台网关 Key | 用户可见名称；实现为 LiteLLM Virtual Key |
| Store MCP | OpenMCP **`apps/api`** `{API}/mcp/store`：发现与安装 |
| OpenMCP 网站 | `apps/openmcp`：用户 Web UI only |
| OpenMCP 集成 API | `apps/api`：桌面/Agent/网站共用的 BFF/API |
| OpenMCP Enterprise Control Plane | `apps/enterprise`：独立可部署企业控制面（阶段 B）；≠ Den、≠ 网关 |
| LiteLLM | **实现层**唯一网关供应商；非用户可见产品品牌 |
| Provider | 创作者 / ISV |
| Entitlement | Skill 购买或免费获取后的使用权记录 |
| caution | Skill 安全分级之一；企业默认**提示后允许** |
| Device Code | 桌面连接 OpenMCP 的 MVP 身份方式 |

---

## 11. 附录：用户视角 vs 实现视角

| 维度 | 用户视角（对外文案 / UI / 账单） | 实现视角（工程 / 运维 / 供应商采购） |
|------|----------------------------------|--------------------------------------|
| 产品组合 | OpenWork 桌面 + OpenMCP 平台 | 同上 + LiteLLM 进程/集群 |
| 网关 | OpenMCP 平台网关 | LiteLLM Proxy（LLM + A2A + MCP） |
| 密钥 | OpenMCP 密钥 / OpenMCP Virtual Key / 平台网关 Key | LiteLLM Virtual Key |
| 桌面模型调用 | 「使用 OpenMCP 平台模型」 | OpenWork → OpenCode → 同一 LiteLLM |
| 市场工具调用 | 「经 OpenMCP 调用 MCP/A2A」 | 客户端 → LiteLLM `/{server}/mcp` 等 |
| 计费与分成 | OpenMCP 钱包 / Provider 收益 | spend logs ← LiteLLM；settlement ∈ OpenMCP；**≠ Den** |
| 品牌禁区 | 用户流不出现「LiteLLM Key / 去 LiteLLM 注册」 | README/运维 runbook/合作伙伴技术附件可写 LiteLLM |
| 网站 vs API | 用户只感知「OpenMCP 网站 / 连接 OpenMCP」 | `apps/openmcp` UI + `apps/api` 服务 |
| 企业控制面 | OpenMCP 企业控制台 / 企业版 | `apps/enterprise`（独立交付；≠ Den） |

---

*文档结束。路径：`/workspace/docs/OPENMCP_COMMERCIAL_PLAN.md`*
