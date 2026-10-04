# 提供者（Provider）侧资产网关注册 UED 交互设计

> 版本：v0.2（评审稿，融合 GitHub 同步 + 安全扫描）
> 范围：OpenMCP「提供者入驻」之后的资产注册与交付体验
> 参考：
> - LiteLLM A2A / MCP 网关注册功能
> - agent-skills-hub 安全扫描实现（security_scanner.py + llm_security_analyzer.py）
> - design-github-repos-skills-webhook-sync.md（github-nextjs 到 openmcp webhook 同步）
> - [PROVIDER_OAUTH_MODE1.md](./PROVIDER_OAUTH_MODE1.md) — OAuth Mode ① 平台代持授权实现（2026-09-22）

---


> **实现进度（2026-09-20）**：安全扫描、`/api/webhook/daily/skills`、ZIP 上传、Admin skill-reviews 等已有代码实现；本文为 UED + 与实现对齐说明，不再是「确认前禁止编码」。上架规则以 [SKILLS_PUBLISH_POLICY.md](./SKILLS_PUBLISH_POLICY.md) 为准。

> **路径说明（2026-09-20）**：本文接口路径已与当前实现对齐为 `/api/webhook/daily`（仓库）与 `/api/webhook/daily/skills`（Skills）。旧稿中的 `/api/webhooks/repos|skills` 已废弃。

> **提交门禁（2026-09-20）**：三大货架 submit 页已统一 `ProviderSubmitShell` + `ProviderSubmitGate`（登录 → 实名 verified → 表单）；付费须收款通道 ready。详见 [PROVIDER_SUBMIT_GATE.md](./PROVIDER_SUBMIT_GATE.md)。

## 1. 背景与目标

LiteLLM 网关注册第三方服务端/智能体时，采用「一个名称 + 一个端点 + 协议版本」的最简注册：录入后可立即被客户端调用、可逐资产做权限控制、可查看调用日志与成本。反观当前 OpenMCP 提供者的发布页面（/mcp/submit、/a2a/submit、/skills/submit），是一次性长表单 + 人工审核，缺少：

- 注册后的资产列表与实时状态（在线/离线/异常/扫描中/已驳回）
- 连接测试环节（端点是否可达、Agent Card 是否可读）
- 协议版本/传输方式的显式配置（A2A 0.3 vs 1.0，MCP Streamable HTTP vs SSE）
- 基于资产粒度的授权与可见性管理
- 调用观测（日志/延迟/错误率）
- Skills 内容安全扫描（平台侧规则+LLM 已落地；提交态与上架门控见 SKILLS_PUBLISH_POLICY.md）

本设计把「注册/连接」与「上架交付」拆成两段交互，让提供者先完成技术接入（即时反馈、可测试），再补充上架信息进入审核。

### 1.1 大陆 GitHub 访问约束

由于大陆网络限制，openmcp 服务端无法直接访问 GitHub。因此：

- GitHub 仓库抓取统一由 apps/github-nextjs（部署在可访问 GitHub 的环境）完成，通过 webhook 将仓库/Skill 数据同步到 openmcp。
- ZIP 上传由 openmcp 直接接收（用户上传，不依赖 GitHub 访问）。
- 安全扫描全部在 openmcp 侧执行（基于 webhook 同步过来的 README/源码内容，或 ZIP 解压后的文件）。

---

## 2. 术语

| 术语 | 含义 |
|---|---|
| Provider / 提供者 | 完成入驻（个人/企业实名）后可发布资产的一方 |
| 资产（Asset） | 可被网关接入的实体：MCP Server、A2A Agent、Skill |
| 接入（Connect） | MCP/A2A：登记端点、鉴权、协议版本，网关可成功握手/调用；Skill：提交 GitHub URL 或 ZIP 包，通过安全扫描 |
| 上架（Publish） | 补充分类、定价、说明，提交审核后对市场可见 |
| github-nextjs | 部署在可访问 GitHub 环境的应用，负责抓取 GitHub 仓库/Skill 数据并通过 webhook 同步到 openmcp |
| 安全扫描（Security Scan） | 对 Skill 内容进行规则匹配 + LLM 语义分析的两阶段安全评估 |
| 规则扫描 | 零成本正则匹配，基于 SlowMist 11 类风险 + 5 级信任层级，产出 4 级评级 |
| LLM 复核 | 对规则扫描判为 caution/unsafe 的 Skill，用 LLM 做语义分析，区分合法工具用法和真实威胁 |

---

## 3. 用户旅程总览

### 3.1 MCP / A2A 资产（端点接入）

入驻 -> 提供者后台「我的资产」->「接入新资产」-> 选择 MCP Server / A2A Agent
- 1. 填端点 URL -> 一键「自动发现」（拉 .well-known/agent.json 或 mcp.json）-> 自动预填名称/描述/协议版本/鉴权
- 2. 补全/确认配置（协议版本、鉴权方式）
- 3. 「测试连接」-> 分级反馈（握手 -> 鉴权 -> tools/list -> Agent Card）-> 通过才能保存
- 4. （可选）沙箱试调：Postman 式面板直接调一个 tool
- 5. 上架信息（分类/定价/说明）-> 提交审核
- -> 资产列表（状态：在线 -> 审核中 -> 已上架/已驳回）

### 3.2 Skill 资产（内容接入）

入驻 -> 提供者后台「我的资产 · Skills」->「接入新 Skill」
- 路径 A：GitHub 仓库 URL
  - openmcp 不直接访问 GitHub，而是通过 internal API 与 github-nextjs 交互（不跳转）：
    - 若 github-nextjs 已抓取该仓库 -> 从已同步数据读取
    - 若未抓取 -> openmcp 调用 github-nextjs internal API 触发按需抓取 -> 轮询等待 webhook 同步完成
    - Provider 全程留在 openmcp
- 路径 B：ZIP 包上传
  - openmcp 直接接收 ZIP -> 解压 -> 解析 skill.yaml + README
- 1. 自动解析 skill.yaml 元信息
- 2. 安全扫描（两阶段：规则扫描 -> LLM 复核）
  - safe -> 直接通过，可上架
  - caution -> 通过但带风险提示徽标
  - unsafe -> 阻塞上架，进人工复核队列
  - reject -> 自动驳回，附原因回显
- 3. 上架信息（分类/定价/说明）-> 提交审核（仅 safe/caution 可提交）
- -> 资产列表 · Skills（状态：扫描中 -> 已通过/待人工复核/已驳回 -> 审核中 -> 已上架）

关键原则：接入（技术可行性/内容安全性，以测试/扫描通过为准）先于上架（商业审核）；只有测试/扫描成功的资产才能保存并产生记录，审核只决定「是否对外可见/可卖」。

---

## 4. 页面一：提供者后台「我的资产」（资产列表）

入口：原「我的关系」更名为「我的资产」，下分 MCP / A2A / Skills 三个独立菜单入口，各自独立列表页与独立观测页，侧边栏分组展示。

### 4.0 菜单与分组

