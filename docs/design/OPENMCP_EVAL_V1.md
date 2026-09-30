# OpenMCP Eval Profile — `openmcp-eval-v1`

> 状态：产品 + 实现规范（2026-09-20）  
> 性质：**软质量评测**（展示 / 排序 / 推荐），**绝不覆盖** `securityGrade` 上架门控  
> 实现：`src/lib/skills/eval-report.ts` → 写入 `skills.metadata.evalReport`

与 SkillHub「TRACE」同为五维心智模型，但本档案为 **OpenMCP 自有标准**：权重、公式、评级文案、持久化字段均以本文为准。

---

## 1. 档案元数据

| 字段 | 值 |
|------|-----|
| `profile` | `openmcp-eval-v1` |
| `version` | `openmcp-eval-v1`（报告内 `version` 字段） |
| `scoreScale` | 每维 **0.0–5.0**，一位小数 |
| `overall` | 加权平均，再 clamp 到 0–5 |
| `source` | `heuristic` \| `llm` \| `manual`（本版实现以 `heuristic` 为主） |

持久化结构：

```ts
type OpenmcpEvalReportV1 = {
  profile: 'openmcp-eval-v1'
  version: 'openmcp-eval-v1'
  overall: number
  dimensions: {
    trust: number
    reliability: number
    adaptability: number
    convention: number
    effectiveness: number
  }
  weights: {
    trust: number
    reliability: number
    adaptability: number
    convention: number
    effectiveness: number
  }
  reasons?: Partial<Record<keyof OpenmcpEvalReportV1['dimensions'], { zh: string; en: string }>>
  updatedAt: string // ISO
  source: 'heuristic' | 'llm' | 'manual'
}
```

存放位置：`skills.metadata.evalReport`（JSONB 合并，不覆盖其它 metadata 键）。

---

## 2. 维度字典

| ID | 字母 | 中文 | 英文 | 权重 (v1) | 含义 |
|----|------|------|------|-----------|------|
| `trust` | T | 可信任度 | Trust | **0.30** | 安全门控与人工认证信号（与 `securityGrade`/`certified` 对齐） |
| `reliability` | R | 可靠性 | Reliability | 0.15 | 文档完整度、版本信息 |
| `adaptability` | A | 适用性 | Adaptability | 0.15 | 多平台、场景说明 |
| `convention` | C | 规范性 | Convention | 0.15 | 特性字段、结构完整度 |
| `effectiveness` | E | 有效性 | Effectiveness | **0.25** | 场景清晰度与使用热度信号 |

权重合计 = 1.0。园区/政府档案可另建 `openmcp-eval-gov-v1` 调整权重或增维，**不得**改硬门控。

---

## 3. 启发式公式（`source: heuristic`）

所有中间分先算浮点，最终 `clampScore(x) = round(min(5, max(0, x)) * 10) / 10`。

### 3.1 Trust（权重 0.30）

由门控推导（与发布策略一致，仅用于展示）：

| `securityGrade` | 基础分 |
|-----------------|--------|
| `safe` | 4.0 |
| `caution` | 2.8 |
| `unsafe` | 1.5 |
| `reject` | 0.8 |
| `unknown` / null | 1.5 |

- 若 `certified === true` 且 grade ∈ `{safe, caution}`：`base = min(5, base + 0.8)`  
- `trust = clampScore(base)`

### 3.2 Reliability（0.15）

```
readmeLen = len(readme || readmeEn || '')
base = readmeLen > 800 ? 4.2 : readmeLen > 200 ? 3.2 : readmeLen > 0 ? 2.2 : 1.2
reliability = clampScore(base + (version ? 0.5 : 0))
```

### 3.3 Adaptability（0.15）

```
platformCount = len(platforms[])
adaptability = clampScore(1.5 + min(2.5, platformCount * 0.7) + (scenario.trim().length > 20 ? 0.8 : 0))
```

### 3.4 Convention（0.15）

```
featureCount = len(features[])
convention = clampScore(1.8 + min(2.2, featureCount * 0.35) + (version ? 0.4 : 0))
```

### 3.5 Effectiveness（0.25）

```
effectiveness = clampScore(
  (scenario.trim().length > 20 ? 3.2 : 1.8)
  + min(1.5, log10(max(1, downloads + 1)))
  + (featureCount > 0 ? 0.4 : 0)
)
```

### 3.6 Overall

```
overall = clampScore(
  trust * 0.30
  + reliability * 0.15
  + adaptability * 0.15
  + convention * 0.15
  + effectiveness * 0.25
)
```

### 3.7 综合评级文案

| overall | 中文 | 英文 |
|---------|------|------|
| ≥ 4.5 | 优秀 | Excellent |
| ≥ 3.5 | 良好 | Good |
| ≥ 2.5 | 一般 | Fair |
| &lt; 2.5 | 待提升 | Needs work |

---

## 4. 触发与持久化时机

在以下时机调用 `computeAndPersistEvalReport(skillId)`：

1. 安全扫描结束并写回 skill 后（`runSkillSecurityScan`）  
2. AI enrichment 更新 scenario/features 后（`runSkillEnrichment`）  
3. Admin 审核 pass/reject 导致 `certified` / 状态变化后（可选，pass 时必须）

读取：`getSkillById` / `getSkillBySlug` 从 `metadata.evalReport` 解析并返回；UI **优先展示持久化结果**，仅在缺失时客户端兜底计算。

---

## 5. 与门控的边界

| | 门控 `securityGrade` | Eval `openmcp-eval-v1` |
|--|----------------------|-------------------------|
| 决定上架 | ✅ | ❌ |
| 用户可见 | 安全报告 Tab + 徽章 | 评测报告 Tab + Hero 综合分 |
| 可自定义档案 | 规则集版本 | 权重/维度档案版本 |

---

## 6. 展示微调（相对 SkillHub）

- 品牌文案用 **「OpenMCP Eval」** / `openmcp-eval-v1`，避免冒充 SkillHub TRACE 商标  
- 说明条强调：**质量分 ≠ 上架许可**  
- Hero 综合分取自持久化 `overall`  
- 安全仍以门控徽章 + 安全报告为准；Trust 高分不能替代 `caution` 风险提示  
