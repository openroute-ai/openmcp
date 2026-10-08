# OpenMCP Hub 安装与技能包接入

## 概述

OpenMCP Hub（https://www.openmcp.cn）是面向 Agent 的 MCP / A2A / Skills 资产市场。本文档供 Agent 阅读后自行完成：注册 OpenMCP Store MCP、或下载 Skill Zip 并解压到本地 skills 目录。

**禁止**使用 Provider 直连 endpoint；MCP / A2A 只走平台网关。

## 一、适用场景

- **安装某个 Skill（已有目录约定）** → 跳到第三节，按 slug 下载 Zip 并解压。
- **首次接入 OpenMCP 商店** → 先做第二节（Store MCP），再按需装技能。
- **仅浏览/搜索** → 调用 Store MCP 的 `search_assets` / `recommend_assets` / `get_asset`。

## 二、注册 OpenMCP Store MCP（推荐）

在 Cursor / Claude Code / Codex 等客户端注册平台托管的 Store MCP（Streamable HTTP）：

```json
{
  "mcpServers": {
    "openmcp-store": {
      "url": "https://www.openmcp.cn/api/mcp/store",
      "headers": {
        "Authorization": "Bearer YOUR_OPENMCP_API_KEY"
      }
    }
  }
}
```

- API Key：登录后打开 https://www.openmcp.cn/dashboard/apikeys 创建（网关 Virtual Key，`sk-…`）。同一把 Key 也可直接用于平台网关的市场 MCP / A2A。
- 可用 tools：`search_assets` / `recommend_assets` → `get_asset` → `install_asset`。
- 鉴权优先级：`search_assets` / `recommend_assets` / `get_asset` 匿名可只读；`install_asset` 需有效 Key（付费 Skill 另需 entitlement）。
- Chat / AI 选型请优先调 `recommend_assets`（`useCase` + 可选 kind/priceType/securityGrade），返回带 `reason` 的热度排序清单；选定后再 `install_asset`。
- 鉴权头两种写法均可：`Authorization: Bearer <key>` 或 `x-litellm-api-key: <key>`。

Claude Code CLI 示例：

```bash
claude mcp add --transport http openmcp-store https://www.openmcp.cn/api/mcp/store \
  --header "Authorization: Bearer YOUR_OPENMCP_API_KEY"
```

## 三、按 slug 安装 Skill 包（Zip → skills 目录）

用户说「安装 `<slug>`」或「请根据本文件安装 `<slug>`」时：

1. 解析 slug（例如 `dev-expert` 或 `@owner/dev-expert` 取最后一段）。
2. 下载 Zip。**所有 Skill 包下载都需要登录**（免费 Skill 也不例外）：在请求里带上 Session Cookie，或带 API Key：

```bash
# 推荐：按 slug + API Key
curl -fsSL -H "Authorization: Bearer $OPENMCP_API_KEY" \
  "https://www.openmcp.cn/api/skills/<slug>/package" -o skill.zip

# 或按 id
curl -fsSL -H "Authorization: Bearer $OPENMCP_API_KEY" \
  "https://www.openmcp.cn/api/skills/<id>/package" -o skill.zip
```

未带凭据会返回 `401 请先登录`；付费 Skill 未购买返回 `403 请先购买`。

可选 JSON 清单（不下载二进制）：

```bash
curl -fsSL -H "Authorization: Bearer $OPENMCP_API_KEY" \
  "https://www.openmcp.cn/api/skills/<slug>/package?format=json"
```

3. 解压到**当前 Agent 的 skills 目录**下的 `<skill-name>/`（包内含 `SKILL.md` 及附属文件）：

| Agent | 目录 |
|-------|------|
| Cursor | `~/.cursor/skills/<name>/` |
| Claude Code | `~/.claude/skills/<name>/` 或项目内 `skills/<name>/` |
| Codex | `~/.codex/skills/<name>/` 或项目 `.agents/skills/<name>/` |
| 通用 | 按该 Agent 文档的 skills 路径 |

```bash
# 示例：Cursor
mkdir -p ~/.cursor/skills
unzip -o skill.zip -d ~/.cursor/skills/<name>
```

4. 重启 / 重载 Agent 会话，确认技能出现在可用列表中。

包结构最低要求：

```
<name>/
  SKILL.md          # YAML frontmatter: name, description + 正文
  README.md         # 可选
  …                 # 其它脚本或资源
```

## 四、校验与安全

- 优先使用 `https://www.openmcp.cn` 官方 URL，勿从不明镜像安装。
- 付费资产须先在网站购买或具备 entitlement，再下载。
- MCP / A2A 配置里只填平台网关 URL + 用户 API Key，**不要**填写 Provider 直连地址。
- 平台网关鉴权头：`x-litellm-api-key: <key>`（首选）或 `Authorization: Bearer <key>`。

## 五、人工入口

- 起步：https://www.openmcp.cn/start
- Skills 货架：https://www.openmcp.cn/skills
- 本说明：https://www.openmcp.cn/install/openmcp.md
