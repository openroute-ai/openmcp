"use client"

import {
  IconAlertTriangle,
  IconArrowDownRight,
  IconArrowRight,
  IconCheck,
  IconCopy,
  IconInfoCircle,
  IconLicense,
  IconPlayerSkipForward,
  IconRadar,
  IconTrendingDown,
  IconTrendingUp,
} from "@tabler/icons-react"
import { useState } from "react"

import { LocaleLink } from "@/i18n/navigation"
import type { AnomalyKind } from "@/db/schema/github"
import type { AnomalyWithRepo } from "@/lib/radar/anomalies"

/**
 * 首屏 = 实时异动 feed + 给 agent 的指令（docs/design/CONSOLE_RADAR_COMMERCIAL_PLAN.md §5.9.4）
 *
 * 版式参考 novita.ai：居中 H1，副标题，主次双 CTA，紧跟一段面向开发者的可复制
 * 指令，最后一条信任标识带。
 *
 * 首屏的主数据是**真实的异动行**，由 `page.tsx` 在服务端取好后传进来。此前这个位置
 * 摆过一版写死的样例（acme/k8s-operator 之类），后���整块删掉——假数据配「每条结论都能
 * 点开看原始时间轴」这句话，等于在首屏就把唯一的核心承诺作废了。现在数据是同一张
 * `repo_anomalies` 表，与 `/anomalies` 页和 `/api/anomalies.json` 同源，三者不可能
 * 各说各话。
 *
 * 取数在服务端而不是客户端 fetch：这块 feed 的全部说服力在于「这是我们此刻看到的」，
 * 而 hydration 之后才填进来的列表，在读者眼里就是一个演示数据在加载。
 *
 * 颜色约定见本节最下面那条说明带：涨是红、跌是绿，与全球 web 相反。所以每行的
 * 异动类型都带图标 + 文案，颜色只作冗余强化，不承担信息本身。
 */

/** 首屏那一块的时间标注。§5.9.4 要求「必须标注采集时间」，所以它就在 feed 里。 */
function collectedAtLabel(): string {
  return new Date().toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
  })
}

/**
 * 一行异动：图标 + 类型 + 仓库 + 幅度。
 *
 * 幅度带单位，因为断崖的量级是星、停滞的是天，把它们并排放进同一个数字列会诱导
 * 比较（详见 `components/public/anomaly-list.tsx` 的 `FlagStyle`）。
 */
const HERO_KINDS: Record<
  AnomalyKind,
  {
    label: string
    unit: string
    Icon: typeof IconAlertTriangle
    accent: string
    magnitude: (row: AnomalyWithRepo) => number | null
  }
> = {
  star_cliff: {
    label: "增速断崖",
    unit: "星",
    Icon: IconArrowDownRight,
    accent: "text-radar-down border-radar-down",
    magnitude: (row) => row.magnitude,
  },
  star_acceleration: {
    label: "异常加速",
    unit: "星",
    Icon: IconTrendingUp,
    accent: "text-radar-up border-radar-up",
    magnitude: (row) => row.magnitude,
  },
  release_stall: {
    label: "维护停滞",
    unit: "天",
    Icon: IconPlayerSkipForward,
    accent: "text-radar-down border-radar-down",
    magnitude: (row) => row.magnitude,
  },
  commit_stall: {
    label: "推送停滞",
    unit: "天",
    Icon: IconInfoCircle,
    accent: "text-radar-down border-radar-down",
    magnitude: (row) => row.magnitude,
  },
  license_change: {
    label: "许可证变更",
    unit: "",
    Icon: IconLicense,
    accent: "text-amber-600 border-amber-500 dark:text-amber-400",
    magnitude: () => null,
  },
}

