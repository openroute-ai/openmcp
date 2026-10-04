"use client"

import { RootProvider } from "fumadocs-ui/provider/next"
import { defineI18nUI } from "fumadocs-ui/i18n"
import type { ReactNode } from "react"

import { docsI18n } from "@/lib/docs/i18n"

/**
 * fumadocs 的 UI 文案。
 *
 * 键是 fumadocs 的原文（`fumadocs-ui/.translations/keys.ts`），值是本站的说法。
 * 只收会真的出现在 `/docs` 上的那些：目录、搜索、翻页、侧栏开合、代码块复制。
 * 键写错不会报错，`t()` 会退回英文原文 —— 所以新增组件时照着那个文件抄键名，
 * 不要凭印象写。
 */
const { provider } = defineI18nUI(docsI18n, {
  zh: {
    displayName: "简体中文",
    "Search(search trigger)": "搜索文档",
    "Search(search dialog)": "搜索文档",
    "Open Search(search trigger)(aria-label)": "打开搜索",
    "Close Search(search dialog)(aria-label)": "关闭搜索",
    "No results found(search dialog)": "没有匹配的结果",
    "On this page(table of contents)": "本页目录",
    "Table of Contents(inline table of contents)": "本页目录",
    "No Headings(table of contents)": "本页没有标题",
    "Previous Page(pagination)": "上一页",
    "Next Page(pagination)": "下一页",
    "Last updated on(page footer)": "最后更新于",
    "Open Sidebar(sidebar)(aria-label)": "打开侧栏",
    "Close Sidebar(sidebar)(aria-label)": "关闭侧栏",
    "Open Sidebar(sidebar)": "打开侧栏",
    "Close Sidebar(sidebar)": "关闭侧栏",
    "Show Sidebar(sidebar)": "显示侧栏",
    "Hide Sidebar(sidebar)": "隐藏侧栏",
    "Collapse Sidebar(aria-label)": "收起侧栏",
    "Toggle Menu(mobile menu)(aria-label)": "打开菜单",
    "Copy Text(code block)(aria-label)": "复制代码",
    "Copied Text(code block)(aria-label)": "已复制",
    "Copy Anchor Link(heading anchor)(aria-label)": "复制标题链接",
    "Copied Anchor Link(heading anchor)(aria-label)": "已复制标题链接",
    "Page Not Found(404 page)": "页面不存在",
    "Type(type table)": "类型",
    "Parameters(type table)": "参数",
    "Returns(type table)": "返回",
    "Prop(type table)": "字段",
    "Default(type table)": "默认值",
  },
})

/**
 * `/docs` 的 fumadocs 上下文。
 *
 * 放在这一层而不是根布局：`RootProvider` 是 client 组件，把它挂到整站会让
 * 每个页面都背一份搜索与 i18n 的 context，而用到它的只有文档路由。
 *
 * `theme: { enabled: false }` 是必须的。本站的主题是 `components/theme-provider`
 * 自己实现的（`next-themes` 在 React 19 + Next 16 下会渲染一个永远不执行的
 * `<script>`，见那个文件的说明），而 fumadocs 的主题开关读的是
 * `next-themes`。留着它会让两套主题各写一次 `<html class="dark">`，而
 * fumadocs 那次写入没有 provider 兜底。真正的开关是 `layout.shared.tsx` 里
 * 换掉的 `slots.themeSwitch`。
 *
 * `search.options.api` 指向 `app/api/search/route.ts`：索引在第一个请求时
 * 建好，搜索是 `/docs` 唯一需要请求期数据的功能。
 */
export function DocsProvider({ children }: { children: ReactNode }) {
  return (
    <RootProvider
      i18n={provider("zh")}
      theme={{ enabled: false }}
      search={{ options: { api: "/api/search" } }}
    >
      {children}
    </RootProvider>
  )
}