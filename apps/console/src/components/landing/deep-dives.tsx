"use client"

import { IconArrowUpRight, IconCheck, IconClock, IconFlag, IconRefresh } from "@tabler/icons-react";
import { Reveal } from "@/hooks/use-reveal";

/**
 * 生命体征条 + 异动旗标，取代原「六维评分 92」。
 *
 * 决策 #9：不引入 0-100 综合分。加权和衡量的不是质量而是规模——star 多的项目
 * 在任何维度上都不会差，于是高分只是复述「它已经很受欢迎」，把结论又绕回
 * 用户提问的前提。逐项原始量 + 方向性旗标让用户自己判断，雷达只负责把证据
 * 摆出来（docs/design/CONSOLE_RADAR_COMMERCIAL_PLAN.md §4.3）。
 */
function VitalsPanel() {
  // value 是原始量，不是 0-100 分。tone 决定它落在雷达涨跌色的哪一端。
  const vitals = [
    { label: "周 star 增量", value: "+218", detail: "近 3 周：+184 / +206 / +218", tone: "up" as const },
    { label: "增速加速度", value: "+5.8%", detail: "本周较上周的相对变化", tone: "up" as const },
    { label: "周 release", value: "0", detail: "距上次发布 214 天", tone: "flag" as const },
    { label: "活跃贡献者", value: "3", detail: "Top 3 中 2 人超 150 天无提交", tone: "flag" as const },
    { label: "许可证", value: "MIT", detail: "2026-03 变更过一次", tone: "down" as const },
  ];

  return (
    <div className="rounded-2xl border border-glass-border bg-glass p-6 backdrop-blur-xl">
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-sm font-semibold">project-a · 生命体征</span>
        <span className="inline-flex items-center gap-1 rounded-md bg-muted/60 px-2 py-1 text-[11px] font-medium text-muted-foreground">
          <IconFlag size={11} />
          维护停滞
        </span>
      </div>

      <p className="mt-1.5 text-[11px] text-muted-foreground">采集于 14 分钟前 · 不做加权汇总，每项都是原始量</p>

      <dl className="mt-5 space-y-3.5">
        {vitals.map((v, i) => (
          <div
            key={v.label}
            className="flex items-baseline justify-between gap-4 border-b border-glass-border pb-3 last:border-0"
          >
            <div className="min-w-0">
              <dt className="text-sm">{v.label}</dt>
              <dd className="mt-0.5 text-[11px] text-muted-foreground">{v.detail}</dd>
            </div>
            <dd
              className={`shrink-0 font-display text-xl font-bold tabular-nums ${
                v.tone === "up" ? "text-radar-up" : v.tone === "down" ? "text-radar-down" : "text-foreground"
              }`}
            >
              {v.value}
            </dd>
          </div>
        ))}
      </dl>

      <a
        href="#method"
        className="mt-5 inline-flex items-center gap-1.5 text-[13px] font-semibold text-aqua transition-colors hover:text-foreground"
      >
        看这条结论的原始时间轴 <IconArrowUpRight size={13} />
      </a>
    </div>
  );
}

const CHECKS = [
  { label: "存在性与官方性", detail: "官方组织、未归档" },
  { label: "迭代活跃度", detail: "近 30 天 48 次提交" },
  { label: "安全基线", detail: "无已知 CVE、有 SECURITY.md" },
  { label: "社区健康", detail: "Bus Factor 8" },
  { label: "元数据完整", detail: "主页 / 文档 / 许可证齐全" },
];