| 菜单 | 内容 | 接入方式 | 说明 |
|---|---|---|---|
| 我的资产 · MCP | MCP Server 列表 + 观测 | 端点注册（HTTP/SSE） | 传输方式：Streamable HTTP / SSE（v0.1 不支持 stdio） |
| 我的资产 · A2A | A2A Agent 列表 + 观测 | 端点注册 | 协议版本：0.3 / 1.0 |
| 我的资产 · Skills | Skill 列表 + 观测 + 安全扫描结果 | 内容接入（GitHub URL via webhook / ZIP 上传） | 独立流程，见 §6 |

### 4.1 布局

- 顶部：标题 · 类型（MCP / A2A / Skills）· 子入口 Tab + 「接入新资产」主按钮 + 筛选（状态 / 搜索）。
- 列表行（卡片式）字段：

| 列 | MCP / A2A | Skills |
|---|---|---|
| 资产 | 图标 + 名称 + 类型徽标 + agent_name/server_name | 图标 + 名称 + 来源徽标（GitHub / ZIP） |
| 端点/来源 | https://...（A2A 显示 .well-known/agent.json 状态点） | GitHub 仓库地址 或「ZIP 上传」 |
| 协议/版本 | MCP：Streamable HTTP / SSE；A2A：0.3 / 1.0 | skill.yaml version |
| 状态 | 见 4.2 | 见 4.2 |
| 安全评级 | —（端点接入不涉及） | safe / caution / unsafe / reject 徽标 |
| 可见性 | 公开 / 私有 / 团队 | 公开 / 私有 / 团队 |
| 上架 | 免费 / 定价 / 待审核 | 免费 / 定价 / 待审核 |
| 操作 | 详情 / 测试 / 编辑 / 启停 / 删除 | 详情 / 重扫 / 编辑 / 启停 / 删除 |

### 4.2 状态机

**MCP / A2A：**

| 状态 | 含义 | 颜色 | 可执行操作 |
|---|---|---|---|
| 在线（已接入） | 连接测试已通过 | 绿 | 上架、测试、编辑、授权 |
| 审核中 | 已提交上架 | 黄 | 撤销上架 |
| 已上架 | 市场可见 | 蓝 | 启停、调价、下架 |
| 已驳回 | 审核未通过（附原因） | 红 | 编辑后重新提交 |
| 已停用 | 手动停用 | 灰 | 启用、删除 |
| 异常 | 最近探测/调用失败（需重新测试） | 橙 | 测试、查看日志 |

**Skills：**

| 状态 | 含义 | 颜色 | 可执行操作 |
|---|---|---|---|
| 扫描中 | 安全扫描进行中（规则 + LLM） | 蓝 | 等待 |
| 已通过（safe） | 规则 + LLM 均通过 | 绿 | 上架、重扫、编辑、删除 |
| 有风险提示（caution） | 扫描通过但带风险标记 | 黄 | 上架（带提示）、重扫、编辑、删除 |
| 待人工复核（unsafe） | 规则/LLM 判定高风险，阻塞上架 | 橙 | 查看扫描详情、申诉、删除 |
| 已驳回（reject） | 确认恶意，自动驳回 | 红 | 查看原因、删除 |
| 审核中 | 已提交上架（仅 safe/caution 可提交） | 黄 | 撤销上架 |
| 已上架 | 市场可见 | 蓝 | 启停、调价、下架 |
| 已停用 | 手动停用 | 灰 | 启用、删除 |

### 4.3 空/加载/错误态

- 空态：「还没有接入任何资产」+ 引导按钮 + 参考示例。
- 加载态：骨架屏；错误态：重试按钮；离线态：不阻塞列表浏览。

---

## 5. 页面二：接入新 MCP / A2A 资产（两步向导）

### 5.1 第 1 步：连接配置（核心）

**便捷接入原则：自动发现优先，手填为辅。**

字段（按序）：

1. **资产类型**（radio / 卡片选择）：MCP Server / A2A Agent（选择后切换下文动态字段）。

2. **端点地址 url**（必填）：
   - 输入根 URL 后，显示「自动发现」按钮：
     - A2A：自动拉取 /.well-known/agent.json，预填名称/描述/技能/版本/鉴权。
     - MCP：尝试拉取服务端能力声明 / tools/list，预填名称/工具列表。
   - 自动发现成功后，Provider 只需确认/补全，无需逐项手填。
   - 自动发现失败时回退为手填模式。

3. **网关标识名 agent_name / server_name**（必填）：
   - 格式校验：小写字母/数字/中划线。
   - 命名空间前缀：采用 {providerSlug}/{assetName} 二级命名，Provider 在自己的命名空间内自由命名，避免全局抢注。
   - 唯一性实时校验。
   - 展示提示：将作为网关调用路径 /mcp/{provider}/{name}、/a2a/{provider}/{name} 的一部分。

4. **协议版本**（A2A 必填；MCP 为绑定传输）：
   - A2A：1.0 / 0.3 下拉（自动发现时从 Agent Card 读取并锁定，手填时强制选择）。
   - MCP：Streamable HTTP（优先）/ SSE。v0.1 不支持 stdio（网关远程调用不可行；平台托管 stdio 需源码上传 + 容器化，后续版本设计）。

5. **鉴权方式**：
   - 无 / Header API Key / Bearer Token / Basic / OAuth2 Client Credentials（机器对机器首选）/ 自定义。
   - v0.1 不支持 OAuth2 交互式（浏览器授权闭环涉及 token 存储/刷新/过期，复杂度高，后续单独设计）。
   - 安全：密钥加密存储、永不回显；测试连接时预览脱敏。

6. **连接测试（必做，通过才能保存）— 分级反馈**：
   - 「测试连接」按钮 -> 即时分步校验，每步独立打勾/打叉：
     - 端点可达（握手）
     - 鉴权通过
     - tools/list 成功（MCP，返回 N 个工具）/ Agent Card 解析成功（A2A）
     - 协议版本匹配
   - 全部通过：绿色「连接成功，返回 N 个工具」/「Agent Card 读取成功」。
   - 任一步失败：红色标注失败步骤 + 常见排查链接（鉴权失败 / 超时 / 协议不支持 / 版本不匹配）；保存按钮禁用。
   - 测试未通过则无法保存（保存按钮禁用）；通过后进入第 2 步。

7. **（可选）沙箱试调**：测试连接通过后，展开 Postman 式试调面板，选择一个 tool 直接调用，返回结果脱敏展示。验证真实业务调用，不只是握手。

8. **服务可用性探测开关（可选）**：周期性健康检查，默认 10 分钟。连续 3 次探测失败才标为 `error`（橙），成功一次立即恢复。见 §16。

## 5.2 第 2 步：上架信息

**实现状态（2026-09-22）：已添加 logo 和 cover 图片上传功能。**

对应现有 /mcp/submit 表单字段，新增：
- **Logo 上传**：建议尺寸 256x256，最大 2MB，存储至 OSS（`logoUrl` 字段）
- **封面图片上传**：建议尺寸 1200x630，最大 5MB，存储至 OSS（`coverUrl` 字段）
- 其他字段：描述、分类、可见范围（公开/私有/团队）、价格类型（免费/付费 + 计费模式与单价）

提交后进入审核中。Logo 和 Cover 通过 `mcpServers` / `a2aAgents` 表的 `logoUrl` 和 `coverUrl` 字段持久化。

### 5.3 退出与会话

- 未通过测试时保存按钮禁用，只能离开（离开时弹确认：「还未通过连接测试，确定离开？」）。
- 表单本地暂存，刷新/离开后回来不丢已填数据；不落库草稿（保证列表内资产均为已验证）。

