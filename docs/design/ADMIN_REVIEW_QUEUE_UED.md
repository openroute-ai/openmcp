# Admin 人工复核队列审核界面 UED 设计

> 版本：v0.1
> 关联文档：PROVIDER_GATEWAY_REGISTRATION_UED.md（§8 安全扫描架构、§14.1 决策项）
> 范围：admin 侧对安全扫描判为 unsafe（待人工复核）的 Skill 进行人工审核的界面设计
> 上架/certified 语义：[SKILLS_PUBLISH_POLICY.md](./SKILLS_PUBLISH_POLICY.md)

---

## 1. 背景与目标

安全扫描（规则扫描 + LLM 复核）对 Skill 内容产出 4 级评级：

| 评级 | 处理方式 | 是否进入 admin 队列 |
|---|---|---|
| safe | 直接通过 | 否 |
| caution | 通过但带提示 | 否 |
| unsafe | 阻塞上架，进人工复核队列 | 是 |
| reject | 自动驳回 | 否（但 admin 可查看） |

本文档设计 admin 侧的**人工复核队列**界面，让 admin 能够：
- 查看待复核的 Skill 列表
- 查看扫描详情（命中 flag、代码片段、LLM 分析）
- 做出审核决定（通过 / 驳回 / 要求修改）
- 批量操作
- 查看历史审核记录

---

## 2. 入口与导航

### 2.1 入口位置

admin 侧边栏新增「安全审核」菜单组：

| 菜单 | 内容 |
|---|---|
| 安全审核 · 复核队列 | 待人工复核的 Skill 列表（unsafe 评级） |
| 安全审核 · 驳回记录 | 自动驳回的 Skill 列表（reject 评级，只读） |
| 安全审核 · 审核历史 | 已处理的审核记录 |

### 2.2 角色权限

- **admin**：可查看所有待复核 Skill，可做出审核决定。
- **super_admin**：可修改安全扫描规则集、可覆盖任何审核决定。
- **Provider**：不可访问此界面，只能在自己资产的详情页看到审核结果。

---

## 3. 页面一：复核队列（主页面）

### 3.1 布局

- 顶部：标题「安全复核队列」+ 统计卡片（待复核 N / 今日已处理 N / 平均处理时长 N 分钟）+ 筛选器。
- 筛选器：来源（GitHub / ZIP）、信任层级（Tier 1-5）、命中 flag（多选）、提交时间范围、Provider。
- 列表（表格 / 卡片切换）：

| 列 | 说明 |
|---|---|
| 复选框 | 批量操作 |
| Skill 名称 | 名称 + 来源徽标（GitHub / ZIP）+ referenceId |
| Provider | Provider 名称 + 头像 |
| 来源 | GitHub 仓库地址 或 ZIP 上传 |
| 信任层级 | Tier 1-5 徽标（颜色：Tier 1 绿 -> Tier 5 红） |
| 命中 flag 数 | 高风险 N / 中风险 N / reject N（可展开查看 flag 列表） |
| LLM 评级 | safe / caution / unsafe（LLM 复核结果） |
| 提交时间 | Provider 提交时间 |
| 等待时长 | 距提交时间过了多久（超 24h 标红） |
| 操作 | 审核 / 查看 |

### 3.2 排序与分页

- 默认按等待时长降序（等待最久的在前）。
- 可按信任层级、命中 flag 数、提交时间排序。
- 分页：每页 20 条。

### 3.3 空/加载/错误态

- 空态：「队列已清空，没有待复核的 Skill」+ 查看审核历史按钮。
- 加载态：骨架屏。
- 错误态：重试按钮。

---

## 4. 页面二：审核详情页

点击列表中的「审核」进入单条 Skill 的审核详情页。

### 4.1 布局（三栏）

```
+------------------+------------------+------------------+
|   左栏：Skill    |   中栏：扫描     |   右栏：审核     |
|   基本信息       |   详情（命中     |   操作面板       |
|                  |   flag + 代码）  |                  |
+------------------+------------------+------------------+
```

