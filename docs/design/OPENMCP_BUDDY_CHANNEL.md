# OpenMCP Buddy 渠道说明（个人 lovable）

> 日期：2026-09-30 · 策略：**A 配置打通 + B 私仓渠道底仓**

## 仓库

| 项 | 值 |
|----|-----|
| 私仓 | `https://github.com/openroute-ai/openmcp-buddy` |
| 上游 | `different-ai/openwork` tip `6f60fa9` |
| 用途 | OpenWork 渠道底仓（配置 / 品牌 / 日后薄集成）；**不是** Den 托管 |

## 个人 lovable 闭环（不改桌面源码也可验）

1. 在 **OpenMCP 网站**注册并创建 **OpenMCP 平台密钥**（背后为平台网关 Virtual Key）。
2. OpenWork → Provider / 模型：填 **平台网关 baseURL** + 上述密钥（文案称 OpenMCP，勿写 LiteLLM）。
3. 从 OpenMCP 安装 Skill（Store MCP / 下载包）→ 解压到工作区 `.opencode/skills/<slug>/`，保留 `openmcp.*` frontmatter。
4. （可选）远程 MCP：只填平台网关 MCP URL + 同一密钥；勿填 Provider 原始 endpoint。
5. 会话调模型 / Skill / 市场 MCP；超预算时回网站充值。

## 与 OpenMCP 代码分工

| 侧 | P0 |
|----|-----|
| **n8nshow / OpenMCP** | `apps/api` 为桌面 SoT；Store MCP、Device Code、密钥、install；网站 UI only |
| **openmcp-buddy** | 底仓同步上游；入门文档；后续薄插件 / 默认连你们 API（P1） |

## 不做

- 中国区托管 Den；把 OpenMCP 并入 `ee/apps/den-api`
- 对用户露出 LiteLLM 品牌
- 用 OpenWork Gateway 结算 OpenMCP 用量