---

## 6. 页面二'：接入新 Skill（内容接入向导）

Skills 的接入逻辑与 MCP/A2A 本质不同：MCP/A2A 是端点注册，Skills 是内容接入（GitHub 仓库或 ZIP 包）。因此 Skills 独立设计接入向导。

### 6.1 第 1 步：来源选择

两种来源模式（Tab 切换）：

**路径 A：GitHub 仓库 URL**

- 输入 GitHub 仓库地址（如 https://github.com/owner/repo）。
- 由于 openmcp 无法直接访问 GitHub，处理逻辑（全程不跳转，通过 internal API 交互）：
  - 查询 openmcp 本地 repos 表，看 github-nextjs 是否已同步该仓库：
    - 已同步：直接读取已同步的 README / skill.yaml / 源码内容，进入第 2 步。
    - 未同步：openmcp 调用 github-nextjs 的 internal API 触发按需抓取该仓库（见 §9.8），展示「正在抓取 GitHub 数据...」进度状态。
  - openmcp 轮询等待 webhook 同步完成（github-nextjs 抓取后通过 webhook 同步到 openmcp，见 §9）：
    - 轮询间隔 5 秒，超时 5 分钟。
    - 同步完成后自动进入第 2 步。
    - 超时未完成：提示「GitHub 数据抓取超时，请稍后重试」+ 重试按钮。
  - Provider 全程留在 openmcp，不跳转到 github-nextjs。

**路径 B：ZIP 包上传**

- 拖拽或点击上传 ZIP 文件（最大 50MB，仅 .zip 格式）。
- openmcp 直接接收并解压到临时隔离目录。
- 解压后扫描全部文件（见 §8 安全扫描）。

### 6.2 第 2 步：自动解析 + 安全扫描

**6.2.1 自动解析 skill.yaml**

- 解压/同步后，查找 skill.yaml（或 SKILL.md）配置文件，解析元信息：
  - name / description / version / category / license / tools
- 若找不到 skill.yaml：提示 Provider 手动填写元信息，但不阻塞扫描。

**6.2.2 安全扫描（两阶段，必须完成才能保存）**

扫描范围：**全部文件**（README + 入口脚本 .sh/.ps1/.py + 配置文件 skill.yaml/package.json + 全部源码文件）。详见 §8。

扫描进度展示：
- 阶段 1 规则扫描：进度条 + 「正在扫描 N 个文件...」
- 阶段 2 LLM 复核（仅 caution/unsafe 触发）：「正在语义分析...」
- 扫描完成后展示结果卡片：

| 评级 | 含义 | 后续动作 |
|---|---|---|
| safe（绿色） | 无风险模式 | 可保存，可提交上架 |
| caution（黄色） | 有潜在风险但非恶意 | 可保存，可提交上架（列表带提示徽标） |
| unsafe（橙色） | 高风险模式 | 可保存但阻塞上架，进人工复核队列 |
| reject（红色） | 确认恶意 | 不可保存（或保存为驳回状态），附原因 |

扫描结果卡片展开后显示：
- 命中的 flag 列表（每个 flag 附人类可读描述 + 严重级别）
- LLM 分析摘要（risk_summary + recommendation）
- 命中的文件路径 + 行号 + 代码片段（脱敏）

**6.2.3 保存与门控**

- safe / caution：保存按钮可用，保存后进入资产列表。
- unsafe：保存为「待人工复核」状态，阻塞上架，通知 admin。
- reject：保存为「已驳回」状态，附原因回显，Provider 可查看但不可上架。

### 6.3 第 3 步：上架信息（仅 safe/caution 可进入）

对应现有 /skills/submit 表单字段精简版：名称展示、描述、分类（由 AI enrichment 异步填写，见 §9）、可见范围、价格类型、备注。提交后进入审核中。

### 6.4 退出与会话

- 扫描未完成时保存按钮禁用。
- 表单本地暂存，刷新/离开后回来不丢已填数据。
- GitHub 路径若数据未就绪，可暂存当前选择，待 webhook 同步完成后通过通知引导继续。

---

## 7. 页面三：资产详情与调用观测

MCP / A2A / Skills 各有独立的观测页面（从「我的资产」子入口进入），参考 LiteLLM Agent 详情 + Logs 标签：

### 7.1 概览

- **MCP / A2A**：Agent Card / 工具列表、鉴权、协议、最近测试结果、启停开关。
- **Skills**：skill.yaml 元信息、README 渲染、来源（GitHub URL / ZIP）、安全扫描结果卡片（评级 + flags + LLM 分析 + 重扫按钮）、启停开关。

### 7.2 调用观测（MCP / A2A）

- 每分钟调用量、成功率、P50/P95 延迟、错误分布；
- 最近调用日志（时间、调用方标识、请求/响应摘录、trace 关联）；
- 费用归属（区分免费/付费资产的分成预览）。

### 7.3 安全扫描详情（Skills）

- 当前评级 + 信任层级（Tier 1-5）。
- 命中 flag 列表：每个 flag 的名称、描述、严重级别、命中文件路径 + 行号 + 代码片段。
- LLM 分析详情：risk_summary、confidence、findings[]、recommendation。
- 扫描历史：历次扫描的时间、规则版本、评级变化。
- 「重新扫描」按钮：手动触发重扫（用于 Provider 修复后或规则升级后）。

### 7.4 授权

- 公开可调 / 仅我 / 指定用户或密钥组（把现有「可见范围」升级为可按调用方授权——参考 LiteLLM key/team 访问控制）。

---

## 8. 安全扫描架构

参考 agent-skills-hub 的 security_scanner.py + llm_security_analyzer.py，在 openmcp 侧用 TypeScript 重新实现。

三类接入的扫描对象完全不同，**能力边界也不同**：

| 接入方式 | 扫描对象 | 能拿到什么 | 拿不到什么 |
| --- | --- | --- | --- |
| Skill | README + 全部文件 | 源码全文 | 无 |
| MCP Server | 端点 URL、传输方式、工具名与描述、协议版本 | 提供方**声明**的元数据 | 远端进程里的任何行为 |
| A2A Agent | endpoint、Agent Card 里的 skills 列表 | 提供方**声明**的元数据 | 远端智能体的任何行为 |

MCP / A2A 是端点接入，平台**读不到对方的代码，也观察不到对方的运行时行为**。
网关只负责转发请求。因此端点接入的扫描是一份「声明元数据的风险提示」，不是代码审计：

- 扫描的是提供方自己填的端点、传输方式、工具名与描述。
- 命中的规则说明的是「这段声明看起来有问题」，而不是「对方代码有这个问题」。
- 页面必须如实标注扫描口径，不能让买家以为平台验证过对方的实现。
- 未扫描（规则升级前的历史资产、扫描失败的资产）一律显示「未扫描 / unknown」，**不得**用「安全」兜底。

规则命中后的处置：`credential_in_url`、`secret_in_query`、`private_key_reference` 直接 `reject`；
`prompt_injection`、`credential_exfiltration`、`shell_execution` 为 `unsafe`；
`plaintext_endpoint`、`stdin_transport`、以及**冒名官方厂商**为 `caution`。

