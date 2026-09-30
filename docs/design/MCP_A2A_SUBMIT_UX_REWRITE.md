# MCP/A2A 提交 UX 重写实现总结

**实现日期**: 2026-09-22  
**分支**: `cursor/mcp-a2a-submit-ux-rewrite-7a2a`  
**基于分支**: `develop-mcp`

## 实现内容

### ✅ 1. 数据库 Schema 更新

**文件**: `apps/openmcp/src/db/schema/registry-schema.ts`

- 在 `mcpServers` 表添加 `coverUrl: text('cover_url')` 字段
- 在 `a2aAgents` 表添加 `coverUrl: text('cover_url')` 字段
- 用于存储封面图片的 OSS URL（建议尺寸 1200x630）

**提交**: `41ecb673` - feat(openmcp): add coverUrl field to MCP and A2A schemas

---

### ✅ 2. MCP 提交表单重写

**文件**: `apps/openmcp/src/components/mcp/submit-mcp-form.tsx`

#### Step 1: 接入网关

1. **一键发现功能**
   - 输入端点 URL → 点击「一键发现」按钮
   - 自动拉取服务端能力声明（tools/list）
   - 预填名称、描述、工具数量、协议版本
   - 显示确认卡片展示发现的信息

2. **认证选项**（中文标签）
   - 无需认证
   - API Key
   - Bearer Token
   - Basic Auth
   - Client Credentials (OAuth2) — 需填写 Client ID, Client Secret, Token URL
   - 用户授权登录（灰色显示"即将支持"）

3. **高级选项**（Accordion 折叠）
   - 静态 Headers：支持添加多个 key-value 键值对
   - Tool allow/deny（暂未实现）
   - LiteLLM params（暂未实现）

4. **连接测试**
   - 必须通过测试才能进入 Step 2
   - 分级反馈：握手 / 鉴权 / tools/list / 协议版本
   - 成功：绿色提示「连接成功：N 个工具，耗时 Xms」
   - 失败：红色提示错误原因，下一步按钮禁用

5. **网关 ID 生成**
   - 自动生成：`{providerSlug}/{assetName}`
   - 实时显示在资产标识输入框下方

#### Step 2: 上架信息

1. **新增：Logo 上传**
   - 建议尺寸：256x256
   - 最大文件：2MB
   - 存储路径：`openmcp/mcp/logos`
   - 支持预览、移除、重新上传

2. **新增：封面上传**
   - 建议尺寸：1200x630
   - 最大文件：5MB
   - 存储路径：`openmcp/mcp/covers`
   - 支持预览、移除、重新上传

3. **原有字段**
   - 服务描述（至少 20 字符）
   - 分类
   - 可见范围（公开/私有）
   - 价格类型（免费/付费）
   - 计费模式（一次性/订阅/按次）
   - 价格金额
   - 单价（按次计费时）

#### 组件特点

- **独立组件**：与 A2A 表单完全独立，无耦合
- **可复用子组件**：`ImageUpload` 图片上传组件
- **中文 UI**：所有标签、提示、按钮均为中文
- **OSS 上传**：使用 `uploadFileFromBrowser` 函数

**提交**: `2107fb24` - feat(openmcp): rewrite MCP submit form with new UX

---

### ✅ 3. A2A 提交表单重写

**文件**: `apps/openmcp/src/components/a2a/submit-a2a-form.tsx`

#### Step 1: 接入网关

与 MCP 类似，主要区别：
- **URL 标签**：Agent Card URL（而非端点 URL）
- **协议版本**：1.0 / 0.3（而非传输协议）
- **占位符示例**：`https://example.com/.well-known/agent.json`

其他功能相同：
- 一键发现
- 认证选项
- 高级选项（静态 Headers）
- 连接测试
- 网关 ID 生成

#### Step 2: 上架信息

与 MCP 完全相同的 UI 和逻辑：
- Logo 上传（存储路径：`openmcp/a2a/logos`）
- 封面上传（存储路径：`openmcp/a2a/covers`）
- 智能体描述、分类、价格等字段

#### 组件特点

- **独立组件**：与 MCP 表单完全独立，无耦合
- **可复用子组件**：复用相同的 `ImageUpload` 组件
- **中文 UI**：所有标签、提示、按钮均为中文

**提交**: `5d454aff` - feat(openmcp): rewrite A2A submit form with new UX

---

### ✅ 4. 文档更新

**文件**: `apps/openmcp/docs/PROVIDER_GATEWAY_REGISTRATION_UED.md`

更新内容：
- 更新 §5.1 说明新的 Step1 UX
- 更新 §5.2 说明 logo/cover 上传功能
- 新增 §15 实现更新日志
- 标注已完成功能（✅）和待办事项（TODO）

**提交**: `7a19e8ca` - docs(openmcp): update UED doc for MCP/A2A submit UX rewrite

---

## 提交列表

共 4 个提交，已推送到 `origin/cursor/mcp-a2a-submit-ux-rewrite-7a2a`：

1. `41ecb673` - feat(openmcp): add coverUrl field to MCP and A2A schemas
2. `2107fb24` - feat(openmcp): rewrite MCP submit form with new UX
3. `5d454aff` - feat(openmcp): rewrite A2A submit form with new UX
4. `7a19e8ca` - docs(openmcp): update UED doc for MCP/A2A submit UX rewrite

---

## 修改的文件清单

1. `apps/openmcp/src/db/schema/registry-schema.ts` - 数据库 schema
2. `apps/openmcp/src/components/mcp/submit-mcp-form.tsx` - MCP 表单
3. `apps/openmcp/src/components/a2a/submit-a2a-form.tsx` - A2A 表单
4. `apps/openmcp/docs/PROVIDER_GATEWAY_REGISTRATION_UED.md` - 文档