/**
 * 首屏那条空态带子，位置在首屏之下。
 *
 * 「没有异动」这句话曾经是首屏里一个虚线小框：视觉上像一条报错，占掉首屏最贵的一块
 * 位置，内容却只有一句话。现在它整条挪到首屏底下的横带里，和「无自定义评分公式」
 * 这类信任标识同一层——它是一个状态说明，不是首屏的主体。
 *
 * 只在 `anomalies` 为空时由 `page.tsx` 渲染；有任何一行异动时首屏照常显示那几行真实
 * 数据，这条带子就不出现（同一个「实时异动」位置出现两种说法会互相拆台）。
 */
export function AnomalyQuietNote() {
  return (
    <div className="border-y border-border bg-card/40 backdrop-blur-sm">
      <div className="mx-auto max-w-6xl px-4 py-6 text-center text-sm text-muted-foreground">
        现在没有检测到异动。这不是没有数据，是这批仓库都健康。
      </div>
    </div>
  )
}

function HeroAnomalyFeed({ anomalies }: { anomalies: AnomalyWithRepo[] }) {
  if (anomalies.length === 0) {
    // 空态交给 {@link AnomalyQuietNote}，它在首屏之外的位置。
    return null
  }

  return (
    <div className="mx-auto mt-14 w-full max-w-2xl">
      <div className="flex items-center gap-2">
        <IconRadar size={14} className="text-muted-foreground" aria-hidden />
        <span className="text-xs font-medium tracking-widest text-muted-foreground uppercase">
          实时异动
        </span>
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          数据截至 {collectedAtLabel()}
        </span>
      </div>

      <ul className="mt-3 grid gap-1.5">
        {anomalies.map((row) => {
          const kind = HERO_KINDS[row.kind]
          const value = kind.magnitude(row)
          return (
            <li
              key={row.id}
              className="flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-xl border border-l-2 border-border bg-card px-3 py-2 text-sm"
            >
              <span
                className={`inline-flex shrink-0 items-center gap-1 rounded-md border border-l-2 px-1.5 py-0.5 text-xs font-medium ${kind.accent}`}
              >
                <kind.Icon size={12} aria-hidden />
                {kind.label}
              </span>
              <LocaleLink
                href={`/projects/${row.owner}/${row.name}`}
                className="font-medium hover:underline"
              >
                {row.owner}/{row.name}
              </LocaleLink>
              <span className="ml-auto text-xs font-semibold tabular-nums">
                {value === null
                  ? "—"
                  : `${Math.round(value).toLocaleString("en-US")} ${kind.unit}`}
              </span>
            </li>
          )
        })}
      </ul>

      <div className="mt-2.5 flex items-center justify-between text-xs text-muted-foreground">
        <span>每条都附触发它的那几个数，不需要相信我们的措辞。</span>
        <LocaleLink
          href="/anomalies"
          className="inline-flex items-center gap-1 hover:text-foreground"
        >
          全部异动
          <IconArrowRight size={13} />
        </LocaleLink>
      </div>
    </div>
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
        <span className="text-xs font-medium tracking-widest text-muted-foreground uppercase">
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
        榜单、分类、详情都是免登录的 JSON 与 HTML，agent
        可以直接读，不需要信用卡。
      </p>
    </div>
  )
}

export function Hero({
  origin,
  anomalies,
}: {
  origin: string
  anomalies: AnomalyWithRepo[]
}) {
  return (
    <section id="top" className="relative overflow-hidden">
      <div className="mx-auto max-w-3xl px-4 pt-14 pb-20 text-center sm:pt-24">
        <h1 className="font-display text-3xl leading-[1.12] font-bold tracking-tight sm:text-5xl">
          别人告诉你它多受欢迎，
          <br />
          我们告诉你它正在<span className="text-primary">变坏</span>。
        </h1>

        <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
          逐个记录 stargazer
          的到达时间，算出增速、加速度与下行异动。增速断崖、维护停滞、许可证变更——全部免费公开，每条结论都能点开看原始时间轴。
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

        <HeroAnomalyFeed anomalies={anomalies} />

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
