"use client"

import { IconBrandGithub, IconRss, IconBrandX } from "@tabler/icons-react";

const COLUMNS: { title: string; links: string[] }[] = [
  { title: "产品", links: ["异动流", "生命体征", "证据时间轴", "决策工作台"] },
  { title: "资源", links: ["选型报告", "本周榜单", "API 文档", "评分方法"] },
  { title: "公司", links: ["关于我们", "博客", "联系我们", "加入我们"] },
  { title: "法律", links: ["隐私政策", "服务条款", "安全声明", "开源许可"] },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-glass-border">
      <div className="mx-auto max-w-6xl px-4 py-12">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-5">
          <div className="lg:col-span-1">
            <div className="flex items-center gap-2.5">
              <span className="grid size-8 place-items-center rounded-lg bg-gradient-to-br from-brand to-aqua font-display text-sm font-bold text-primary-foreground">
                V
              </span>
              <span className="font-display text-base font-semibold">OpenMCP 雷达</span>
            </div>
            <p className="mt-4 max-w-[30ch] text-sm leading-relaxed text-muted-foreground">
              记录 stargazer 到达时间，判断开源项目正在变好还是变坏。
            </p>
            <div className="mt-5 flex items-center gap-2.5">
              {[IconBrandGithub, IconBrandX, IconRss].map((Icon, i) => (
                <a
                  key={i}
                  href="#"
                  aria-label={["GitHub", "X/Twitter", "RSS"][i]}
                  className="grid size-8 place-items-center rounded-lg border border-glass-border bg-glass text-muted-foreground transition-colors hover:text-foreground"
                >
                  <Icon size={14} />
                </a>
              ))}
            </div>
          </div>

          {COLUMNS.map((col) => (
            <div key={col.title}>
              <p className="text-sm font-semibold">{col.title}</p>
              <ul className="mt-4 space-y-2.5 text-sm text-muted-foreground">
                {col.links.map((l) => (
                  <li key={l}>
                    <a href="#" className="transition-colors hover:text-foreground">
                      {l}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-10 flex flex-col items-start justify-between gap-3 border-t border-glass-border pt-6 text-xs text-muted-foreground sm:flex-row sm:items-center">
          <p>© 2026 OpenMCP 雷达 · radar.openmcp.cn</p>
          <div className="flex items-center gap-4">
            <span className="inline-flex items-center gap-1.5 rounded-md border border-glass-border bg-glass px-2.5 py-1">
              简体中文
              <span aria-hidden>▾</span>
            </span>
            <span>中立、可追溯、为决策而生</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