### 4.2 左栏：Skill 基本信息

- Skill 名称 / 描述 / 版本
- 来源：GitHub 仓库地址（可跳转 github-nextjs 查看）或 ZIP 上传
- Provider 信息：名称、入驻状态、历史资产数、历史审核记录
- 信任层级：Tier N + 判定依据（官方组织 / stars / license）
- skill.yaml 元信息：name / version / category / license / tools
- README 渲染预览（可展开全文）

### 4.3 中栏：扫描详情

**4.3.1 评级总览**

| 项目 | 值 |
|---|---|
| 规则扫描评级 | unsafe（红色） |
| LLM 复核评级 | unsafe（红色） / caution（黄色） / safe（绿色） |
| LLM confidence | 0.85 |
| 规则集版本 | v1.0.0 |
| 扫描时间 | 2026-09-18 22:30:00 |
| 扫描文件数 | 42 |

**4.3.2 命中 flag 列表**

按严重级别分组（critical > high > medium > low），每个 flag 卡片：

| 项目 | 说明 |
|---|---|
| flag 名称 | 如 agent_config_theft |
| 严重级别 | critical / high / medium / low（颜色徽标） |
| 描述 | 人类可读描述（如「Reads agent configuration/session/credential files and sends them out」） |
| 命中文件 | 文件路径（如 scripts/setup.sh） |
| 命中行号 | 第 N 行 |
| 代码片段 | 命中行 +/- 3 行上下文（代码高亮，敏感信息脱敏） |
| 上下文判断 | 是否在代码块内 / 是否被引用 / 是否被否定（展示扫描器的判断依据） |

**4.3.3 LLM 分析详情**

- risk_summary：一句话风险摘要
- findings[]：每条 finding 的 severity / description / mitigation
- recommendation：建议

**4.3.4 扫描历史**

该 Skill 的历次扫描记录（时间 / 规则版本 / 评级 / flag 变化），用于判断是首次违规还是修复后重扫。

### 4.4 右栏：审核操作面板

**4.4.1 审核决定（三选一）**

| 操作 | 含义 | 后续状态 |
|---|---|---|
| 通过 | 判定为误报，允许上架 | status -> published，certified -> true（标记为人工验证通过） |
| 驳回 | 确认风险，不允许上架 | status -> rejected，附审核意见 |
| 要求修改 | 允许 Provider 修复后重新提交 | status -> needs_revision，附修改建议 |

**4.4.2 审核意见（必填）**

- 通过：可选填备注（如「误报：合法安装脚本」）。
- 驳回：必填驳回原因（从 flag 列表选择主要风险 + 自由文本补充）。
- 要求修改：必填修改建议（具体指出需要修改的文件 / 行号 / 内容）。

**4.4.3 辅助操作**

- 查看原始文件：跳转到 github-nextjs 查看仓库源码（GitHub 来源）或下载原始 ZIP（ZIP 来源）。
- 重新扫描：手动触发对该 Skill 的重新扫描（规则 + LLM），扫描结果可能改变评级。
- 查看 Provider 历史：查看该 Provider 的历史资产审核记录、违规次数。
- 标记为恶意：super_admin 专属，标记后该 Provider 的所有资产进入重点审核。

**4.4.4 提交**

- 提交审核决定后，自动通知 Provider（邮件 / 站内信）。
- 审核记录写入审核历史表。

---

## 5. 页面三：批量审核

### 5.1 批量操作

列表页勾选多条后，底部出现批量操作栏：

| 操作 | 说明 |
|---|---|
| 批量通过 | 适用于明显误报（如全部是 Tier 1-3 的合法安装脚本命中） |
| 批量驳回 | 适用于明显恶意（如全部命中 reject 模式但 LLM 升级为 unsafe） |
| 批量分配 | 分配给其他 admin 审核 |

批量通过/驳回需二次确认（弹窗显示选中的 Skill 列表 + 警告）。

