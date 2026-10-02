"use client"

import { useState } from "react";
import { IconCheck, IconMinus } from "@tabler/icons-react";
import { Reveal } from "@/hooks/use-reveal";
import { SITE_NAME } from "@/lib/config/site";

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
          <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
            为什么只看 star 数会看错？
          </h2>
        </div>
      </Reveal>
      <Reveal delay={100} className="mt-12">
        <div className="overflow-x-auto rounded-2xl border border-border bg-card backdrop-blur-xl">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead>
              <tr className="border-b border-border text-[13px]">
                <th className="px-5 py-4 font-medium text-muted-foreground"></th>
                <th className="px-5 py-4 font-medium text-muted-foreground">传统方式</th>
                <th className="px-5 py-4 font-semibold text-foreground">{SITE_NAME}</th>
              </tr>
            </thead>
            <tbody>
              {COMPARISON_ROWS.map(([k, old, neu]) => (
                <tr key={k} className="border-b border-border last:border-0">
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
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition-opacity hover:opacity-90"
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
          <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">谁在用雷达盯项目</h2>
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
                  ? "bg-primary font-semibold text-primary-foreground shadow-lg shadow-primary/20"
                  : "border border-border bg-card text-muted-foreground hover:text-foreground"
              }`}
            >
              {r.tab}
            </button>
          ))}
        </div>
        <div className="mx-auto mt-8 max-w-2xl rounded-2xl border border-border bg-card p-7 backdrop-blur-xl">
          <h3 className="font-display text-lg font-semibold">{role.title}</h3>
          <ul className="mt-4 space-y-3">
            {role.points.map((p) => (
              <li key={p} className="flex items-start gap-3 text-sm text-muted-foreground">
                <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-secondary text-secondary-foreground">
                  <IconCheck size={12} />
                </span>
                {p}
              </li>
            ))}
          </ul>
          <a
            href="#download"
            className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-secondary-foreground transition-colors hover:text-foreground"
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
    <section id="method" className="border-y border-border bg-card/40 backdrop-blur-sm">
      <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-24 lg:grid-cols-[1fr_auto]">
        <Reveal>
          <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
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
              className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition-opacity hover:opacity-90"
            >
              查看判定规则 <span aria-hidden>→</span>
            </a>
            <a
              href="#faq"
              className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-6 py-3 text-sm font-medium text-foreground transition-colors hover:bg-card"
            >
              查看数据来源 <span aria-hidden>→</span>
            </a>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/**
 * 「技术团队怎么说」。
 *
 * 三条按角色归纳、不具名的说法。角色是真的（技术总监、架构师、技术负责人），引述里
 * 不写公司名、不写数字：一个没人能核实的客户名和一句「某客户节省 40% 选型时间」比这里
 * 留白更糟——它会被截图、被当作事实引用，而这个站点的全部卖点就是每条结论都能复核。
 * 换成具名证言时，把角色一并换掉，别只换名字。
 */
const VOICES = [
  {
    initials: "总",
    role: "技术总监",
    org: "AI 公司 · 基础设施",
    quote:
      "我们内部周会看飙升榜。200 星那道门槛是团队自己定的，不是榜上写的，正好把「所有人都在抢的」和「我们真正该看的」分开。",
  },
  {
    initials: "架",
    role: "架构师",
    org: "企业软件",
    quote:
      "选型会里我不再维护那张表了。同一个接口给我绝对增量和涨幅两个口径，剩下的判断是我做的，不是榜单替我做的。",
  },
  {
    initials: "负",
    role: "技术负责人",
    org: "开源项目",
    quote:
      "最有用的是停更提示。我们自己知道有人在休假，系统不知道；它连着四周没提交，会提醒我该换 reviewer 了。",
  },
]

export function Testimonials() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-24">
      <Reveal>
        <div className="mx-auto max-w-xl text-center">
          <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">技术团队怎么说</h2>
          <p className="mt-3 text-sm text-muted-foreground">按角色归纳，未具名。</p>
        </div>
      </Reveal>
      <div className="mt-12 grid gap-5 md:grid-cols-3">
        {VOICES.map((voice, i) => (
          <Reveal key={voice.role} delay={i * 90}>
            <figure className="flex h-full flex-col rounded-2xl border border-border bg-card/60 p-6 backdrop-blur-md">
              <blockquote className="text-sm leading-relaxed text-muted-foreground">
                “{voice.quote}”
              </blockquote>
              <figcaption className="mt-6 flex items-center gap-3">
                <span className="grid size-9 place-items-center rounded-full bg-secondary/70 text-xs font-medium text-secondary-foreground">
                  {voice.initials}
                </span>
                <span className="text-[13px] leading-tight">
                  <span className="block font-medium">{voice.role}</span>
                  <span className="text-muted-foreground">{voice.org}</span>
                </span>
              </figcaption>
            </figure>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
