"use client"

import { IconBrandGithub } from "@tabler/icons-react";

import { RadarLogo } from "@/components/brand/radar-logo";
import { LocaleLink } from "@/i18n/navigation";
import { SITE_HOST, SITE_NAME, SITE_TAGLINE } from "@/lib/config/site";

/**
 * 页脚。
 *
 * 这里的每一项都是一个真实存在的页面，没有占位符：曾经这一列是十几个 `href="#"`，
 * 它们看起来像一个站点该有的样子，但点下去什么都不发生——而一个点不动的链接比一个
 * 缺失的链接更糟，它让访客以为信息存在、只是自己没找到。所以没有对应页面的条目直接
 * 不列，而不是列一条死链。
 *
 * 社交图标同理：只保留指向真实仓库的 GitHub。早先还有 X 和 RSS 两个图标指向
 * `href="#"`，因为「应该有」而被放进去——一个不存在的账号比不提供这个入口更不诚实。
 */

const COLUMNS: { title: string; links: { label: string; href: string }[] }[] = [
  {
    title: "产品",
    links: [
      { label: "异动流", href: "/anomalies" },
      { label: "公开榜单", href: "/rankings" },
      { label: "本周飙升榜", href: "/rankings/rising" },
      { label: "判定规则", href: "/method" },
      { label: "决策工作台", href: "/console/decisions" },
    ],
  },
  {
    title: "资源",
    links: [
      { label: "开源选型指南", href: "/guide" },
      { label: "常见问题", href: "/faq" },
      { label: "API 文档", href: "/docs" },
      { label: "博客", href: "/blog" },
    ],
  },
  {
    title: "公司",
    links: [
      { label: "关于我们", href: "/about" },
      { label: "联系我们", href: "/contact" },
      { label: "AI 网关", href: "https://www.openroute.cn" },
      { label: "OpenMCP", href: "https://www.openmcp.cn" },
      { label: "Agent 沙箱", href: "https://www.gpurun.cn" },
    ],
  },
  {
    title: "法律",
    links: [
      { label: "隐私政策", href: "/privacy" },
      { label: "服务条款", href: "/terms" },
      { label: "安全声明", href: "/security" },
      { label: "开源许可", href: "/license" },
    ],
  },
];

const GITHUB_URL = "https://github.com/openroute-ai/openmcp";

export function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto max-w-6xl px-4 py-12">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-5">
          <div className="lg:col-span-1">
            <div className="flex items-center gap-2.5">
              <RadarLogo className="size-5" />
              <span className="font-display text-base font-semibold">{SITE_NAME}</span>
            </div>
            <p className="mt-4 max-w-[30ch] text-sm leading-relaxed text-muted-foreground">
              {SITE_TAGLINE}
            </p>
            <div className="mt-5 flex items-center gap-2.5">
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="GitHub 仓库"
                className="grid size-8 place-items-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:text-foreground"
              >
                <IconBrandGithub size={14} />
              </a>
            </div>
          </div>

          {COLUMNS.map((col) => (
            <div key={col.title}>
              <p className="text-sm font-semibold">{col.title}</p>
              <ul className="mt-4 space-y-2.5 text-sm text-muted-foreground">
                {col.links.map((link) => (
                  <li key={link.href}>
                    <LocaleLink
                      href={link.href}
                      className="transition-colors hover:text-foreground"
                    >
                      {link.label}
                    </LocaleLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-10 flex flex-col items-start justify-between gap-3 border-t border-border pt-6 text-xs text-muted-foreground sm:flex-row sm:items-center">
          <p>© 2026 {SITE_NAME} · {SITE_HOST}</p>
          <div className="flex items-center gap-4">
            {/* 静态文字，不带下拉箭头：这里没有可点的语言切换器，一个假的
                下拉箭头会让访客去找一个不存在的控件。 */}
            <span className="rounded-md border border-border bg-card px-2.5 py-1">
              简体中文
            </span>
            <span>中立、可追溯、为决策而生</span>
          </div>
        </div>

        {/* 备案号按主管部门要求挂在页脚，并链到各自的查询入口——链过去能核验，
            只印一串数字的话它既不能自查也不能被别人核实。 */}
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <a
            href="https://beian.miit.gov.cn/"
            target="_blank"
            rel="noopener noreferrer"
            className="transition-colors hover:text-foreground"
          >
            津ICP备2023007973号-6
          </a>
          <a
            href="https://www.beian.gov.cn/portal/registerSystemInfo?recordcode=12011402001495"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
          >
            {/* 公安备案的徽标，与备案号一起展示；图省事用普通 img，它有固定像素尺寸、
                不需要 next/image 的响应式包装。 */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/images/gongan.webp"
              alt=""
              width={16}
              height={17}
              className="inline-block"
            />
            津公网安备12011402001495号
          </a>
        </div>
      </div>
    </footer>
  );
}