关于冒名检测的一条现实约束：没有公共后缀列表就无法可靠判断「注册域」边界，
厂商自己的合法子域很容易被误判——`api.githubcopilot.com` 就是 GitHub 官方的
Copilot API 端点。所以冒名规则的严重度刻意定在 `caution` 而不是 `unsafe`：
宁可提示「请自行确认」，也不要把真的官方端点标成不安全。安全徽章一旦误报就没人信了。

规则改动后，已有资产上的 `scan_rules_version` 停在旧版本，页面显示的评级其实是**旧规则的结论**。
因此 MCP / A2A 的 admin 后台提供「重扫」，且需要升级规则版本时应对历史资产触发回填。

### 8.1 两阶段架构（Skill 内容扫描）

```
Skill 内容（README + 全部文件）
   |
   v
阶段 1：规则扫描（零成本，正则匹配）
   |-- REJECT 模式 -> reject（自动驳回）
   |-- HIGH 风险模式 -> 按信任层级加权 -> unsafe/caution
   |-- MEDIUM 风险模式 -> 按信任层级加权 -> caution/safe
   |-- 无命中 -> safe
   |
   v
阶段 2：LLM 语义复核（仅对 caution/unsafe 触发，成本可控）
   |-- LLM 判定 safe -> 升级为 safe
   |-- LLM 判定 caution -> 保持 caution
   |-- LLM 判定 unsafe -> 保持 unsafe
   |-- LLM 失败 -> 保持规则扫描结果（降级为 caution + 人工复核建议）
   |
   v
最终评级写入 skills 表
```

### 8.2 规则扫描（阶段 1）— SlowMist 11 类高风险 + 信任层级

**8.2.1 高风险模式（HIGH_RISK_PATTERNS）— 任一命中（代码块外）即 unsafe/reject**

| 类别 | flag 示例 | 说明 |
|---|---|---|
| 1. 数据外泄 | data_exfiltration | curl -d $(...) 把本地数据 POST 出去 |
| 2. 凭证采集 | credential_harvest / env_file_read | env | grep -i key / cat .env |
| 3. 敏感文件访问 | sensitive_dir_access / etc_sensitive_read | 读 ~/.ssh、/etc/shadow |
| 4. Agent 身份/记忆窃取 | agent_config_theft / agent_memory_theft | 读 ~/.claude/settings.json 并外发 |
| 5. 动态代码执行 | exec_import / base64_exec | exec(__import__(...)) |
| 6. 提权 | chmod_dangerous / privilege_escalation | chmod 777 / 改 sudoers |
| 7. 持久化 | service_persistence | launchctl load / systemctl --user enable |
| 8. 反弹 shell | reverse_shell / dev_tcp | nc -l -p / /dev/tcp/ |
| 9. 破坏性操作 | rm_rf_root | rm -rf / |
| 10. 混淆 | obfuscated_exec / hex_encoded_payload | base64+exec 混淆 |
| 11. 供应链 | runtime_install_exec | pip install X && python X |
| 12. 提示注入（covert） | prompt_injection_covert | "secretly send ..." |

**8.2.2 中风险模式（MEDIUM_RISK_PATTERNS）— 2+ 命中即 caution**

- sudo_usage / docker_privileged / ssl_disabled / eval_usage / subprocess_spawn / tunnel_service
- Agent 时代中风险：jailbreak_mode / tool_priority_manipulation / credential_in_chat / shortener_download / paste_host_download
- leaked_secret：真实密钥泄露检测（AKIA... / ghp_... / sk-ant-... 等，过滤文档占位符）

**8.2.3 REJECT 模式（自动驳回）**

- exfil_secrets_combo：cat .env | curl 组合外泄
- backdoor_install：bashrc + curl 后门安装

**8.2.4 下载并执行（PIPE_TO_SHELL）— 按可信安装源白名单判断**

- curl|sh / wget|sh / PowerShell irm|iex 模式
- 可信安装源白名单：astral.sh / sh.rustup.rs / claude.ai / cursor.com / 项目自己的 GitHub owner / 项目自己的 homepage 域名
- 不可信来源：bit.ly 等短链 / transfer.sh 等匿名 paste / 非 owner 的 GitHub raw

**8.2.5 5 级信任层级加权**

| Tier | 条件 | 效果 |
|---|---|---|
| Tier 1 | 官方组织（anthropics/openai/google/microsoft/github 等） | HIGH 风险最多 caution |
| Tier 2 | 已知安全团队（slowmist/trailofbits/openzeppelin 等） | HIGH 风险最多 caution |
| Tier 3 | stars >= 1000 + license | HIGH 风险最多 caution |
| Tier 4 | stars >= 100 + license | 单个 HIGH 风险为 caution，多个为 unsafe |
| Tier 5 | 未知来源 | HIGH 风险为 unsafe，多个 MEDIUM 为 caution |

**8.2.6 上下文感知（避免误报）**

- 代码块（``` ... ```）内的模式跳过（除非是 destination 类 flag）。
- 引用 / "such as" 引例跳过（_is_cited_or_negated）。
- 否定句跳过（"Never paste your API key" 是建议，不是风险）。
- 真实密钥过滤文档占位符（_looks_like_real_secret：排除 sk-xxxx / AKIAEXAMPLE 等低熵模板）。

### 8.3 LLM 语义复核（阶段 2）

仅对规则扫描判为 caution / unsafe 的 Skill 触发：

- 系统 prompt 明确要求区分合法工具用法（npm/pip 安装脚本、API key 配置说明）和真实威胁。
- 返回结构化 JSON：grade（safe/caution/unsafe）/ confidence / risk_summary / findings[] / recommendation。
- 失败时降级为 caution + "Manual review recommended"，不阻塞流程。
- 限速 1 req/sec，3 次重试 + 指数退避。
- 支持 OpenAI 兼容接口（MiniMax / OpenAI / Anthropic）。

### 8.4 扫描范围（全部文件）

与 agent-skills-hub 只扫 README 不同，openmcp 的 Skills 接入需要扫描全部文件：

| 文件类型 | 扫描内容 | 说明 |
|---|---|---|
| README.md / SKILL.md | 全文 | 与 agent-skills-hub 一致 |
| skill.yaml / package.json | 配置内容 | 校验不引用外部恶意 URL、不声明 exec 类危险权限 |
| .sh / .ps1 / .py 入口脚本 | 全文 | 重点扫描，这些是实际执行的代码 |
| package.json scripts / postinstall | scripts 字段 | npm install 后自动执行的钩子 |
| 其他源码文件 | 全文 | 最严策略，覆盖所有 .ts/.js/.py/.go 等 |

### 8.5 数据模型扩展

skills 表新增字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| security_grade | string | safe / caution / unsafe / reject / unknown |
| security_flags | json | 命中 flag 名称数组 |
| security_llm_grade | string? | LLM 复核结果 |
| security_llm_analysis | json? | LLM 详细分析 JSON |
| trust_tier | int | 1-5 |
| scanned_at | datetime | 最后扫描时间 |
| scan_rules_version | string | 使用的规则集版本 |

### 8.6 规则集维护