export function DeepDives() {
  return (
    <div id="product" className="mx-auto max-w-6xl space-y-24 px-4 py-24">
      {/* 7.1 生命体征 + 异动旗标 —— 取代原「六维尽调评分」 */}
      <section>
        <div className="grid items-center gap-10 lg:grid-cols-2">
          <Reveal>
            <VitalsPanel />
          </Reveal>
          <Reveal delay={100}>
            <span className="text-sm font-medium text-aqua">生命体征</span>
            <h2 className="mt-3 font-display text-3xl font-bold tracking-tight sm:text-4xl">
              不给你一个分，给你看它是不是在变坏
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              把 star 增量、增速加速度、发布间隔、贡献者活跃度、许可证状态按原始量摆出来，各项独立可查。
              综合分会把它们压成一个数字，而那个数字通常只是在复述「它已经很受欢迎」。
            </p>
            <ul className="mt-6 space-y-3.5">
              {CHECKS.map((c) => (
                <li key={c.label} className="flex items-start gap-3 text-sm">
                  <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
                    <IconCheck size={12} />
                  </span>
                  <span>
                    <span className="font-medium">{c.label}：</span>
                    <span className="text-muted-foreground">{c.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-6 rounded-xl border border-glass-border bg-glass p-4 text-[13px] leading-relaxed text-muted-foreground">
              <span className="font-medium text-foreground">我们不做加权汇总，也不公开权重。</span>
              每项数据都有采集时间与来源，点开即见原始时间轴——结论可以复现，也可以被你自己推翻。
            </p>
          </Reveal>
        </div>
      </section>

      {/* 7.2 证据链 —— AI 选型助手已降级到 v2，这里换成雷达的差异化资产 */}
      <section>
        <div className="grid items-center gap-10 lg:grid-cols-2">
          <Reveal>
            <span className="text-sm font-medium text-aqua">证据链</span>
            <h2 className="mt-3 font-display text-3xl font-bold tracking-tight sm:text-4xl">
              每条结论都能追到原始信号
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              雷达的核心资产是 stargazer 的到达时间戳——不是 star 总数，而是每一个 star 是什么时候到的。累计值会掩盖变化，只有到达时间能回答「这周比上周多了还是少了」。
            </p>
            <ul className="mt-6 space-y-3.5 text-sm">
              {[
                "逐个 stargazer 记录到达时间，周增量直接可得",
                "提交者名单与时间序列公开，Bus Factor 可自己算",
                "许可证变更保留历史值，不只存当前值",
                "每条异动附原始名单与时间轴，不只给结论",
              ].map((t) => (
                <li key={t} className="flex items-start gap-3">
                  <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
                    <IconCheck size={12} />
                  </span>
                  <span className="text-muted-foreground">{t}</span>
                </li>
              ))}
            </ul>
          </Reveal>
          <Reveal delay={100}>
            <div className="rounded-2xl border border-glass-border bg-glass p-5 backdrop-blur-xl">
              <div className="flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
                <IconClock size={13} className="text-aqua" />
                证据时间轴 · project-a
              </div>
              <div className="mt-4 space-y-3">
                {[
                  { t: "W-3", n: 184, c: "bg-radar-up" },
                  { t: "W-2", n: 206, c: "bg-radar-up" },
                  { t: "W-1", n: 218, c: "bg-radar-up" },
                  { t: "本周", n: 0, c: "bg-border" },
                ].map((w) => (
                  <div key={w.t} className="flex items-center gap-3 text-[13px]">
                    <span className="w-12 shrink-0 font-mono text-[11px] text-muted-foreground">{w.t}</span>
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-glass-border">
                      <span
                        className={`block h-full rounded-full ${w.c}`}
                        style={{ width: w.n === 0 ? "6%" : `${(w.n / 240) * 100}%`, opacity: w.n === 0 ? 0.4 : 0.85 }}
                      />
                    </span>
                    <span
                      className={`w-14 shrink-0 text-right font-mono tabular-nums ${w.n === 0 ? "text-muted-foreground" : "text-radar-up"}`}
                    >
                      {w.n === 0 ? "—" : `+${w.n}`}
                    </span>
                  </div>
                ))}
              </div>
              <p className="mt-4 border-t border-glass-border pt-3 text-[11px] leading-relaxed text-muted-foreground">
                本周增量为 0，且距上次 release 已 214 天 → 触发「维护停滞」旗标。判断依据全部在这张表里。
              </p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* 7.3 团队决策工作台 */}
      <section>
        <div className="grid items-center gap-10 lg:grid-cols-2">
          <Reveal>
            {/* 决策工作台示意 */}
            <div className="rounded-2xl border border-glass-border bg-glass p-5 backdrop-blur-xl">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">向量数据库选型 · 决策工作台</span>
                <span className="rounded-full bg-brand/15 px-2.5 py-1 text-[11px] font-medium text-brand">
                  评审中
                </span>
              </div>
              <div className="mt-4 space-y-2.5">
                {[
                  ["候选 A · project-a", "通过", "bg-muted text-muted-foreground"],
                  ["候选 B · project-b", "复评中", "bg-aqua/15 text-aqua"],
                  ["候选 C · project-c", "待评审", "bg-muted text-muted-foreground"],
                ].map(([name, status, tint]) => (
                  <div
                    key={name}
                    className="flex items-center justify-between rounded-lg border border-glass-border bg-glass px-3.5 py-2.5"
                  >
                    <span className="text-[13px]">{name}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${tint}`}>{status}</span>
                  </div>
                ))}
              </div>
              <div className="mt-4">
                <div className="flex justify-between text-[11px] text-muted-foreground">
                  <span>流程进度：候选收集 → 尽调 → 评审 → 审批</span>
                  <span className="font-display font-semibold text-foreground">65%</span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-glass-border">
                  <div className="h-full w-[65%] rounded-full bg-gradient-to-r from-brand to-aqua" />
                </div>
              </div>
            </div>
          </Reveal>
          <Reveal delay={100}>
            <span className="text-sm font-medium text-aqua">团队决策工作台</span>
            <h2 className="mt-3 font-display text-3xl font-bold tracking-tight sm:text-4xl">
              让选型从个人判断变成团队决策
            </h2>
            <ul className="mt-6 space-y-3.5 text-sm">
              {[
                "候选收集 → 尽调 → 评审 → 审批 → 跟踪",
                "评论、评估人、决策记录沉淀",
                "决策报告一键导出",
              ].map((t) => (
                <li key={t} className="flex items-start gap-3">
                  <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
                    <IconCheck size={12} />
                  </span>
                  <span className="text-muted-foreground">{t}</span>
                </li>
              ))}
            </ul>
            <a
              href="#download"
              className="mt-7 inline-flex items-center gap-1.5 text-sm font-semibold text-aqua transition-colors hover:text-foreground"
            >
              预约团队演示 <span aria-hidden>→</span>
            </a>
          </Reveal>
        </div>
      </section>

      {/* 7.4 风险监控与告警 */}
      <section>
        <div className="grid items-center gap-10 lg:grid-cols-2">
          <Reveal>
            <span className="text-sm font-medium text-aqua">风险监控</span>
            <h2 className="mt-3 font-display text-3xl font-bold tracking-tight sm:text-4xl">
              引入不是终点，风险需要持续监控
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              已引入的项目会持续跟踪许可证变更、CVE、贡献者与发布动态，异常第一时间推送给订阅人。
            </p>
            <a
              href="#pricing"
              className="mt-7 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-brand to-brand2 px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-lg shadow-brand/30 transition-opacity hover:opacity-90"
            >
              了解风险订阅 <span aria-hidden>→</span>
            </a>
          </Reveal>
          <Reveal delay={100}>
            {/* 告警列表示意 */}
            <div className="rounded-2xl border border-glass-border bg-glass p-5 backdrop-blur-xl">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">风险告警</span>
                <span className="text-[11px] text-muted-foreground">最近 7 天</span>
              </div>
              <div className="mt-4 space-y-2.5">
                <div className="radar-alert-bar flex items-start gap-3 rounded-lg border border-glass-border bg-glass py-3 pl-4 pr-3.5 text-[13px]">
                  <span className="mt-0.5 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                    中危
                  </span>
                  <span>
                    <span className="font-medium">project-x</span>{" "}
                    <span className="text-muted-foreground">新增 1 个中危 CVE</span>
                  </span>
                </div>
                <div className="radar-alert-bar flex items-start gap-3 rounded-lg border border-glass-border bg-glass py-3 pl-4 pr-3.5 text-[13px]">
                  <span className="mt-0.5 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                    维护
                  </span>
                  <span>
                    <span className="font-medium">project-y</span>{" "}
                    <span className="text-muted-foreground">近 30 天新增贡献者下降 40%</span>
                  </span>
                </div>
                <div className="radar-alert-bar flex items-start gap-3 rounded-lg border border-glass-border bg-glass py-3 pl-4 pr-3.5 text-[13px]">
                  <span className="mt-0.5 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                    更新
                  </span>
                  <span>
                    <span className="font-medium">project-z</span>{" "}
                    <span className="text-muted-foreground">发布 v3.0，许可证未变更</span>
                  </span>
                </div>
              </div>
              <p className="mt-4 flex items-center gap-2 text-[11px] text-muted-foreground">
                <IconRefresh size={12} />
                每日同步 OSV / NVD / Git 信号
              </p>
            </div>
          </Reveal>
        </div>
      </section>
    </div>
  );
}
