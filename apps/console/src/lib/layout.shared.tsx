import { ThemeSwitch } from "@/components/theme-switch"
import { RadarLogo } from "@/components/brand/radar-logo"
import { SITE_NAME, siteUrl } from "@/lib/config/site"
import type { DocsLayoutProps } from "fumadocs-ui/layouts/notebook"

/**
 * `/docs` 布局的共享配置。
 *
 * fumadocs 的 `DocsLayout` 会把这些默认值读进整棵文档子树，所以「站点叫什么、
 * 返回上站、去哪拿机器可读的契约」这些只声明一次的地方都在这里，而不是散在
 * layout 里。
 *
 * 注意这里没有 `PublicShell`：`/docs` 现在用的是 fumadocs 自己的导航与侧栏，
 * 整站导航由 `nav.title` 指回首页、机器可读的三个去处由 `sidebar.footer` 给出。
 *
 * 类型是 `DocsLayoutProps` 去掉 `tree`：树来自内容（`source.getPageTree()`），
 * 由 layout 现取，而不是在这里写死一份。
 */
export function baseOptions(): Omit<DocsLayoutProps, "tree"> {
  return {
    nav: {
      /**
       * 导航标题：左上角是 logo 加站名，整块点它回首页而不是回文档自己。
       *
       * 用 `RadarLogo` 这个内联 SVG 而不是 `<img src="/logo.svg">`：站内导航那
       * 一侧已经有同一份组件，两边形状才一致；而且它是 `fill-primary`，跟着
       * 明暗主题走，外链的 SVG 做不到（`public/logo.svg` 的颜色是写死的，
       * 它留给 favicon 与 OG 图用）。
       */
      title: (
        <span className="flex items-center gap-2">
          <RadarLogo className="size-6" />
          <span className="font-medium">{SITE_NAME}</span>
        </span>
      ),
      url: "/",
    },
    /**
     * 主题开关换成本站那一个。fumadocs 的实现读 `next-themes`，而本站的主题
     * 状态在 `components/theme-provider` 里，两边各写一次 `<html class="dark">`
     * 会互相覆盖；`RootProvider` 那边也要把 `theme` 关掉，见
     * `components/docs/provider.tsx`。
     */
    slots: {
      themeSwitch: ThemeSwitch,
    },
    sidebar: {
      collapsible: true,
      /**
       * 机器读的那几份东西。文档给人看，这三份给 agent 与编辑器：一份纯文本
       * 全文、一份 OpenAPI 契约、以及判定规则——最后这一份是散文页里唯一需要
       * 跳转的对照材料（哪些变化算异动）。
       *
       * 放在侧栏底部而不是页首，因为它们是入口而不是内容：读者读完一页不会想
       * 再点一次。
       */
      footer: <DocsSidebarFooter />,
    },
  }
}

function DocsSidebarFooter() {
  const links = [
    { label: "llms-full.txt", href: siteUrl("/llms-full.txt") },
    { label: "OpenAPI 3.1", href: siteUrl("/openapi.json") },
    { label: "判定规则", href: "/method" },
  ]

  return (
    <div className="flex flex-col gap-2 border-t border-fd-border pt-4 text-sm">
      <p className="text-xs font-medium text-fd-muted-foreground">机器可读</p>
      {links.map((link) => (
        <a
          key={link.href}
          href={link.href}
          className="text-fd-muted-foreground transition-colors hover:text-fd-foreground"
        >
          {link.label}
        </a>
      ))}
    </div>
  )
}