---

## 待后端支持（TODO）

⚠️ **重要**：前端已完成图片上传和收集，但提交时未传递给后端。需要后端支持：

1. **tRPC Mutation 更新**
   - `mcpServers.connect` 需接受 `logoUrl?: string` 和 `coverUrl?: string` 参数
   - `a2aAgents.connect` 需接受 `logoUrl?: string` 和 `coverUrl?: string` 参数

2. **Gateway Access Layer**
   - `mcpGatewayAccess.connect()` 写入 `logoUrl` 和 `coverUrl` 到数据库
   - `a2aGatewayAccess.connect()` 写入 `logoUrl` 和 `coverUrl` 到数据库

3. **数据库迁移**
   - 创建迁移文件添加 `coverUrl` 列到 `mcp_servers` 表
   - 创建迁移文件添加 `coverUrl` 列到 `a2a_agents` 表
   - 注意：`logoUrl` 列已存在，只需添加 `coverUrl`

4. **前端修改**（待后端就绪后）
   - 在 `handleSubmit` 函数中，将 `logoUrl` 和 `coverUrl` 添加到 `connectMut.mutateAsync()` 调用中
   - 搜索代码中的 `// TODO: 更新 logo 和 cover（需要后端支持）` 注释

---

## 产品决策符合性

✅ **已满足的需求**：

1. ✅ 保持 ProviderSubmitGate + 两步流程（接入 → 上架）
2. ✅ 重写 Step1：URL + 认证 → 一键发现+测试 → 确认卡片 → 确认接入网关
3. ✅ 认证选项：无需认证 | API Key/Bearer | Basic | Client Credentials
4. ✅ 灰色显示「用户授权登录」为即将支持
5. ✅ 高级选项（Accordion）：静态 Headers key-value
6. ✅ Step2 上架：新增 logo 和 cover 图片上传
7. ✅ **MCP 和 A2A 组件完全独立** — 分别在独立文件中实现，无耦合
8. ✅ 中文 UI 为主
9. ✅ 未提交 .env
10. ✅ 文档已更新

⚠️ **部分实现**：

- Tool allow/deny for MCP（标注为可选，未实现）
- LiteLLM params for A2A（标注为可选，未实现）
- 沙箱试调（Postman 式面板）（未实现）

---

## 测试建议

### 手动测试清单

**MCP 表单**：
1. [ ] 输入 MCP 端点 URL，点击「一键发现」
2. [ ] 查看确认卡片是否正确显示发现的信息
3. [ ] 测试各种认证方式（无、API Key、Bearer、Basic、Client Credentials）
4. [ ] 点击「连接测试」，验证测试结果反馈
5. [ ] 测试通过后，进入 Step 2
6. [ ] 上传 Logo 和 Cover 图片
7. [ ] 填写其他必填字段
8. [ ] 提交表单
9. [ ] 验证 OSS 上传是否成功
10. [ ] （待后端支持）验证数据库中是否保存了 logoUrl 和 coverUrl

**A2A 表单**：
1. [ ] 输入 Agent Card URL，点击「一键发现」
2. [ ] 查看确认卡片是否正确显示发现的信息
3. [ ] 测试协议版本选择（1.0 / 0.3）
4. [ ] 测试各种认证方式
5. [ ] 点击「连接测试」，验证测试结果反馈
6. [ ] 测试通过后，进入 Step 2
7. [ ] 上传 Logo 和 Cover 图片
8. [ ] 填写其他必填字段
9. [ ] 提交表单
10. [ ] 验证 OSS 上传是否成功
11. [ ] （待后端支持）验证数据库中是否保存了 logoUrl 和 coverUrl

### UI/UX 测试

1. [ ] 所有文本是否为中文
2. [ ] 图片上传是否有预览
3. [ ] 图片上传是否有移除按钮
4. [ ] 图片上传是否有大小限制提示
5. [ ] 高级选项 Accordion 是否可折叠/展开
6. [ ] 静态 Headers 是否可添加/删除
7. [ ] 连接测试失败时，下一步按钮是否禁用
8. [ ] 错误提示是否清晰易懂
9. [ ] 响应式布局是否正常（移动端/桌面端）

---

## 注意事项

1. **MCP 和 A2A 完全独立**：两个表单在独立的文件中实现，没有共享的巨型表单，符合产品决策第 6 条
2. **中文 UI 优先**：所有用户可见的文本均为中文
3. **图片上传已完成**：前端已实现图片上传到 OSS，只是提交时未传递给后端
4. **认证选项扩展**：新增 Client Credentials (OAuth2) 支持
5. **高级选项折叠**：使用 Accordion 组件，不占用主流程空间
6. **确认卡片增强**：自动发现成功后，显示确认卡片展示关键信息
7. **网关 ID 透明化**：明确告知用户生成的网关 ID 格式

---

## 后续工作

1. **后端 API 更新**：按照上述 TODO 清单更新 tRPC mutations 和 gateway access layer
2. **数据库迁移**：生成并执行迁移文件添加 `coverUrl` 列
3. **前端集成**：修改 `handleSubmit` 函数传递 `logoUrl` 和 `coverUrl`
4. **端到端测试**：验证完整的提交流程
5. **可选功能**：实现 Tool allow/deny、LiteLLM params、沙箱试调等高级功能

---

## PR 信息

- **分支**: `cursor/mcp-a2a-submit-ux-rewrite-7a2a`
- **目标分支**: `develop-mcp`
- **GitHub 链接**: https://github.com/docsify001/n8nshow/pull/new/cursor/mcp-a2a-submit-ux-rewrite-7a2a

---

**实现完成时间**: 2026-09-22  
**状态**: ✅ 前端完成，等待后端支持