- 规则集版本化（全局版本，单一 scan_rules_version 标识整个规则集版本），扫描结果记录 scan_rules_version，便于回溯。
- 规则集初始版本：全量移植 agent-skills-hub 的全部规则（HIGH_RISK_PATTERNS / MEDIUM_RISK_PATTERNS / REJECT_PATTERNS / PIPE_TO_SHELL_PATTERNS / AGENT_MEDIUM_PATTERNS / SECRET_PATTERNS 全部类别），用 TypeScript 重新实现。
- 平台维护规则更新日志，每次窄化规则要有正例 + 反例测试（参考 agent-skills-hub 的 test_security_scanner_agent_rules.py 写法）。
- 提供手动重扫入口（Provider 修复后触发，admin 也能批量重扫）。
- 定期重扫：规则集升级后对全部已上架 Skill 自动重扫。

### 8.7 ZIP bomb 防护（配置约束）

ZIP 解压通过配置约束防止 zip bomb 攻击，所有阈值可通过环境变量 / 配置文件调整：

| 配置项 | 默认值 | 说明 |
|---|---|---|
| SCAN_ZIP_MAX_SIZE | 50MB | ZIP 文件最大上传大小 |
| SCAN_ZIP_MAX_EXTRACTED_SIZE | 500MB | 解压后总大小上限 |
| SCAN_ZIP_MAX_FILE_COUNT | 10000 | 解压后文件数量上限 |
| SCAN_ZIP_MAX_NEST_DEPTH | 10 | 嵌套压缩包最大深度（zip 内 zip） |
| SCAN_ZIP_MAX_SINGLE_FILE | 50MB | 单个解压文件大小上限 |
| SCAN_FILE_MAX_SIZE | 5MB | 单个文件扫描内容上限（超出截断） |

解压流程：
1. 校验 ZIP 文件大小 <= SCAN_ZIP_MAX_SIZE。
2. 流式解压，实时累计解压后大小，超过 SCAN_ZIP_MAX_EXTRACTED_SIZE 立即中止。
3. 实时计数文件数，超过 SCAN_ZIP_MAX_FILE_COUNT 立即中止。
4. 检测嵌套压缩包，深度超过 SCAN_ZIP_MAX_NEST_DEPTH 拒绝解压内层。
5. 单个文件超过 SCAN_ZIP_MAX_SINGLE_FILE 跳过并记录警告。
6. 解压完成后的文件扫描，单个文件读取内容超过 SCAN_FILE_MAX_SIZE 截断。
7. 解压在临时隔离目录，扫描完成后清理。

### 8.8 LLM 复核模型

- 使用 DeepSeek V4 模型（国内可访问，OpenAI 兼容接口）。
- base_url: DeepSeek API 端点。
- 调用方式与 agent-skills-hub 的 llm_security_analyzer.py 一致（OpenAI 兼容 SDK）。
- 限速 1 req/sec，3 次重试 + 指数退避。
- 失败时降级为 caution + "Manual review recommended"。

---

## 9. github-nextjs 集成（Webhook 同步）

参考 design-github-repos-skills-webhook-sync.md，github-nextjs 负责所有 GitHub 数据抓取，通过 webhook 同步到 openmcp。

### 9.1 数据流

两条数据路径（均通过 internal API + webhook 交互，不跳转）：

**路径 1：管理员发现（已有流程）**
```
[github-nextjs 管理员] 在 github-nextjs web 页面发现/收藏 git 仓库
    |
    v
github-nextjs: 每天定时自动抓取已收藏仓库数据
    |
    v
updateGitHubDataTask: 抓取 GitHub 数据 -> 更新 repos -> 写 snapshots -> 发送 Repos Webhook
    |
    v
openmcp POST /api/webhook/daily -> 写 authors / repos / repo_snapshots
    |
    v
openmcp 管理员决定是否上架
```

**路径 2：Provider 按需触发（新增）**
```
[Provider] 在 openmcp Skill 接入向导输入 GitHub URL
    |
    v
openmcp 查询本地 repos 表 -> 未找到 -> 调用 github-nextjs internal API 触发按需抓取
    |
    v
github-nextjs: 抓取 GitHub 数据 -> 发送 Repos Webhook + Skills Webhook
    |
    v
openmcp 轮询检测数据已就绪 -> 触发安全扫描 + AI enrichment
```

### 9.2 Repos Webhook（仓库信息同步）

- URL: POST /api/webhook/daily
- 沿用 github-nextjs 现有 RepoWebhookRequest 格式。
- openmcp 处理：校验 -> 写 authors（以 owner 为唯一标识）-> 写 repos（upsert）-> 写 repo_snapshots（按天一条，重复则更新统计字段）。
- repos.type 字段：MCP / A2A 仓库信息也通过此 webhook 同步，用于展示（仓库 stars / license / README 等），不用于端点接入。

### 9.3 Skills Webhook（Skill 内容同步）

- URL: POST /api/webhook/daily/skills
- 沿用 github-nextjs 现有 SkillWebhookPayload 格式。
- openmcp 处理：
  1. 校验 event_type === "skill_updated"，必填字段校验。
  2. 写 authors（以 repo_owner 为唯一标识）。
  3. 写 skills 表（upsert，按 referenceId = repo_full_name + "#" + skill_dir）：
     - status: 由安全扫描结果决定（不再无条件 published）。
     - certified: false（未验证）。
     - priceType: free（默认）。
  4. **入库后触发安全扫描**（fire-and-forget，不阻塞 webhook 响应）：
     - 阶段 1 规则扫描 -> 阶段 2 LLM 复核（若需要）。
     - 根据扫描结果更新 security_grade / security_flags / security_llm_* 字段。
     - 根据扫描结果决定 status：
       - safe / caution -> 按 SKILLS_PUBLISH_POLICY 自动 published（certified=false）；unsafe→pending_review；reject→rejected
       - caution -> status: published（列表可见，带风险提示徽标）
       - unsafe -> status: pending_review（阻塞上架，通知 admin）
       - reject -> status: rejected（附原因回显）
  5. **触发 AI 分类 enrichment**（与安全扫描并行，不阻塞）：
     - 读取全部分类列表 -> AI 判断唯一分类 -> 更新 categoryId。
     - 写入 metadata.scenario / metadata.features。
  6. webhook 响应 200（扫描和 enrichment 异步进行）。

### 9.4 MCP / A2A 仓库信息的展示用途

github-nextjs 同步的 MCP / A2A 类型仓库信息（repos 表）仅用于展示：
- 在市场列表页展示仓库 stars / license / README 摘要。
- 在资产详情页关联展示仓库信息。
- **不用于端点接入**：MCP / A2A 的端点接入仍走 §5 的端点注册流程（Provider 手动填端点 URL + 测试连接）。

### 9.5 ZIP 上传路径（不经过 github-nextjs）

ZIP 上传完全在 openmcp 侧处理，不依赖 github-nextjs：
- openmcp 接收 ZIP -> 解压到临时隔离目录 -> 解析 skill.yaml -> 安全扫描 -> 入库。
- ZIP 路径的 skills 不关联 repos 表（无 GitHub 仓库信息），来源标记为「ZIP 上传」。

### 9.6 配置与安全

- github-nextjs 侧：DAILY_WEBHOOK_URL / SKILLS_WEBHOOK_URL（可多个，逗号分隔）、DAILY_WEBHOOK_TOKEN / SKILLS_WEBHOOK_TOKEN（可选）。
- openmcp 侧：若使用 Token 校验，配置与发送端一致的 secret，校验 x-webhook-signature 头。

