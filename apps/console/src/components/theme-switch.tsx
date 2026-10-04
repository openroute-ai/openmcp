"use client"

import { IconDeviceDesktop, IconMoon, IconSun } from "@tabler/icons-react"
import { flushSync } from "react-dom"
import { useSyncExternalStore, type ComponentProps } from "react"

import { useTheme } from "@/components/theme-provider"

/**
 * fumadocs 布局里的主题开关。
 *
 * fumadocs 自带的那个读 `next-themes`，而本站不用它（原因见
 * `components/theme-provider.tsx` 顶上那段），所以通过
 * `layout.shared.tsx` 的 `slots.themeSwitch` 换成这一个：状态、写入的
 * `<html class="dark">`、以及记住选择用的 localStorage key，都走本站那一份。
 * 两套并存的话，文档里的开关和站内其它页面的开关会互相覆盖。
 *
 * 渲染出的结构与 fumadocs 的同名组件一致（一个药丸形的按钮组加
 * `data-theme-toggle`），`mode` 的两种形态都实现了 —— 上游把这个 prop 交给
 * 调用方决定是「亮/暗两态」还是「亮/暗/跟随系统」，这里照做，省得有人传了
 * `light-dark-system` 却拿到一个只有两态的开关。
 */

const noop = () => () => {}

const iconClass = "size-4"

export function ThemeSwitch({
  className,
  mode = "light-dark",
  ...props
}: {
  className?: string
  mode?: "light-dark" | "light-dark-system"
} & ComponentProps<"div">) {
  const { theme, resolvedTheme, setTheme } = useTheme()

  // 服务端不知道访客的主题：它的快照是 light。所以图标的高亮先不渲染，
  // 挂载后再补上，否则深色访客会看到一次图标对不上的水合。
  const mounted = useSyncExternalStore(
    noop,
    () => true,
    () => false,
  )

  const change = (next: "light" | "dark" | "system") => {
    // flushSync 是必要的：视图过渡要拍下切换前后的两张画面，而主题切换是
    // context 更新，不强制提交的话过渡会从「已经变过」的树开始拍。
    if (document.startViewTransition) {
      document.startViewTransition(() => flushSync(() => setTheme(next)))
      return
    }
    setTheme(next)
  }

  const pill = `inline-flex items-center gap-1 rounded-full border border-border p-1 ${className ?? ""}`

  if (mode === "light-dark") {
    const value = mounted ? resolvedTheme : null

    return (
      <button
        type="button"
        aria-label="切换深色 / 浅色主题"
        data-theme-toggle=""
        className={pill}
        onClick={() => change(value === "light" ? "dark" : "light")}
      >
        <IconSun
          size={16}
          className={`${iconClass} ${value === "light" ? "text-foreground" : "text-muted-foreground"}`}
        />
        <IconMoon
          size={16}
          className={`${iconClass} ${value === "dark" ? "text-foreground" : "text-muted-foreground"}`}
        />
      </button>
    )
  }

  const value = mounted ? theme : null
  const options = [
    { key: "light", Icon: IconSun, label: "浅色" },
    { key: "dark", Icon: IconMoon, label: "深色" },
    { key: "system", Icon: IconDeviceDesktop, label: "跟随系统" },
  ] as const

  return (
    <div className={pill} data-theme-toggle="" {...props}>
      {options.map(({ key, Icon, label }) => (
        <button
          key={key}
          type="button"
          aria-label={label}
          className={`${iconClass} ${value === key ? "text-foreground" : "text-muted-foreground"}`}
          onClick={() => change(key)}
        >
          <Icon size={16} />
        </button>
      ))}
    </div>
  )
}