### 5.2 批量分配

- 可选择目标 admin（下拉，仅显示有审核权限的 admin）。
- 分配后这些 Skill 从当前 admin 的队列移除，出现在目标 admin 的队列中。

---

## 6. 页面四：驳回记录（只读）

### 6.1 列表

展示自动驳回（reject 评级）的 Skill 列表：

| 列 | 说明 |
|---|---|
| Skill 名称 | 名称 + 来源徽标 |
| Provider | Provider 名称 |
| 命中 reject flag | 如 exfil_secrets_combo / backdoor_install |
| 驳回时间 | 自动驳回时间 |
| 状态 | 已驳回（红色） |
| 操作 | 查看 / 恢复（super_admin 专属） |

### 6.2 恢复操作

super_admin 可将自动驳回的 Skill 恢复到复核队列（适用于规则误判），恢复后重新走人工审核流程。

---

## 7. 页面五：审核历史

### 7.1 列表

| 列 | 说明 |
|---|---|
| Skill 名称 | 名称 + 来源徽标 |
| Provider | Provider 名称 |
| 审核结果 | 通过 / 驳回 / 要求修改 |
| 审核人 | admin 名称 |
| 审核时间 | 处理时间 |
| 等待时长 | 提交到处理的时间 |
| 审核意见 | 摘要（点击展开全文） |

### 7.2 筛选

- 审核结果、审核人、时间范围、Provider、来源。
- 导出 CSV。

---

## 8. 通知机制

### 8.1 通知 admin

- 新 Skill 进入复核队列时，通知值班 admin（邮件 / 站内信）。
- 队列积压超阈值（如 > 50 条待复核）时，通知所有 admin。
- 每日摘要：今日新增待复核 N / 已处理 N / 驳回率 N%。

### 8.2 通知 Provider

- 审核决定提交后，通知 Provider：
  - 通过：「您的 Skill {name} 已通过安全审核，可上架」
  - 驳回：「您的 Skill {name} 未通过安全审核，原因：{审核意见}」
  - 要求修改：「您的 Skill {name} 需要修改后重新提交，建议：{修改建议}」
- 通知渠道：邮件 + 站内信。

---

## 9. 数据模型

### 9.1 新增表：skill_reviews（审核记录）

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string (PK) | 审核记录 ID |
| skill_id | string (FK) | 关联 skills 表 |
| review_type | string | auto_reject / manual |
| reviewer_id | string? | admin ID（manual 时必填） |
| decision | string | pass / reject / needs_revision |
| review_comment | text | 审核意见 / 驳回原因 / 修改建议 |
| flagged_flags | json | 审核时关注的主要 flag 列表 |
| scan_rules_version | string | 审核时的规则集版本 |
| scan_grade | string | 审核时的扫描评级 |
| llm_grade | string? | 审核时的 LLM 评级 |
| created_at | datetime | 审核时间 |
| duration_minutes | int | 从提交到审核的等待时长 |

### 9.2 新增表：skill_review_assignments（审核分配）

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string (PK) | 分配记录 ID |
| skill_id | string (FK) | 关联 skills 表 |
| assigned_to | string (FK) | admin ID |
| assigned_by | string (FK) | 分配人 ID |
| assigned_at | datetime | 分配时间 |
| status | string | pending / completed / reassigned |

### 9.3 skills 表扩展

| 新增字段 | 类型 | 说明 |
|---|---|---|
| review_status | string | pending_review / passed / rejected / needs_revision |
| reviewed_by | string? | 审核人 ID |
| reviewed_at | datetime? | 审核时间 |
| review_comment | text? | 审核意见 |
| certified | boolean | 人工审核通过后置 true |

---

## 10. 交互细节