### 9.7 数据库变更

- repo_snapshots：增加 week 字段（integer，notNull）+ 唯一约束 (repo_id, year, month, day)。
- skills 表：增加 §8.5 所列安全扫描字段。
- repos 表：type 字段支持 mcp / a2a / skill / tools / apps。

### 9.8 internal API 调用协议（openmcp 调用 github-nextjs）

github-nextjs 和 openmcp 各自作为独立应用，只通过 internal API 进行交互，**不进行直接跳转**。github-nextjs 已有 internal API 可供 openmcp 调用。

**两条数据路径**：

**路径 1：管理员发现（已有流程，不变）**

- github-nextjs 的 web 页面供管理员发现/收藏 git 仓库。
- github-nextjs 每天自动同步已收藏仓库数据到 openmcp（通过 webhook）。
- openmcp 管理员决定是否上架。

**路径 2：Provider 按需触发（新增）**

当 Provider 在 openmcp 的 Skill 接入向导中输入了一个尚未同步的 GitHub URL 时：

```
Provider 在 openmcp 输入 GitHub URL
    |
    v
openmcp 查询本地 repos 表 -> 未找到
    |
    v
openmcp 调用 github-nextjs internal API（触发按需抓取该仓库）
    |
    v
openmcp 展示「正在抓取 GitHub 数据...」进度，轮询等待
    |
    v
github-nextjs 抓取完成 -> 通过 webhook 同步到 openmcp
    |
    v
openmcp 轮询检测到数据已就绪 -> 自动进入安全扫描流程
```

**internal API 接口约定**：

| 项 | 说明 |
|---|---|
| 请求方 | openmcp |
| 响应方 | github-nextjs |
| 触发方式 | openmcp 主动调用 github-nextjs internal API |
| 认证 | internal API token（双向配置一致的 secret） |
| 同步回写 | github-nextjs 抓取完成后通过现有 webhook（/api/webhook/daily、/api/webhook/daily/skills）同步到 openmcp |

openmcp 侧需支持：

1. 检测到 GitHub URL 未同步时，调用 github-nextjs internal API 触发抓取（不跳转、不开新窗口）。
2. 轮询本地 repos / skills 表检测数据是否已就绪（轮询间隔 5 秒，超时 5 分钟）。
3. 就绪则自动继续接入流程；超时则提示重试。

**配置项**：

| 配置项 | 说明 |
|---|---|
| CONSOLE_API_BASE_URL | console 站点地址 |
| CONSOLE_API_KEY | console 签发的 API Key，需带 `projects:write` |

`POST /api/internal/repos` 与共享密钥 `CONSOLE_API_TOKEN` 已删除，登记与发布改为
`POST /api/v1/repos`（`repos:write`）与 `POST /api/v1/projects`（`projects:write`）。

---

## 10. 权限与安全

- 提供者仅能管理/查看自己的资产；管理员可审计所有资产（复用现有 admin 审核）。
- 调用鉴权与市场展示解耦：接入保证网关可调用；上架+授权决定谁能调。
- 密钥永不落库明文；测试日志脱敏。
- **安全扫描隔离**：ZIP 解压在临时隔离目录，扫描完成后清理；扫描过程不执行任何 Skill 代码。
- **通知机制**：状态变化（端点异常、扫描完成、审核结果、调用配额超限）通过邮件 / 站内信 / Webhook 主动通知 Provider，不只靠列表页颜色。

---

## 11. 交互细节定义

| 控件 | 状态 | 文案/样式 |
|---|---|---|
| 自动发现（MCP/A2A） | loading | 按钮 loading +「正在拉取 Agent Card / 服务能力...」 |
| 自动发现 | success | 绿色「自动发现成功，已预填 N 个字段」 |
| 自动发现 | fail | 黄色「自动发现失败，请手动填写」+ 不阻塞 |
| 测试连接 | loading | 按钮 loading +「正在探测端点...」 |
| 测试连接 | success | 绿色副文案「连接成功：可用工具 N 个」（MCP）/「Agent Card 读取成功」（A2A） |
| 测试连接 | fail | 红色副文案 + 失败步骤标注 + 常见排查链接；保存按钮保持禁用 |
| 标识名输入 | taken | 红字「该名称已被使用，请更换」（异步校验） |
| 启停切换 | 停用中 | 卡片灰色，副文案「客户端调用将返回 403」 |
| 保存连接 | blocked | 未通过测试时禁用，提示「请先通过连接测试」 |
| 提交审核 | blocked | 连接未通过测试或上架信息缺失时主按钮禁用 |
| 安全扫描（Skills） | scanning | 进度条 +「正在扫描 N 个文件...」/「正在语义分析...」 |
| 安全扫描 | safe | 绿色「扫描通过」|
| 安全扫描 | caution | 黄色「扫描通过（有风险提示）」+ flag 列表可展开 |
| 安全扫描 | unsafe | 橙色「扫描未通过，已进入人工复核」+ flag 详情 |
| 安全扫描 | reject | 红色「扫描驳回」+ 原因回显 |
| 重扫 | loading | 按钮 loading +「正在重新扫描...」 |
| GitHub 数据未就绪 | fetching | 「正在抓取 GitHub 数据...」+ 进度指示（轮询中） |
| GitHub 数据未就绪 | timeout | 「GitHub 数据抓取超时，请稍后重试」+ 重试按钮 |

---

## 12. 与现有系统的关系（演进路径）

### 12.1 不改

- 入驻/KYC 拆分、市场列表页、交易结算。

### 12.2 重构

- /mcp/submit、/a2a/submit 合并为「接入新资产」向导第 1 步动态表单；原「我的关系」更名「我的资产」，下分 MCP / A2A / Skills 三个子入口（各带独立列表与观测页），资产生命周期由这三个页面接管。
- /skills/submit 重构为「接入新 Skill」向导（§6），保留 GitHub URL / ZIP 两种来源模式，但增加平台侧安全扫描（替换当前「跳转 GitHub 提 PR」的空壳）。
- Skills Webhook 入库逻辑：从「同步后直接 published」改为「同步后触发安全扫描，按扫描结果决定 status」。

### 12.3 新增

- 连接测试服务（必过才能保存，分级反馈）。
- 自动发现服务（拉 .well-known/agent.json / mcp.json 预填表单）。
- 沙箱试调面板（Postman 式工具调用）。
- 健康检查任务（固定 10 分钟，连续 3 次失败才下架，见 §8）。
- 调用日志/指标表、授权关系表（资产 <-> 用户/密钥组）。
- **安全扫描服务**（两阶段：规则扫描 + LLM 复核，TypeScript 实现）。
- **ZIP 接收与解压服务**（隔离目录，扫描后清理）。
- **通知服务**（邮件 / 站内信 / Webhook）。
- 每类资产独立观测页（Skills 观测页含安全扫描详情）。

### 12.4 语义映射

- 现有 register（mcp/a2a）-> 拆为 connect（测试通过后落地连接配置）+ publish（提交审核）。
- entityType / 鉴权沿用现有字段并新增 protocolVersion、transport、authConfig、status 细化值（无草稿状态）。
- skills 表新增 security_grade / security_flags / security_llm_grade / security_llm_analysis / trust_tier / scanned_at / scan_rules_version 字段。
- repos 表 type 字段支持 mcp / a2a / skill / tools / apps。
- repo_snapshots 表新增 week 字段 + (repo_id, year, month, day) 唯一约束。

