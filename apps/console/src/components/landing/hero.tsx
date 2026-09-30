"use client"

import { IconArrowRight, IconRadio, IconTrendingDown, IconTrendingUp } from "@tabler/icons-react";

/**
 * 首屏 = 实时异动 feed（docs/design/CONSOLE_RADAR_COMMERCIAL_PLAN.md §5.9.4）
 *
 * 首屏不放评分，也不放价值主张，放真实数据。这既是与 apps/web 最快的辨识手段
 * （一眼看出这不是商城），也是最强的获客钩子——真实项目名天然含长尾关键词。
 *
 * 涨跌按中文金融直觉：红涨绿跌（§5.9.3 方案 A）。风险信号不靠颜色，靠
 * AlertTriangle 图标 + 文案标签 + 左侧 2px 色条。
 */

type Direction = "down" | "up";

type Anomaly = {
  repo: string;
  kind: "断崖" | "停滞" | "加速" | "许可证变更";
  direction: Direction;
  /** 周增量的绝对值。排序与展示都用它，避免小基数百分比霸榜。 */
  delta: number;
  /** 近三周同口径的周增量，用于画迷你时间轴。 */
  series: [number, number, number];
  evidence: string;
  scanned: string;
};

const ANOMALIES: Anomaly[] = [
  {
    repo: "acme/k8s-operator",
    kind: "断崖",
    direction: "down",
    delta: -142,
    series: [318, 176, 0],
    evidence: "近 3 周增速单调下降；最近一次 release 已 214 天",
    scanned: "14 分钟前",
  },
  {
    repo: "vendor/legacy-gateway",
    kind: "停滞",
    direction: "down",
    delta: -8,
    series: [12, 9, 1],
    evidence: "Top 3 贡献者中 2 人超 150 天无 commit",
    scanned: "21 分钟前",
  },
  {
    repo: "lab/vector-store",
    kind: "加速",
    direction: "up",
    delta: 267,
    series: [41, 96, 308],
    evidence: "4 周内周增速连续 3 周翻倍，maintainer 响应中位数 2 小时",
    scanned: "38 分钟前",
  },
  {
    repo: "core/parser-bundle",
    kind: "许可证变更",
    direction: "down",
    delta: -63,
    series: [201, 184, 138],
    evidence: "licenseSpdxId 由 MIT → BUSL-1.1，附带商业使用限制",
    scanned: "1 小时前",
  },
  {
    repo: "ops/queue-agent",
    kind: "加速",
    direction: "up",
    delta: 194,
    series: [28, 74, 222],
    evidence: "发布节奏由 6 周缩短至 9 天，CVE 修复响应中位数 1 天",
    scanned: "2 小时前",
  },
];

/** 迷你时间轴。三周增量，柱高按本条序列的峰值归一，避免跨条目视觉误导。 */
function Sparkbars({ series, direction }: { series: Anomaly["series"]; direction: Direction }) {
  const peak = Math.max(...series.map(Math.abs), 1);
  const tone = direction === "up" ? "bg-radar-up" : "bg-radar-down";

  return (
    <span className="flex h-6 items-end gap-[3px]" aria-hidden>
      {series.map((v, i) => (
        <span
          key={i}
          className={`w-1.5 rounded-sm ${v === 0 ? "bg-border" : tone}`}
          style={{ height: `${Math.max(12, (Math.abs(v) / peak) * 100)}%`, opacity: v === 0 ? 0.4 : 0.45 + i * 0.22 }}
        />
      ))}
    </span>
  );
}

