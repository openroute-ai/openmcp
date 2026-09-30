"use client"

import { IconBell, IconColumns3, IconGauge, IconPuzzle, IconScale, IconAlertTriangle, IconSkull, IconRadio } from "@tabler/icons-react";
import { Reveal } from "@/hooks/use-reveal";

const DATA_SOURCES = ["GitHub", "GitLab", "Gitee", "npm", "PyPI", "Maven", "OSV", "NVD"];

export function TrustStrip() {
  return (
    <section className="border-y border-border bg-card/40 backdrop-blur-sm">
      <div className="mx-auto max-w-6xl px-4 py-8">
        <div className="flex flex-wrap items-center gap-x-7 gap-y-3">
          <span className="text-[11px] font-medium uppercase tracking-[0.15em] text-muted-foreground">
            数据覆盖
          </span>
          {DATA_SOURCES.map((s) => (
            <span key={s} className="text-sm font-medium text-foreground/70">
              {s}
            </span>
          ))}
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-x-7 gap-y-3 border-t border-border pt-6">
          <span className="text-[11px] font-medium uppercase tracking-[0.15em] text-muted-foreground">
            被技术团队用于选型尽调
          </span>
          {Array.from({ length: 4 }).map((_, i) => (
            <span
              key={i}
              className="grid h-7 w-28 place-items-center rounded-md border border-dashed border-border text-[11px] text-muted-foreground/60"
            >
              客户 Logo · 上线后填充
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

const PAINS = [
  {
    icon: IconScale,
    tint: "bg-primary/15 text-primary",
    title: "许可证踩雷",
    desc: "AGPL/GPL 商用风险难评估，引入后才被法务叫停。",
  },
  {
    icon: IconSkull,
    tint: "bg-amber-400/15 text-amber-500",
    title: "项目停更",
    desc: "维护者流失、Bus Factor=1，接手成本远超预期。",
  },
  {
    icon: IconAlertTriangle,
    tint: "bg-rose-400/15 text-rose-500",
    title: "安全漏洞",
    desc: "CVE 引入后才发现，修复窗口被供应链拖住。",
  },
  {
    icon: IconPuzzle,
    tint: "bg-secondary text-secondary-foreground",
    title: "信息碎片",
    desc: "Star、Issue、Release 到处翻，信息拼不成结论。",
  },
];

export function PainPoints() {
  return (
    <section id="pain" className="mx-auto max-w-6xl px-4 py-24">
      <Reveal>
        <div className="mx-auto max-w-xl text-center">
          <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
            开源选型，靠感觉太危险
          </h2>
          <p className="mt-3 text-muted-foreground">
            Star 数只代表热度，不代表你敢把它放进生产环境。
          </p>
        </div>
      </Reveal>
      <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {PAINS.map((p, i) => (
          <Reveal key={p.title} delay={i * 90}>
            <div className="h-full rounded-2xl border border-border bg-card p-6 backdrop-blur-md transition-colors hover:bg-card">
              <div className={`grid size-10 place-items-center rounded-xl ${p.tint}`}>
                <p.icon size={20} />
              </div>
              <h3 className="mt-4 font-display text-lg font-semibold">{p.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{p.desc}</p>
            </div>
          </Reveal>
        ))}
      </div>
      <Reveal className="mt-10 text-center">
        <a
          href="#product"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-secondary-foreground transition-colors hover:text-foreground"
        >
          看异动是怎么判定的
          <ArrowGlyph />
        </a>
      </Reveal>
    </section>
  );
}

function ArrowGlyph() {
  return <span aria-hidden>→</span>;
}

const SOLUTIONS = [
  {
    icon: IconGauge,
    tint: "from-primary to-primary/70",
    title: "异动检测",
    desc: "增速断崖、维护停滞、许可证变更，实时识别下行信号。",
    href: "#product",
  },
  {
    icon: IconRadio,
    tint: "from-primary/70 to-primary",
    title: "证据时间轴",
    desc: "stargazer 到达时间戳公开，任一周增量都能自己重算。",
    href: "#product",
  },
  {
    icon: IconColumns3,
    tint: "from-primary to-primary/70",
    title: "对比中心",
    desc: "并排评估候选项目，差异一目了然。",
    href: "#product",
  },
  {
    icon: IconBell,
    tint: "from-destructive/80 to-primary",
    title: "风险订阅",
    desc: "引入后持续监控许可证、CVE 与维护风险。",
    href: "#product",
  },
];

export function Solutions() {
  return (
    <section id="solutions" className="mx-auto max-w-6xl px-4 py-24">
      <Reveal>
        <div className="mx-auto max-w-xl text-center">
          <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
            从发现到决策，一个工作流
          </h2>
        </div>
      </Reveal>
      <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {SOLUTIONS.map((s, i) => (
          <Reveal key={s.title} delay={i * 90}>
            <a
              href={s.href}
              className="block h-full rounded-2xl border border-border bg-card p-6 backdrop-blur-md transition-colors hover:bg-card"
            >
              <div className={`grid size-11 place-items-center rounded-xl bg-gradient-to-br text-primary-foreground ${s.tint}`}>
                <s.icon size={20} />
              </div>
              <h3 className="mt-4 font-display text-lg font-semibold">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.desc}</p>
              <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-secondary-foreground">
                查看详情 <ArrowGlyph />
              </span>
            </a>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

const WORKFLOW = [
  {
    step: "01",
    title: "描述需求",
    desc: "自然语言输入，“自托管、MIT、支持 Docker”。",
  },
  {
    step: "02",
    title: "AI 筛选与尽调",
    desc: "周增量、加速度、贡献者与许可证，逐项原始量 + 采集时间。",
  },
  {
    step: "03",
    title: "对比与报告",
    desc: "团队评审 + 决策记录，生成尽调报告并订阅风险告警。",
  },
];

export function Workflow() {
  return (
    <section id="workflow" className="mx-auto max-w-6xl px-4 py-24">
      <Reveal>
        <div className="mx-auto max-w-xl text-center">
          <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
            3 步完成一次选型尽调
          </h2>
        </div>
      </Reveal>
      <div className="mt-12 grid gap-5 md:grid-cols-3">
        {WORKFLOW.map((w, i) => (
          <Reveal key={w.step} delay={i * 100}>
            <div className="relative h-full rounded-2xl border border-border bg-card p-6 backdrop-blur-md">
              <span className="font-display text-4xl font-bold text-foreground/10">{w.step}</span>
              <h3 className="mt-3 font-display text-lg font-semibold">{w.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{w.desc}</p>
            </div>
          </Reveal>
        ))}
      </div>
      <Reveal className="mt-10 text-center">
        <a
          href="#pricing"
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition-opacity hover:opacity-90"
        >
          免费开始 <ArrowGlyph />
        </a>
      </Reveal>

      {/* 产品示意：AI 对话 + 评分卡 + 报告预览 */}
      <Reveal delay={120} className="mt-14">
        <div className="overflow-hidden rounded-2xl border border-border bg-card backdrop-blur-xl">
          <div className="flex items-center gap-1.5 border-b border-border px-4 py-3">
            <span className="size-2.5 rounded-full bg-rose-400/70" />
            <span className="size-2.5 rounded-full bg-amber-400/70" />
            <span className="size-2.5 rounded-full bg-emerald-400/70" />
            <span className="ml-3 text-xs text-muted-foreground">radar.openmcp.cn · 判定流程</span>
          </div>
          <div className="grid gap-4 p-5 md:grid-cols-3">
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">需求输入</p>
              <p className="mt-2.5 rounded-lg border border-border bg-card p-2.5 text-[13px] leading-relaxed">
                监控 project-a 与另外 14 个已引入项目。
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {["license", "maintainer", "release", "star 增速"].map((t) => (
                  <span key={t} className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
                    {t}
                  </span>
                ))}
              </div>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">生命体征</p>
              <div className="mt-3 space-y-2.5">
                {[
                  { label: "周 star 增量", v: "+218", pct: 82, tone: "bg-radar-up" },
                  { label: "增速加速度", v: "+5.8%", pct: 34, tone: "bg-radar-up" },
                  { label: "周 release", v: "0", pct: 8, tone: "bg-border" },
                  { label: "活跃贡献者", v: "3", pct: 22, tone: "bg-radar-down" },
                ].map((r) => (
                  <div key={r.label}>
                    <div className="flex justify-between text-[11px]">
                      <span className="text-muted-foreground">{r.label}</span>
                      <span className="font-display font-semibold tabular-nums">{r.v}</span>
                    </div>
                    <div className="mt-1 h-1 rounded-full bg-border">
                      <div className={`h-full rounded-full ${r.tone}`} style={{ width: `${r.pct}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">异动结论</p>
              <div className="mt-2.5 space-y-2 text-[12px] leading-relaxed text-muted-foreground">
                <p className="radar-alert-bar rounded-lg border border-border bg-card py-2 pl-3 pr-2.5">
                  触发「维护停滞」：周 release 为 0，距上次发布 214 天
                </p>
                <p>· 近 3 周 star 增速：+184 / +206 / +218</p>
                <p>· 许可证：MIT（2026-03 变更过一次）</p>
                <p>· Top 3 贡献者中 2 人超 150 天无提交</p>
                <p className="flex items-center gap-2 pt-1">
                  <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">可导出</span>
                  <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-secondary-foreground">可订阅</span>
                </p>
              </div>
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