---

## 13. 验收标准

1. **MCP/A2A 接入**：提供者可用四步（选择类型 -> 填端点 URL -> 自动发现/补全 -> 测试连接）接入一个 MCP/A2A 资产；测试失败无法保存，测试成功立即入库。测试连接提供分级反馈（握手/鉴权/tools/list/协议版本）。
2. **自动发现**：A2A 输入根 URL 后可一键拉取 Agent Card 预填表单；MCP 可拉取服务端能力预填。
3. **Skills 接入（GitHub 路径）**：Provider 输入 GitHub URL，若已同步则直接进入扫描，若未同步则 openmcp 调用 github-nextjs internal API 触发按需抓取，轮询等待 webhook 同步完成后自动继续，全程不跳转。
4. **Skills 接入（ZIP 路径）**：Provider 上传 ZIP，openmcp 解压并扫描全部文件，扫描完成后按评级门控上架。
5. **安全扫描**：两阶段扫描（规则 + LLM），4 级评级（safe/caution/unsafe/reject），reject 自动驳回，unsafe 阻塞上架进人工复核，caution 带提示上架，safe 正常上架。
6. **扫描详情**：详情页展示评级、信任层级、命中 flag 列表（含文件路径+行号+代码片段）、LLM 分析、扫描历史、重扫按钮。
7. **资产列表**：三个子入口（MCP / A2A / Skills）展示 §4.2 全部分支状态，可编辑、启停、删除，各自有独立观测页。Skills 列表显示安全评级徽标。
8. **上架流程**：与现有审核打通；驳回原因回显。Skills 仅 safe/caution 可提交上架。
9. **Webhook 同步**：github-nextjs 通过 /api/webhook/daily 和 /api/webhook/daily/skills 同步数据，openmcp 入库后触发安全扫描 + AI enrichment，不阻塞 webhook 响应。
10. **通知**：状态变化通过邮件/站内信/Webhook 主动通知 Provider。
11. **不回归**：已上架资产的 /{locale}/mcp、/{locale}/a2a 市场调用路径不变。

---

## 14. 决策与待确认项

### 14.1 已确认（v0.2 评审）

- 资产列表入口：「我的关系」更名「我的资产」，MCP / A2A / Skills 三个独立菜单入口、分组展示，每类资产独立观测页。
- MCP/A2A 第 1 步必须测试成功才能保存（无草稿/跳过）。
- A2A 协议版本强制选择 0.3 / 1.0。
- MCP v0.1 不支持 stdio，只支持 Streamable HTTP / SSE。
- OAuth2 v0.1 只支持 Client Credentials，不支持交互式。
- 自动发现作为首选路径（A2A 拉 Agent Card，MCP 拉服务端能力）。
- 测试连接分级反馈（握手/鉴权/tools/list/协议版本）。
- 网关标识名采用 {providerSlug}/{assetName} 二级命名。
- 健康检查默认 10 分钟，连续 3 次失败才置 `error`。
- Skills 从「资产壳」拆出独立接入流程（GitHub URL / ZIP 上传）。
- 安全扫描在 openmcp 侧执行（两阶段：规则扫描 + LLM 复核），替换现有 AI-only enrichment。
- 安全扫描范围：全部文件（README + 入口脚本 + 配置文件 + 全部源码）。
- 上架由扫描结果门控：reject 自动驳回，unsafe 阻塞上架进人工复核，caution 带提示上架，safe 正常上架。
- github-nextjs 同步所有类型仓库（skill/mcp/a2a/tools/apps），MCP/A2A 仓库信息仅做展示，不用于端点接入。
- ZIP 上传由 openmcp 直接接收并扫描，不经过 github-nextjs。
- 沙箱试调确认做（测试连接通过后的可选步骤）。
- LLM 复核使用 DeepSeek V4 模型（国内可访问，OpenAI 兼容接口）。
- 安全扫描规则集初始版本：全量移植 agent-skills-hub 的全部规则（HIGH/MEDIUM/REJECT/PIPE_TO_SHELL/AGENT_MEDIUM/SECRET 全部类别）。
- ZIP bomb 防护：通过配置约束（最大解压大小、最大文件数量、最大嵌套深度，均可配置，见 §8.7）。
- 规则集版本管理粒度：全局版本（单一 scan_rules_version 标识整个规则集版本）。
- github-nextjs 和 openmcp 各自作为独立应用，只通过 internal API 交互，不进行直接跳转。github-nextjs 已有 internal API 可供 openmcp 调用触发按需抓取，抓取后通过现有 webhook 同步到 openmcp，openmcp 轮询等待数据就绪（见 §9.8）。
- 人工复核队列的 admin 审核界面设计：单独文档，见 `ADMIN_REVIEW_QUEUE_UED.md`。

### 14.1.1 certified 统一语义（2026-09-20 补齐）

- `certified=true`：仅 Admin 人工审核 **pass**（或未来官方认证）。
- 扫描自动上架（safe/caution）保持 `certified=false`，可展示 `securityGrade` 徽标。

### 14.2 仍待确认

- [ ] 调用日志记录范围（全量 vs 采样，成本考量）。

---

以上交互以扫描门控为准（见 SKILLS_PUBLISH_POLICY.md）。代码已具备扫描 / webhook / ZIP / admin 复核主干；后续重点是：可配置自动上架档位、用户侧付费闭环、以及 UED 中仍待确认项（§14.2）。

---

## 15. 实现更新日志

### 2026-10-02: MCP/A2A 元数据扫描、版本管理、分页与角色拆分

**1. MCP / A2A 元数据安全扫描（已实现）**

- `apps/web/src/lib/security-scan/gateway-scan.ts`：对端点 / 传输 / 工具名与描述 / 协议版本做规则扫描。
- `packages/db/drizzle/0017_gateway_security_scan.sql`：`security_grade`、`security_flags`、`scan_details`、`scanned_at`、`scan_rules_version`。
- MCP 与 A2A **注册成功后立即扫描**；扫描失败不阻塞注册（注册成功、评级显示「未扫描」）。
- admin 后台新增 `rescanServer` / `rescanAgent` 重跑入口，用于规则升级后刷新历史资产的评级。
- 未扫描资产一律显示「未扫描 / unknown」，不再用 `|| t('safeDefault')`兜底成「安全」。
- 能力边界见 §8：端点接入扫的是提供方**声明的元数据**，不是对方代码，也不是运行时行为。

**2. MCP / A2A 版本管理（已实现）**

- `packages/db/drizzle/0018_gateway_asset_versions.sql`：新增 `gateway_asset_versions`，
  以及 `mcp_servers.current_version_id` / `current_version`（A2A 同）。
- 版本记录的是**发布行为的元数据契约快照**（端点 / 传输 / 工具 / 价格），不是代码备份——
  平台拿不到远程进程里的代码，能承诺的只有这些字段。
