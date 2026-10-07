import type { ReactNode } from "react"
import { Separator } from "@workspace/ui/components/separator"
import { SidebarTrigger } from "@workspace/ui/components/sidebar"
import { SupportWidget } from "@/components/console/support-widget"
import { LocaleSwitcher } from "@/components/locale-switcher"
import { ThemeSwitch } from "@/components/theme-switch"

/**
 * `badge` 留给"这个控制台处于什么状态"的常驻标记（目前是 Pro 订阅），插在标题与
 * 语言切换之间——它属于当前页的身份，不属于全局操作。没有传就不占位。
 *
 * 右侧的控件从淡到浓：主题开关与语言切换是"整站偏好"，技术支持是"关了就没有"
 * 的临时提醒，所以它紧挨着 badge 一侧、而不是站在开关组里。
 */
export function SiteHeader({ title, badge }: { title: string; badge?: ReactNode }) {
  return (
    <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
      <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator
          orientation="vertical"
          className="mx-2 data-[orientation=vertical]:h-4"
        />
        <h1 className="text-base font-medium">{title}</h1>
        <div className="ml-auto flex items-center gap-2">
          {badge}
          <SupportWidget />
          <ThemeSwitch mode="light-dark" />
          <LocaleSwitcher />
        </div>
      </div>
    </header>
  )
}
