# @workspace/security-scan

一套规则表，三种执行环境。

这个包持有安全规则、评级规则和复核提示词。它**不**持有任何抓取代码：调用方把一个
仓库——来自 Vercel Sandbox、`git clone`，或浏览器已经解好的 ZIP——归约成一个
`SkillSourceSnapshot`，然后拿回同一个结论。这才是值得守住的性质：部署目标不能改变
一个答案。

```
snapshot ──► scanFiles ──► 评级 ──► (复核) ──► SkillScanReport
           rule-scanner   match-file  llm-analyzer  scan-skill
```

## 入口

| import | 内容 | 浏览器 bundle 安全 |
| --- | --- | --- |
| `@workspace/security-scan` | 全部，含 LLM 复核器 | 否 |
| `@workspace/security-scan/core` | 规则、评级、文件筛选、类型 | 是 |

`./core` 是纯的那一半——没有 `ai`、没有 `node:*`、没有 `process.env`。组件从它
import；服务端从根 import。

## 两个阶段

1. **规则**（`scanFiles`）—— 离线、确定性、不做 IO。一条 `critical` 是终局，没有
   复核能把后门辩掉。
2. **复核**（`analyzeWithLlm`）—— 只在阶段 1 说 `caution`/`unsafe` 时才跑，也就是
   只在「有东西值得辩一辩」时才跑。

`runSkillScan` 把两者合并。`mergeGrades` 是导出的，因为合并规则是一个产品决策，
而且早晚会有人想**刻意**去改它。

## 加一条规则

在 `src/patterns.ts` 里把 `PatternDef` 加进对应的表。本地扫描器与 Vercel Sandbox
脚本读的是同一份列表，所以没有第二处要改。把 `src/types.ts` 里的
`SCAN_RULES_VERSION` 加一版——存下来的报告带着它，而规则变过这件事不带上版本号是
无法复现的。

## 改文件筛选

`src/file-picker.ts` 会被本地路径 import，也会被序列化进 sandbox 脚本。动它之前
先读文件头：`src/match-file.ts` 和 `src/file-picker.ts` 里的函数会被发射成一段独立
脚本，它们不能引用脚本没有同样发射的任何东西。

设计取舍与 Vercel Sandbox 的回落见
`docs/design/SKILL_SECURITY_SCAN_PIPELINE.md`。