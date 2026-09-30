"use client"

import { useState } from "react";
import { IconCheck, IconMinus } from "@tabler/icons-react";
import { Reveal } from "@/hooks/use-reveal";

const COMPARISON_ROWS: [string, string, string][] = [
  ["信息收集", "2-3 天，到处翻", "异动流直接看"],
  ["判断依据", "star 总数 + 主观印象", "stargazer 到达时间戳"],
  ["趋势方向", "只能看涨", "涨速、下行、停滞都报"],
  ["结论核验", "信别人的榜单", "自己从时间戳重算"],
  ["团队决策", "散落群聊 / 文档", "工作台 + 决策记录"],
  ["风险时点", "引入后才发现", "引入前预警 + 持续监控"],
];

export function Comparison() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-24">
      <Reveal>
        <div className="mx-auto max-w-xl text-center">
          <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
            为什么只看 star 数会看错？
          </h2>
        </div>
      </Reveal>
      <Reveal delay={100} className="mt-12">
        <div className="overflow-x-auto rounded-2xl border border-glass-border bg-glass backdrop-blur-xl">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead>
              <tr className="border-b border-glass-border text-[13px]">
                <th className="px-5 py-4 font-medium text-muted-foreground"></th>
                <th className="px-5 py-4 font-medium text-muted-foreground">传统方式</th>
                <th className="px-5 py-4 font-semibold text-foreground">OpenMCP 雷达</th>
              </tr>
            </thead>
            <tbody>
              {COMPARISON_ROWS.map(([k, old, neu]) => (
                <tr key={k} className="border-b border-glass-border last:border-0">
                  <td className="px-5 py-4 font-medium">{k}</td>
                  <td className="px-5 py-4 text-muted-foreground">
                    <span className="inline-flex items-center gap-2">
                      <IconMinus size={13} className="text-rose-400/70" />
                      {old}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    <span className="inline-flex items-center gap-2">
                      <span className="grid size-4 place-items-center rounded-full bg-muted text-muted-foreground">
                        <IconCheck size={10} />
                      </span>
                      {neu}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Reveal>
      <Reveal className="mt-10 text-center">
        <a
          href="#pricing"
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-brand to-brand2 px-6 py-3 text-sm font-semibold text-primary-foreground shadow-lg shadow-brand/30 transition-opacity hover:opacity-90"
        >
          免费开始尽调 <span aria-hidden>→</span>
        </a>
      </Reveal>
    </section>
  );
}

const ROLES: { tab: string; title: string; points: string[]; cta: string }[] = [
  {
    tab: "开发者",
    title: "开发者",
    points: [
      "引入前快速评估候选项目的健康度与许可证风险",
      "追问技术细节：性能、中文文档、迁移成本",
      "避免把时间耗在翻 Issue 和 Release Notes 上",
    ],
    cta: "查看开发者方案",
  },
  {
    tab: "技术负责人",
    title: "技术负责人",
    points: [
      "快速筛选符合架构约束的开源项目",
      "生成可分享的尽调报告，推动团队决策",
      "监控已引入项目的许可证、安全和维护风险",
    ],
    cta: "查看技术负责人方案",
  },
  {
    tab: "开源治理 / 法务",
    title: "开源治理 / 法务",
    points: [
      "统一管理许可证策略，自动标记传染性协议",
      "沉淀可审计的引入决策记录与证据链",
      "对供应链风险建立常态化监控",
    ],
    cta: "查看治理方案",
  },
  {
    tab: "投资人",
    title: "投资人",
    points: [
      "评估被投公司技术栈依赖的可持续性",
      "识别关键依赖的社区健康度与维护风险",
      "用结构化评分替代朋友圈式尽职调查",
    ],
    cta: "查看投资人方案",
  },
];

export function Roles() {
  const [active, setActive] = useState(1);
  const role = ROLES[active] ?? ROLES[0]!;

  return (
    <section id="roles" className="mx-auto max-w-6xl px-4 py-24">
      <Reveal>
        <div className="mx-auto max-w-xl text-center">
          <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">谁在用雷达盯项目</h2>
        </div>
      </Reveal>
      <Reveal delay={80}>
        <div className="mt-10 flex flex-wrap justify-center gap-2.5">
          {ROLES.map((r, i) => (
            <button
              key={r.tab}
              type="button"
              onClick={() => setActive(i)}
              className={`rounded-full px-5 py-2 text-sm transition-all ${
                i === active
                  ? "bg-gradient-to-r from-brand to-brand2 font-semibold text-primary-foreground shadow-lg shadow-brand/30"
                  : "border border-glass-border bg-glass text-muted-foreground hover:text-foreground"
              }`}
            >
              {r.tab}
            </button>
          ))}
        </div>
        <div className="mx-auto mt-8 max-w-2xl rounded-2xl border border-glass-border bg-glass p-7 backdrop-blur-xl">
          <h3 className="font-display text-xl font-semibold">{role.title}</h3>
          <ul className="mt-4 space-y-3">
            {role.points.map((p) => (
              <li key={p} className="flex items-start gap-3 text-sm text-muted-foreground">
                <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-aqua/15 text-aqua">
                  <IconCheck size={12} />
                </span>
                {p}
              </li>
            ))}
          </ul>
          <a
            href="#download"
            className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-aqua transition-colors hover:text-foreground"
          >
            {role.cta} <span aria-hidden>→</span>
          </a>
        </div>
      </Reveal>
    </section>
  );
}

const NEUTRALITY = [
  { label: "数据来源可追溯", detail: "每条结论附采集时间和证据来源" },
  { label: "不做加权汇总", detail: "不给综合分，判断权交给你" },
  { label: "下行信号与涨速同权", detail: "报衰不比报喜少" },
  { label: "赞助明确标注", detail: "自然排名与商业推广物理隔离" },
];

export function Neutrality() {
  return (
    <section id="method" className="border-y border-glass-border bg-glass/40 backdrop-blur-sm">
      <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-24 lg:grid-cols-[1fr_auto]">
        <Reveal>
          <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
            商业推广不干预排名，也不用一个分数替你下结论
          </h2>
          <ul className="mt-7 space-y-4">
            {NEUTRALITY.map((n) => (
              <li key={n.label} className="flex items-start gap-3 text-sm">
                <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
                  <IconCheck size={12} />
                </span>
                <span>
                  <span className="font-medium">{n.label}：</span>
                  <span className="text-muted-foreground">{n.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        </Reveal>
        <Reveal delay={120}>
          <div className="flex flex-col gap-3">
            <a
              href="#faq"
              className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-brand to-brand2 px-6 py-3 text-sm font-semibold text-primary-foreground shadow-lg shadow-brand/30 transition-opacity hover:opacity-90"
            >
              查看判定规则 <span aria-hidden>→</span>
            </a>
            <a
              href="#faq"
              className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-glass-border bg-glass px-6 py-3 text-sm font-medium text-foreground transition-colors hover:bg-glass-strong"
            >
              查看数据来源 <span aria-hidden>→</span>
            </a>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

export function Testimonials() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-24">
      <Reveal>
        <div className="mx-auto max-w-xl text-center">
          <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">技术团队怎么说</h2>
          <p className="mt-3 text-sm text-muted-foreground">首批客户证言整理中，正式上线后填充。</p>
        </div>
      </Reveal>
      <div className="mt-12 grid gap-5 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Reveal key={i} delay={i * 90}>
            <div className="h-full rounded-2xl border border-dashed border-glass-border bg-glass/60 p-6 backdrop-blur-md">
              <p className="text-sm leading-relaxed text-muted-foreground/70">“证言占位 — 上线后填充”</p>
              <div className="mt-6 flex items-center gap-3">
                <span className="grid size-9 place-items-center rounded-full border border-dashed border-glass-border text-xs text-muted-foreground/60">
                  头像
                </span>
                <div className="text-[13px] leading-tight text-muted-foreground/70">
                  <p className="font-medium">姓名占位</p>
                  <p>公司 / 职位占位</p>
                </div>
              </div>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
