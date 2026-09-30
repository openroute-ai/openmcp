# Skills 详情页：评测报告 × 扫描门控结合方案

> 2026-09-20  
> 参考：SkillHub 详情页「评测报告 / 安全评估报告」（TRACE 五维 + 安全分项）  
> 对齐：[SKILLS_PUBLISH_POLICY.md](./SKILLS_PUBLISH_POLICY.md)

---

## 1. 结论：可以结合，而且应拆成两层

SkillHub 把 **质量评测（TRACE）** 与 **安全准入** 分开展示；OpenMCP 已有 **扫描门控 `securityGrade`**，二者应这样叠：

| 层级 | OpenMCP 字段 / 能力 | 对应 SkillHub | 是否门控上架 |
|------|---------------------|---------------|--------------|
| **A. 安全门控（硬）** | `securityGrade` + `securityFlags` + `securityLlmAnalysis` + `trustTier` + `certified` | 安全评估报告 / 三线审核结论 | **是**（见发布策略） |
| **B. 质量评测（软）** | 建议新增 `evalReport`（JSONB）或 `traceScores` | TRACE 雷达图（T/R/A/C/E） | **否**；只影响排序/展示/推荐 |

**不要**再用独立语义的 `securityLevel` 做门控：继续作为 `securityGrade` 的遗留镜像即可。

---

## 2. 安全门控 → 详情页「安全评估报告」映射

### 2.1 总结论徽标（Hero / 报告头）

| `securityGrade` | 用户可见结论 | UI |
|-----------------|--------------|-----|
| `safe` | 通过安全检测 | 绿色 |
| `caution` | 存在潜在风险（可获取，需阅读说明） | 黄色 |
| `unsafe` | 待人工复核（市场不可见） | 橙色（后台） |
| `reject` | 未通过安全检测 | 红色（后台） |
| `unknown` / 未扫描 | 尚未完成检测 | 灰色 |

附加：

- `certified=true` → 「人工认证」徽章（高于自动扫描）  
- `trustTier` → 「来源信任层级」小字（1–5）

### 2.2 分项检测（对齐 SkillHub 安全维度 × 我们的 flags）

把 `securityFlags[]`（规则扫描命中）按类别聚合展示为报告行：

| 报告维度（展示名） | 映射来源（实现侧） |
|--------------------|--------------------|
| 供应链风险 | flags 中依赖/安装类 pattern |
| 命令执行风险 | shell / HIGH 命令类 |
| 网络请求与数据外传 | 外连 / exfil 类 |
| 文件操作与敏感路径 | 文件系统类 |
| Prompt 注入风险 | AGENT / prompt 类 |
| 远程脚本执行 | PIPE_TO_SHELL / 远程下载执行 |
| 可疑编码/混淆 | SECRET / obfuscation 类 |

每行状态：`通过` / `命中 N 项` / `未覆盖`。命中可展开：flag 名、severity、文件路径、snippet（来自 flags 结构）。

### 2.3 LLM 语义复核区

若存在 `securityLlmAnalysis`：

- 展示 `riskSummary`、`recommendation`、`confidence`  
- `findings[]` 列表  

与 SkillHub「查看报告」抽屉/Tab 一致：默认摘要，点击展开全文。

---

## 3. 质量评测（OpenMCP Eval）

正式档案见 [OPENMCP_EVAL_V1.md](./OPENMCP_EVAL_V1.md)（权重与启发式公式）。以下保留设计意图摘要。

SkillHub TRACE：**T**rust / **R**eliability / **A**daptability / **C**onvention / **E**ffectiveness（各约 0–5 或 0–100）。

### 3.1 建议数据模型（不阻塞本迭代 UI）

```ts
// skills.metadata.evalReport 或独立列 eval_report jsonb
type EvalReport = {
  version: 'trace-v1'
  overall: number // 0-5
  dimensions: {
    trust: number
    reliability: number
    adaptability: number
    convention: number
    effectiveness: number
  }
  updatedAt: string
  source: 'heuristic' | 'llm' | 'manual'
}
```

