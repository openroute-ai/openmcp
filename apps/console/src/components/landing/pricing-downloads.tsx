"use client"

import { useState, type FormEvent } from "react";
import { IconChevronDown, IconDownload, IconMail } from "@tabler/icons-react";
import { Reveal } from "@/hooks/use-reveal";

const TIERS = [
  {
    name: "免费",
    price: "¥0",
    suffix: "",
    desc: "个人永久使用，不限次数",
    features: [
      "全部榜单与异动，免费公开",
      "生命体征与证据时间轴",
      "stargazer 时间序列查询",
      "社区实测记录",
    ],
    cta: "直接开始",
    href: "#download",
    featured: false,
  },
  {
    name: "Pro",
    price: "¥99",
    suffix: "/月",
    desc: "个人监控：盯住自己在用的项目",
    features: ["监控列表与邮件告警", "许可证变更即时推送", "贡献者流失预警", "决策留痕与回访"],
    cta: "开始监控",
    href: "#download",
    featured: true,
  },
  {
    name: "Team",
    price: "¥999",
    suffix: "/月起",
    desc: "组织级监控与协作",
    features: ["团队监控面板与共享告警", "选型评审工作台", "SSO / 审计日志", "私有化部署"],
    cta: "预约演示",
    href: "#download",
    featured: false,
  },
  {
    name: "Enterprise",
    price: "定制",
    suffix: "",
    desc: "内部代码库与合规要求",
    features: ["内部镜像仓库接入", "合规审计导出", "SLA 与专属支持"],
    cta: "联系团队",
    href: "#download",
    featured: false,
  },
];

export function Pricing() {
  return (
    <section id="pricing" className="mx-auto max-w-6xl px-4 py-24">
      <Reveal>
        <div className="mx-auto max-w-xl text-center">
          <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
            信息全部免费，付费只为「持续监控」
          </h2>
        </div>
      </Reveal>
      <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {TIERS.map((t, i) => (
          <Reveal key={t.name} delay={i * 80}>
            <div
              className={`flex h-full flex-col rounded-2xl border p-6 backdrop-blur-xl ${
                t.featured
                  ? "border-primary/50 bg-card shadow-xl shadow-primary/10"
                  : "border-border bg-card"
              }`}
            >
              {t.featured && (
                <span className="mb-3 w-fit rounded-full bg-primary/25 px-2.5 py-1 text-[11px] font-semibold text-primary-foreground">
                  最受欢迎
                </span>
              )}
              <p className="font-display text-lg font-semibold">{t.name}</p>
              <p className="mt-3 font-display text-4xl font-bold tracking-tight">
                {t.price}
                {t.suffix && <span className="text-base font-medium text-muted-foreground">{t.suffix}</span>}
              </p>
              <ul className="mt-5 flex-1 space-y-2.5 text-sm text-muted-foreground">
                {t.features.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              <a
                href={t.href}
                className={`mt-6 block rounded-xl py-2.5 text-center text-sm font-medium transition-opacity ${
                  t.featured
                    ? "bg-primary font-semibold text-primary-foreground hover:opacity-90"
                    : "border border-border bg-card text-foreground hover:bg-card"
                }`}
              >
                {t.cta}
              </a>
            </div>
          </Reveal>
        ))}
      </div>
      <Reveal className="mt-6 text-center">
        <div className="space-y-2 text-center">
          <p className="text-xs text-muted-foreground">榜单、异动、生命体征、证据时间轴全部免费公开，不设付费墙</p>
          <p className="text-xs text-muted-foreground/80">付费计划支持 14 天无理由退款 · 年付享 8 折</p>
        </div>
      </Reveal>
    </section>
  );
}

export function ReportDownload() {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!email.includes("@")) return;
    setDone(true);
  };

  return (
    <section id="download" className="mx-auto max-w-6xl px-4 py-24">
      <Reveal>
        <div className="rounded-3xl border border-border bg-card p-8 text-center backdrop-blur-xl md:p-14">
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground">
            <IconDownload size={13} className="text-secondary-foreground" />
            免费资源
          </span>
          <h2 className="mt-5 font-display text-3xl font-bold tracking-tight sm:text-4xl">
            免费下载：2026 AI Agent 框架异动观察
          </h2>
          <p className="mt-3 text-sm text-muted-foreground">
            对比 12 个项目 · 逐项原始量 · 含原始时间轴与证据来源
          </p>
          {done ? (
            <p className="mx-auto mt-8 max-w-md rounded-xl border border-border bg-card px-5 py-4 text-sm text-foreground">
              已收到！报告下载链接将发送到 <span className="font-medium">{email}</span>。
            </p>
          ) : (
            <form onSubmit={submit} className="mx-auto mt-8 flex max-w-md flex-col gap-3 sm:flex-row">
              <label className="sr-only" htmlFor="report-email">
                工作邮箱
              </label>
              <div className="relative flex-1">
                <IconMail
                  size={15}
                  className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                />
                <input
                  id="report-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@company.com"
                  className="w-full rounded-xl border border-border bg-card py-3 pl-10 pr-4 text-sm outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary"
                />
              </div>
              <button
                type="submit"
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition-opacity hover:opacity-90"
              >
                立即下载 <span aria-hidden>→</span>
              </button>
            </form>
          )}
          <p className="mt-4 text-xs text-muted-foreground/80">
            提交即表示同意接收选型周刊，可随时退订。
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 border-t border-border pt-8 text-sm">
            <span className="text-[11px] font-medium uppercase tracking-[0.15em] text-muted-foreground">
              更多资源
            </span>
            {["开源选型指南", "本周飙升榜", "API 文档"].map((r) => (
              <a
                key={r}
                href="#"
                className="font-medium text-secondary-foreground transition-colors hover:text-foreground"
              >
                {r}
              </a>
            ))}
          </div>
        </div>
      </Reveal>
    </section>
  );
}

