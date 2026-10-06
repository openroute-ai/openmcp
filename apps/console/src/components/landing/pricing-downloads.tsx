"use client"

import { useState, type FormEvent } from "react";
import { IconDownload, IconMail } from "@tabler/icons-react";
import { FaqAccordion } from "@/components/faq/faq-accordion";
import { ContactDialog } from "@/components/landing/contact-dialog";
import { Reveal } from "@/hooks/use-reveal";
import { LocaleLink } from "@/i18n/navigation";
import { FAQS } from "@/lib/faq";

interface Tier {
  name: string;
  price: string;
  suffix: string;
  desc: string;
  features: string[];
  cta: string;
  href: string;
  featured: boolean;
  /**
   * The button opens the WeChat dialog instead of following `href`.
   *
   * Enterprise is the one tier whose next step is a conversation rather than a
   * checkout, and "预约演示" used to mean a form, a schedule and a wait — which
   * is the slowest possible answer on a site that argues its data is free and
   * readable now.
   */
  contact?: boolean;
}

/**
 * 「更多资源」三条，指向已经存在的页面。
 *
 * 这三个标签以前是三个 `href="#"`：文字看起来完整，点下去没有反应。它们最终各自对上一个
 * 真实页面，所以链接本身保留，只把落点补上。
 */
const MORE_RESOURCES = [
  { label: "开源选型指南", href: "/guide" },
  { label: "本周飙升榜", href: "/rankings/rising" },
  { label: "API 文档", href: "/docs" },
];

const TIERS: Tier[] = [
  {
    name: "免费",
    price: "¥0",
    suffix: "",
    desc: "个人永久使用，不限次数",
    features: [
      "全部榜单与异动",
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
    cta: "联系团队",
    href: "#download",
    featured: false,
    contact: true,
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
    contact: true,
  },
];

export function Pricing() {
  return (
    <section id="pricing" className="mx-auto max-w-6xl px-4 py-24">
      <Reveal>
        <div className="mx-auto max-w-xl text-center">
          <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
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
                <span className="mb-3 w-fit rounded-full bg-primary/15 px-2.5 py-1 text-[11px] font-semibold text-primary">
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
              {t.contact ? (
                <ContactDialog
                  label={t.cta}
                  className={`mt-6 block w-full rounded-xl py-2.5 text-center text-sm font-medium transition-opacity ${
                    t.featured
                      ? "bg-primary font-semibold text-primary-foreground hover:opacity-90"
                      : "border border-border bg-card text-foreground hover:bg-card"
                  }`}
                />
              ) : (
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
              )}
            </div>
          </Reveal>
        ))}
      </div>
      <Reveal className="mt-6 text-center">
        <div className="space-y-2 text-center">
          <p className="text-xs text-muted-foreground">榜单、异动、生命体征、证据时间轴都免费</p>
          <p className="text-xs text-muted-foreground/80">付费计划支持 14 天无理由退款 · 年付享 8 折</p>
        </div>
      </Reveal>
    </section>
  );
}

export function ReportDownload() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">(
    "idle"
  );

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.includes("@") || status === "sending") return;
    setStatus("sending");
    try {
      const response = await fetch("/api/newsletter/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, source: "landing-report" }),
      });
      setStatus(response.ok ? "done" : "error");
    } catch {
      setStatus("error");
    }
  };

  return (
    <section id="download" className="mx-auto max-w-6xl px-4 py-24">
      <Reveal>
        <div className="rounded-3xl border border-border bg-card p-8 text-center backdrop-blur-xl md:p-14">
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground">
            <IconDownload size={13} className="text-secondary-foreground" />
            免费资源
          </span>
          <h2 className="mt-5 font-display text-2xl font-bold tracking-tight sm:text-3xl">
            免费下载：2026 AI Agent 框架异动观察
          </h2>
          <p className="mt-3 text-sm text-muted-foreground">
            对比 12 个项目 · 逐项原始量 · 含原始时间轴与证据来源
          </p>
          {status === "done" ? (
            <p className="mx-auto mt-8 max-w-md rounded-xl border border-border bg-card px-5 py-4 text-sm text-foreground">
              已订阅！报告入口与本周周刊已发送到 <span className="font-medium">{email}</span>。
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
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setStatus("idle");
                  }}
                  disabled={status === "sending"}
                  placeholder="name@company.com"
                  className="w-full rounded-xl border border-border bg-card py-3 pl-10 pr-4 text-sm outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary disabled:opacity-60"
                />
              </div>
              <button
                type="submit"
                disabled={status === "sending"}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {status === "sending" ? "发送中…" : "订阅并获取"} <span aria-hidden>→</span>
              </button>
            </form>
          )}
          {status === "error" && (
            <p className="mt-3 text-xs text-destructive">
              提交失败，请稍后重试，或直接到「关于我们」页面联系我们。
            </p>
          )}
          <p className="mt-4 text-xs text-muted-foreground/80">
            提交即表示同意接收选型周刊，可随时退订。
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 border-t border-border pt-8 text-sm">
            <span className="text-[11px] font-medium uppercase tracking-[0.15em] text-muted-foreground">
              更多资源
            </span>
            {MORE_RESOURCES.map((r) => (
              <a
                key={r.href}
                href={r.href}
                className="font-medium text-secondary-foreground transition-colors hover:text-foreground"
              >
                {r.label}
              </a>
            ))}
          </div>
        </div>
      </Reveal>
    </section>
  );
}

const FAQS_PREVIEW = FAQS.slice(0, 5)

export function Faq() {
  return (
    <section id="faq" className="mx-auto max-w-3xl px-4 py-24">
      <Reveal>
        <div className="text-center">
          <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">常见问题</h2>
        </div>
      </Reveal>
      <Reveal delay={80}>
        <FaqAccordion items={FAQS_PREVIEW} />
      </Reveal>
      <Reveal className="mt-8 text-center">
        <LocaleLink
          href="/faq"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-secondary-foreground transition-colors hover:text-foreground"
        >
          查看全部 {FAQS.length} 个问题 <span aria-hidden>→</span>
        </LocaleLink>
      </Reveal>
    </section>
  )
}


export function FinalCta() {
  return (
    <section className="mx-auto max-w-6xl px-4 pb-24">
      <Reveal>
        <div className="rounded-3xl p-1">
          <div className="rounded-[calc(1.5rem-4px)] border border-border bg-card/85 p-8 text-center backdrop-blur-xl md:p-14">
            {/* Foreground tokens, not `primary-foreground`: this panel sits on
                `bg-card`, and `primary-foreground` is the near-white that belongs
                on `bg-primary`, so on the light theme it rendered white on white. */}
            <h2 className="font-display text-2xl font-bold tracking-tight text-foreground md:text-3xl">
              下一次技术选型，先来看它是不是在变坏。
            </h2>
            <p className="mt-3 text-sm text-muted-foreground">
              免费，无需信用卡
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
              <a
                href="#pricing"
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-xl shadow-primary/20 transition-opacity hover:opacity-90"
              >
                看看今天的异动 <span aria-hidden>→</span>
              </a>
              {/* Was "预约企业演示": a demo is a scheduled meeting, and the
                  panel's own sentence is that the data is readable right now.
                  The way to talk to us is now a WeChat id, not a booking form. */}
              <ContactDialog
                label="联系团队"
                className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-6 py-3 text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              />
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
