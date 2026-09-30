import { Accordion, Accordions } from 'fumadocs-ui/components/accordion'
import { Callout } from 'fumadocs-ui/components/callout'
import { File, Files, Folder } from 'fumadocs-ui/components/files'
import { Step, Steps } from 'fumadocs-ui/components/steps'
import { Tab, Tabs, TabsContent, TabsList, TabsTrigger } from 'fumadocs-ui/components/tabs'
import { TypeTable } from 'fumadocs-ui/components/type-table'
import defaultMdxComponents from 'fumadocs-ui/mdx'
import type { MDXComponents } from 'mdx/types'
import * as icons from 'lucide-react'

/**
 * MDX 运行时组件表。
 *
 * 同时服务两条链路：
 * - 文件型 MDX（`content/**`）经 `fumadocs-mdx` 在构建期编译；
 * - 数据库型 MDX（博客正文）经 `@fumadocs/mdx-remote` 在请求期编译。
 *
 * 后台 MDX 编辑器写入的正文只允许使用这里注册过的组件 —— 未注册的标签会被
 * 降级成原生 HTML，所以新增文档组件时务必在这里登记。
 */
export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...(icons as unknown as MDXComponents),
    ...defaultMdxComponents,
    File,
    Files,
    Folder,
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger,
    Tab,
    Steps,
    Step,
    Accordion,
    Accordions,
    TypeTable,
    Callout,
    ...components,
  }
}

/**
 * `useMDXComponents()` 的默认导出入口。fumadocs-ui 的 `DocsLayout` 会在
 * 渲染子树时读取它，缺少这个导出会导致所有 MDX 页面丢失样式与组件。
 */
export function useMDXComponents(components?: MDXComponents): MDXComponents {
  return getMDXComponents(components)
}
