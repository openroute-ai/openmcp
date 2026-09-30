"use client"

import { IconArrowRight, IconCheck, IconCopy, IconTrendingDown, IconTrendingUp } from "@tabler/icons-react"
import { useState } from "react"

import { LocaleLink } from "@/i18n/navigation"

/**
 * 首屏 = 产品入口 + 价值主张 + 给 agent 的指令（docs/design/CONSOLE_RADAR_COMMERCIAL_PLAN.md §5.9.4）
 *
 * 版式参考 novita.ai：顶部一排产品入口，居中 H1，副标题，主次双 CTA，
 * 紧跟一段面向开发者的可复制指令，最后一条信任标识带。全部居中单列。
 *
 * 这一版**移除了此前右侧的实时异动 feed**。它当时承担获客钩子的职责，但那份
 * 数据是写死的 ANOMALIES 样例：项目名是 acme/k8s-operator 这类虚构仓库，
 * 首屏拿假数据当真实信号卖，与「每条结论都能点开看原始时间轴」的核心承诺
 * 直接矛盾。真实异动改为从公开榜单进入，位置见 nav 的「公开榜单」。
 *
 * 首屏用的是原生 shadcn 主题，没有任何自定义配色。
 */

/** 产品入口 pill。 */
const ENTRIES = [
  { href: "/rankings", label: "公开榜单" },
  { href: "/rankings?range=rising", label: "新星榜" },
  { href: "/categories", label: "应用分类" },
] as const

function EntryPill({ href, label }: { href: string; label: string }) {
  return (
    <LocaleLink
      href={href}
      className="rounded-full border border-border bg-card px-4 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
    >
      {label}
    </LocaleLink>
  )
}

/** 给 agent 的指令块。整块可复制，复制成功就换成对勾。 */
function AgentCommand({ origin }: { origin: string }) {
  const [copied, setCopied] = useState(false)
  const command = `curl -s ${origin}/api/rankings/week.json`

  async function copy() {
    try {
      await navigator.clipboard.writeText(command)
      setCopied(true)
      setTimeout(() => setCopied(false), 2_000)
    } catch {
      // 剪贴板不可用（非安全上下文、被策略拒绝）时静默失败：命令本身
      // 已经以文本形式摆在上面，用户可以自己选中复制。
    }
  }

  return (
    <div className="mx-auto mt-16 w-full max-w-2xl text-left">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
          For Agent
        </span>
        <button
          type="button"
          onClick={() => void copy()}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          {copied ? <IconCheck size={13} /> : <IconCopy size={13} />}
          {copied ? "已复制" : "复制"}
        </button>
      </div>

      <pre className="mt-3 overflow-x-auto rounded-xl border border-border bg-card px-4 py-3.5 text-[13px] leading-relaxed">
        <code>{command}</code>
      </pre>

      <p className="mt-2.5 text-xs text-muted-foreground">
        榜单、分类、详情都是免登录的 JSON 与 HTML，agent 可以直接读，不需要信用卡。
      </p>
    </div>
  )
}

export function Hero({ origin }: { origin: string }) {
  return (
    <section id="top" className="relative overflow-hidden">
      <div className="mx-auto max-w-3xl px-4 pb-20 pt-14 text-center sm:pt-24">
        <nav className="flex flex-wrap items-center justify-center gap-2">
          {ENTRIES.map((e) => (
            <EntryPill key={e.href} {...e} />
          ))}
        </nav>

        <h1 className="mt-7 font-display text-4xl font-bold leading-[1.12] tracking-tight sm:text-6xl">
          别人告诉你它多受欢迎，
          <br />
          我们告诉你它正在<span className="text-primary">变坏</span>。
        </h1>

        <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
          逐个记录 stargazer 的到达时间，算出增速、加速度与下行异动。增速断崖、维护停滞、许可证变更——全部免费公开，每条结论都能点开看原始时间轴。
        </p>

        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <LocaleLink
            href="/rankings"
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            看公开榜单
            <IconArrowRight size={16} />
          </LocaleLink>
          <LocaleLink
            href="/categories"
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-6 py-3 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            浏览应用分类
          </LocaleLink>
        </div>

        <p className="mt-4 text-xs text-muted-foreground">
          榜单、异动、尽调全部免费公开 · 无需信用卡
        </p>

        <AgentCommand origin={origin} />
      </div>

      <div className="border-t border-border">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-center gap-x-8 gap-y-2 px-4 py-6 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <IconTrendingUp size={13} className="text-radar-up" />
            <span className="text-radar-up">红</span> = 涨 / 加速
          </span>
          <span className="flex items-center gap-1.5">
            <IconTrendingDown size={13} className="text-radar-down" />
            <span className="text-radar-down">绿</span> = 跌 / 衰退
          </span>
          <span>无自定义评分公式</span>
          <span>无 AI 判定</span>
        </div>
      </div>
    </section>
  )
}