export function Hero() {
  return (
    <section id="top" className="relative overflow-hidden">
      <div className="mx-auto grid max-w-6xl items-start gap-12 px-4 pb-20 pt-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:pt-24">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full border border-glass-border bg-glass px-3 py-1 text-xs text-muted-foreground backdrop-blur-md">
            <span className="relative flex size-1.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-radar-up opacity-60" />
              <span className="relative inline-flex size-1.5 rounded-full bg-radar-up" />
            </span>
            实时异动
          </span>

          <h1 className="mt-5 font-display text-5xl font-bold leading-[1.08] tracking-tight lg:text-6xl">
            别人告诉你它多受欢迎，
            <br />
            我们告诉你它正在
            <span className="text-gradient-brand">变坏</span>。
          </h1>

          <p className="mt-5 max-w-md text-base leading-relaxed text-muted-foreground">
            逐个记录 stargazer 的到达时间，算出增速、加速度与下行异动。增速断崖、维护停滞、许可证变更——全部免费公开，每条结论都能点开看原始时间轴。
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-4">
            <a
              href="#anomalies"
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-brand to-brand2 px-6 py-3 text-sm font-semibold text-primary-foreground shadow-xl shadow-brand/25 transition-opacity hover:opacity-90"
            >
              看今天的异动
              <IconArrowRight size={16} />
            </a>
            <a
              href="#pricing"
              className="inline-flex items-center gap-2 rounded-xl border border-glass-border bg-glass px-6 py-3 text-sm font-medium text-foreground backdrop-blur-md transition-colors hover:bg-glass-strong"
            >
              监控我的项目
            </a>
          </div>

          <p className="mt-4 text-xs text-muted-foreground">
            榜单、异动、尽调全部免费公开 · 无需信用卡
          </p>

          <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-glass-border pt-6 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <IconTrendingUp size={13} className="text-radar-up" />
              <span className="text-radar-up">红</span> = 涨 / 加速
            </span>
            <span className="flex items-center gap-1.5">
              <IconTrendingDown size={13} className="text-radar-down" />
              <span className="text-radar-down">绿</span> = 跌 / 衰退
            </span>
          </div>
        </div>

        {/* 实时异动 feed。匿名可看，不需要登录——这是获客漏斗的最上层。 */}
        <div id="anomalies" className="animate-floaty scroll-mt-24">
          <div className="rounded-2xl border border-glass-border bg-glass p-5 shadow-2xl shadow-black/20 backdrop-blur-xl dark:shadow-black/40">
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-sm font-semibold">
                <IconRadio size={15} className="text-aqua" />
                异动流
              </span>
              <span className="rounded-full border border-glass-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                最近 24 小时
              </span>
            </div>

            <div className="mt-4 space-y-2.5">
              {ANOMALIES.map((a) => (
                <article
                  key={a.repo}
                  className="radar-alert-bar rounded-xl border border-glass-border bg-glass py-3.5 pl-4 pr-3.5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="truncate font-mono text-[13px] font-semibold">{a.repo}</span>
                        <span className="inline-flex items-center gap-1 rounded-md bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                          {a.direction === "up" ? (
                            <IconTrendingUp size={10} />
                          ) : (
                            <IconTrendingDown size={10} />
                          )}
                          {a.kind}
                        </span>
                      </div>
                      <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">{a.evidence}</p>
                    </div>

                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      <span
                        className={`font-display text-lg font-bold tabular-nums ${
                          a.direction === "up" ? "text-radar-up" : "text-radar-down"
                        }`}
                      >
                        {a.delta > 0 ? "+" : ""}
                        {a.delta}
                      </span>
                      <Sparkbars series={a.series} direction={a.direction} />
                    </div>
                  </div>
                  <p className="mt-2 text-[10px] text-muted-foreground/80">周增量 · 采集于 {a.scanned}</p>
                </article>
              ))}
            </div>

            <p className="mt-4 rounded-lg border border-glass-border bg-glass px-3 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
              按<b className="font-medium text-foreground">周增量绝对值</b>排序，不用百分比——小基数项目的百分比会骗人。
            </p>

            <a
              href="#pricing"
              className="mt-3 flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-brand to-brand2 py-2.5 text-[13px] font-semibold text-primary-foreground transition-opacity hover:opacity-90"
            >
              把我的项目加进监控
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