- **Trust** 可部分由门控推导：`safe`+`certified` 高分；`caution` 中等（启发式，首期即可）  
- 其余维可用 README/scenario/features 启发式或后续 LLM enrichment  
- **不得**用 TRACE 总分覆盖 `securityGrade` 门控

### 3.2 UI

- Tab「评测报告」：五维雷达图（或条形图降级）+ 简短维度说明  
- 无数据时：展示「评测生成中 / 暂无评测」，并用门控结果填满 Trust 条作为占位

---

## 4. 详情页信息架构（借鉴 SkillHub，贴合 OpenMCP）

```
[面包屑]
[Hero] 图标 | 标题 | 摘要 | 徽章(securityGrade/certified/price) | 平台 tags | 统计(下载/浏览)
       CTA：免费获取 / 付费购买
[Tabs]
  概览     — scenario、features、适用说明
  说明文档 — README markdown
  安全报告 — §2 安全评估报告（默认选中若 caution）
  评测报告 — §3 TRACE 风格（可空态）
[侧栏] 作者 | 分类 | 版本 | 更新 | 价格 | 安装指引入口
```

布局原则：左主右辅（`lg:grid-cols-3` 保持）；Hero 从「居中大标题」改为 **左对齐信息带 + 右侧 CTA**，更接近 SkillHub。

---

## 5. API 补齐

`getSkillById` / `getSkillBySlug` 需返回（至少）：

- `securityGrade`, `securityFlags`, `securityLlmGrade`, `securityLlmAnalysis`, `trustTier`, `scannedAt`, `scanRulesVersion`
- `certified`, `certifiedAt`
- `features`, `scenario`, `version`, `platforms`, `githubUrl`, `sourceType`
- `evalReport`（可选，来自 metadata）

---

## 6. 实现范围（本需求）

1. 文档：本方案 + 发布策略交叉引用  
2. 代码：详情页布局改造 + 安全报告组件 + Tab；API 带出安全字段；Trust 启发式占位评测  
3. 完整 TRACE LLM 打分可后续迭代


---

## 7. SkillHub 实页采证（2026-09-20）

来源：https://skillhub.cn/skills/user_814dbe54/dev-expert  
截图：`docs/references/skillhub-detail/`

### 布局

- 左主栏 + 右约 320px sticky 安装栏
- Hero：头像字母、标题、slug、金星 AI 评分（如 4.6 优秀）、绿盾「安全」、来源紫标、描述、chips（分类/能力/更新/版本）
- Tabs：概述 / 文件 / 评论 / 版本历史 / **评测报告**
- 右栏：安装 prompt 卡片、「复制 prompt」、下载 Zip、安装到本地 Agent、收藏；下方 tokens/下载/收藏/评分/作者；安全：科恩实验室 + 云鼎实验室「安全，无风险」+ 查看报告

### TRACE 评测报告

1. 淡紫说明条：五维含义 +「了解详情」
2. 五边形雷达 + 大号综合分（4.6/5）+ 「综合评级：优秀」+ 一段综述
3. 五维详情行：彩色图标 + Letter·中英名 + 进度条 + x.x/5 + 1–2 句理由  
   - T 可信任度 / R 可靠性 / A 适用性 / C 规范性 / E 有效性

安全不单独成第六维分数，而是 Trust 的依据 + 实验室徽章。

### OpenMCP 落地对照

| SkillHub | OpenMCP |
|----------|---------|
| 绿盾安全 + 实验室报告 | `securityGrade` 徽标 + 安全报告 Tab（flags/LLM） |
| TRACE 雷达 | 评测报告 Tab；Trust 可由 grade+certified 启发式 |
| 安装 sticky 栏 | `SkillPurchase` + 侧栏统计 |