| 控件 | 状态 | 文案/样式 |
|---|---|---|
| 队列统计卡片 | 默认 | 待复核 N（橙色）/ 今日已处理 N（绿色）/ 平均时长 N 分钟 |
| 等待时长 | 超 24h | 红色「已等待 N 小时」 |
| 命中 flag 展开 | 展开 | 显示 flag 详情卡片（文件 + 行号 + 代码片段） |
| 审核决定 - 通过 | 点击 | 绿色按钮「通过（标记为误报）」+ 备注输入框（可选） |
| 审核决定 - 驳回 | 点击 | 红色按钮「驳回」+ 驳回原因必填（flag 选择 + 文本） |
| 审核决定 - 要求修改 | 点击 | 黄色按钮「要求修改」+ 修改建议必填 |
| 批量通过 | 确认 | 弹窗「确认批量通过 N 条？这些 Skill 将标记为人工验证通过」|
| 批量驳回 | 确认 | 弹窗「确认批量驳回 N 条？Provider 将收到驳回通知」|
| 重新扫描 | loading | 按钮 loading +「正在重新扫描...」|
| 重新扫描 | 完成 | 提示「扫描完成，评级可能已变化」+ 刷新中栏 |
| 恢复（驳回记录） | 确认 | 弹窗「确认恢复该 Skill 到复核队列？」（super_admin 专属） |

---

## 11. 与现有系统的关系

### 11.1 不改

- 现有 admin 页面的权限框架、侧边栏基础结构。

### 11.2 新增

- admin 侧边栏「安全审核」菜单组（3 个子页面）。
- 复核队列页面（列表 + 筛选 + 批量操作）。
- 审核详情页（三栏布局：基本信息 + 扫描详情 + 操作面板）。
- 驳回记录页面（只读列表 + 恢复操作）。
- 审核历史页面（列表 + 筛选 + 导出）。
- skill_reviews 表、skill_review_assignments 表。
- skills 表扩展字段（review_status / reviewed_by / reviewed_at / review_comment / certified）。
- 通知服务（admin 队列通知 + Provider 审核结果通知）。

### 11.3 集成

- 安全扫描服务（§8）产出 unsafe 评级时，自动写入 skill_reviews 表（review_type=manual, decision=null）并出现在复核队列。
- 安全扫描服务产出 reject 评级时，自动写入 skill_reviews 表（review_type=auto_reject, decision=reject）并出现在驳回记录。
- admin 审核决定提交后，更新 skills 表的 review_status / certified 字段，触发 Provider 通知。

---

## 12. 验收标准

1. admin 可在「安全审核 · 复核队列」看到所有 unsafe 评级的 Skill，按等待时长排序。
2. 审核详情页展示扫描详情：评级总览、命中 flag 列表（含文件/行号/代码片段）、LLM 分析、扫描历史。
3. admin 可做出三种审核决定（通过 / 驳回 / 要求修改），审核意见必填（驳回和要求修改）。
4. 批量操作：可批量通过 / 驳回 / 分配，批量操作需二次确认。
5. 驳回记录页展示自动驳回的 Skill，super_admin 可恢复到复核队列。
6. 审核历史页展示已处理记录，可筛选和导出。
7. 审核决定提交后自动通知 Provider（邮件 + 站内信）。
8. 队列积压超阈值时通知所有 admin。
9. 通过审核的 Skill 标记 certified=true（人工验证通过），区别于扫描 safe 的自动通过。

---

## 13. 决策与待确认项

### 13.1 已确认

- 复核队列入口：admin 侧边栏「安全审核」菜单组，3 个子页面（复核队列 / 驳回记录 / 审核历史）。
- 审核决定三选一：通过（标记误报）/ 驳回（确认风险）/ 要求修改（允许修复重提）。
- 通过审核的 Skill 标记 certified=true。
- 批量操作需二次确认。
- super_admin 可恢复自动驳回的 Skill。

### 13.2 仍待确认

- [ ] 值班 admin 轮值机制（自动分配 vs 人工认领）。
- [ ] 队列积压阈值（默认 50 条是否合适）。
- [ ] 审核意见是否需要多语言（中英文）。
- [ ] 是否需要审核 SLA（如 48 小时内必须处理）。