const FAQS: [string, string][] = [
  [
    "数据从哪里来？",
    "覆盖 GitHub、GitLab、Gitee、npm、PyPI、Maven，以及 OSV / NVD 漏洞库，每日更新。每条结论都附采集时间和可点开的证据，避免“一条结论全靠 AI 猜”。",
  ],
  [
    "为什么不给一个综合评分？",
    "我们试过，放弃了。star 多的项目在任何维度上都不会差，于是高分只是在复述「它已经很受欢迎」——把你的问题原样还给你。现在改为逐项原始量（周增量、增速加速度、发布间隔、贡献者活跃度、许可证状态），每项独立可查，判断权交给你。",
  ],
  [
    "结论怎么复现？",
    "雷达记录的是每个 stargazer 的到达时间，不是 star 总数。任取一周的增量都可以从时间戳重新算一遍；贡献者名单与时间序列同样公开，Bus Factor 你可以自己数。",
  ],
  [
    "涨跌颜色为什么和股市软件一样？",
    "红涨绿跌。这是中文用户的默认直觉，用西方惯例（绿涨红跌）会让每次读榜都多一次心算翻转。至于风险告警，我们刻意不用颜色表示——改用图标、标签文字和左侧色条，这样「跌」和「危险」不会被混为一谈。",
  ],
  [
    "和 SCA 工具（Snyk / Sonatype）有什么区别？",
    "SCA 工具在代码层面跑，扫描你已经引入的依赖。雷达面向“引入前”和“引入后仍在维护”的环节：一个项目在你上生产之前就已经在衰退，或者维护者已经散伙——这些信号在 SCA 里看不到，因为代码还在正常跑。",
  ],
  [
    "支持私有化部署吗？",
    "企业版支持私有化部署与内部代码库集成，包含 SSO 和审计日志，可预约演示后按需求报价。",
  ],
];

export function Faq() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section id="faq" className="mx-auto max-w-3xl px-4 py-24">
      <Reveal>
        <div className="text-center">
          <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">常见问题</h2>
        </div>
      </Reveal>
      <Reveal delay={80}>
        <div className="mt-10 space-y-3">
          {FAQS.map(([q, a], i) => {
            const isOpen = open === i;
            return (
              <div
                key={q}
                className={`rounded-xl border backdrop-blur-md transition-colors ${
                  isOpen ? "border-primary/40 bg-card" : "border-border bg-card"
                }`}
              >
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : i)}
                  aria-expanded={isOpen}
                  className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left text-sm font-medium"
                >
                  {q}
                  <IconChevronDown
                    size={16}
                    className={`shrink-0 text-muted-foreground transition-transform duration-300 ${
                      isOpen ? "rotate-180" : ""
                    }`}
                  />
                </button>
                <div
                  className={`grid overflow-hidden transition-all duration-300 ease-out ${
                    isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                  }`}
                >
                  <p className="min-h-0 px-5 pb-4 text-sm leading-relaxed text-muted-foreground">{a}</p>
                </div>
              </div>
            );
          })}
        </div>
      </Reveal>
      <Reveal className="mt-8 text-center">
        <a
          href="#"
          className="text-sm font-semibold text-secondary-foreground transition-colors hover:text-foreground"
        >
          查看全部 FAQ <span aria-hidden>→</span>
        </a>
      </Reveal>
    </section>
  );
}

export function FinalCta() {
  return (
    <section className="mx-auto max-w-6xl px-4 pb-24">
      <Reveal>
        <div className="rounded-3xl bg-border p-1">
          <div className="rounded-[calc(1.5rem-4px)] border border-border bg-card/85 p-8 text-center backdrop-blur-xl md:p-14">
            <h2 className="font-display text-3xl font-bold tracking-tight text-primary-foreground md:text-4xl">
              下一次技术选型，先来看它是不是在变坏。
            </h2>
            <p className="mt-3 text-sm text-primary-foreground/70">
              榜单与异动全部免费公开 · 无需信用卡
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
              <a
                href="#pricing"
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-xl shadow-primary/20 transition-opacity hover:opacity-90"
              >
                看看今天的异动 <span aria-hidden>→</span>
              </a>
              <a
                href="#download"
                className="inline-flex items-center gap-2 rounded-xl border border-primary-foreground/20 bg-primary-foreground/5 px-6 py-3 text-sm font-medium text-primary-foreground/90 transition-colors hover:bg-primary-foreground/10"
              >
                预约企业演示
              </a>
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