- 支持草稿 → 发布 → 下线（yank）/ 设为当前版本。回滚只改 `current_version_id` 指针。
- yank **不删行**：已购用户的授权和账本可能指向那一版，物理删除会让那些记录指向不存在的版本。
- Provider 自助能力，不进 admin：审核管的是「能不能上架」，发第几版是资产所有者自己的事。

**3. 分页与搜索（已实现）**

- 复核队列 / 驳回 / 审核历史：移除 `slice(0, 200)` 静默截断，改为 SQL 分页 + `total`。
- MCP / A2A / Skills `listMine`：服务端搜索 + 状态筛选 + 分页。
- 收益 / 账单 / 提现 / API Key：移除固定 `limit`，改为分页并返回 `total`。
  汇总口径保持「全部行」而非当前页，否则「累计收入」会随翻页变化。
- Blog 作者 / 分类：服务端搜索 + 分页。

**4. 平台角色拆分（已实现）**

- 新增 `PlatformRole = 'user' | 'admin' | 'super_admin'`，以及 `isSuperAdmin()` / `superAdminProcedure`。
- `adminProcedure` 允许 `admin` 与 `super_admin`；`super_admin` 专属操作用 `superAdminProcedure`
  （如恢复被驳回资产 `restore`）。
- 授予 / 撤销最高角色仅限 `super_admin`，且不能通过该接口改掉**另一个** `super_admin`。

### 2026-09-22: MCP/A2A 提交 UX 重写

**前端实现完成：**
1. ✅ `submit-mcp-form.tsx` 重写：
   - Step1：URL + 认证 → 一键发现+测试 → 确认卡片 → 确认接入网关
   - 认证选项：无需认证 | API Key | Bearer | Basic | Client Credentials (OAuth2)
   - 灰色显示「用户授权登录（即将支持）」
   - 高级选项（Accordion）：静态 Headers key-value
   - Step2：新增 logo 和 cover 图片上传
   - 中文 UI，独立组件

2. ✅ `submit-a2a-form.tsx` 重写：
   - 与 MCP 类似，协议版本为 0.3 / 1.0
   - Agent Card URL 替代端点 URL
   - 其他逻辑一致

3. ✅ 数据库 schema 更新：
   - `mcpServers` 表新增 `coverUrl: text('cover_url')`
   - `a2aAgents` 表新增 `coverUrl: text('cover_url')`

4. ✅ 图片上传：
   - 复用 `uploadFileFromBrowser` 函数
   - Logo 文件夹：`openmcp/mcp/logos` / `openmcp/a2a/logos`
   - Cover 文件夹：`openmcp/mcp/covers` / `openmcp/a2a/covers`
   - 支持预览、移除、重新上传
   - 最大 5MB

**待后端支持（TODO）：**
- [ ] `mcpServers.connect` mutation 接受 `logoUrl` / `coverUrl` 参数
- [ ] `a2aAgents.connect` mutation 接受 `logoUrl` / `coverUrl` 参数
- [ ] Gateway access layer 写入数据库
- [ ] 数据库迁移（添加 `coverUrl` 列）

**文档更新：**
- ✅ `PROVIDER_GATEWAY_REGISTRATION_UED.md` 更新 §5 说明 Step1 重写和 logo/cover 上传

**代码位置：**
- `/workspace/apps/openmcp/src/components/mcp/submit-mcp-form.tsx`
- `/workspace/apps/openmcp/src/components/a2a/submit-a2a-form.tsx`
- `/workspace/apps/openmcp/src/db/schema/registry-schema.ts`

---

## 16. 定时健康检查（已实现）

### 16.1 为什么它不只是「状态」而是「可见性」

`connection_status` 同时被三处消费，所以它错了的代价不是显示错一个标签：

| 位置 | 作用 |
|---|---|
| `assets/visibility.ts` | `connectionStatus !== 'online'` → **从市场列表和 Store MCP 搜索里消失** |
| `mcp-servers/entitlement.ts` | 安装 / 购买前置校验要求 `online` |
| `assets/map-asset.ts` | 我的资产页映射为 `abnormal` / `disabled` |

也就是说一次误判 = 提供方收入立刻中断。因此**单次探测失败绝不改这一列**。

### 16.2 两条硬约束

**只探测 opt-in 的资产。** `health_check_enabled` 默认 `false`，检查只处理 `= true` 且 `status = 'published'`、未软删除的资产。持续轮询别人端点会产生对方没预期的流量；而提供方明确不想被探测时，这个开关就是他的退出通道——没有开关可用就等于强制轮询。开关关着的资产即使真的挂了也保持原状，状态由提供方自己决定何时更新。

**连续失败计数。** 新增 `health_fail_count`（migration `0015`）：成功即清零，连续达到 `HEALTH_CHECK_FAIL_THRESHOLD`（默认 3）才置 `error`。单次超时/限流在 `error` 与 `online` 之间反复跳，会让资产在市场上闪烁，买家看到的是「这个 MCP 时有时无」。

探测函数**自身抛错**（配置非法、密钥解密失败）与「探测到不健康」严格分开：前者只记日志、不累加计数。否则一个配置错误会被当成端点不可用，几轮之后资产被下架，而下架原因永远查不到。

### 16.3 实现

| 位置 | 作用 |
|---|---|
| `lib/health-check/scheduled-check.ts` | 一轮检查的编排、阈值状态机、按资产并发限制 |
| `web/mcp-servers/gateway.ts` / `web/a2a-agents/gateway.ts` 的 `probeSystem(id)` | 只读配置 + 探测，**不**校验作者、**不**写状态 |
| `lib/cron/local-cron.ts` 的 `asset-health-check` | 进程内调度，默认 600s |
| `app/api/cron/asset-health/route.ts` | 外部调度 / 手动补跑入口，与内置任务同一函数 |

写库策略留在编排层，探测函数只负责「读到配置并探一次」。这样调阈值不用动探测实现，也不会出现 MCP 和 A2A 两份阈值。

并发按资产限 5（`HEALTH_CHECK_CONCURRENCY`），不全局串行：一批全挂的端点会让探测自己的超时被挤掉，于是「平台探测不动了」和「这些资产坏了」两种故障长得一模一样，只有后者是真的。

### 16.4 间隔为什么不升级

本文档早期版本写的是「15 分钟，异常时升级到 1 分钟，恢复后回退」。**未实现，当前是固定间隔。** 间隔的下限语义是**故障可见延迟**，而真正的下架边界是连续失败阈值；配合固定间隔，最坏情况就是「阈值次 × 间隔」后才下架，升级与否不影响这个上界。

做升级的收益是缩短**发现**时间，但 9.2 的滞回已经在为误判兜底，两者叠加会让「多久下架」取决于资产是否刚好在故障期——比固定间隔更难向运营解释。当前选择固定间隔 + 可配阈值，把「多久下架」这一个变量交给 `HEALTH_CHECK_FAIL_THRESHOLD`。真要升级，应当作为独立决策补上，并同时说明它与阈值的关系。

### 16.5 `/api/cron/asset-health` 在有资产失败时仍返回 200

探测失败是**被观测对象**的状态，不是接口自身出错。让调度器把「3 个资产挂了」当接口故障去告警重试，只会刷出重试风暴，真正的资产问题反而被埋掉。`success` 只反映接口能否跑完；资产健康度在 `summaries` 里逐条给出（`healthy` / `degraded` / `takenOffline` / `recovered` / `errors`）。
