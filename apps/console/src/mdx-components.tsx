/**
 * `/docs` 的 MDX 组件表。
 *
 * 位置是 fumadocs-mdx 约定的：`@/mdx-components`（本项目的 `@/*` 指向
 * `src/*`，所以就是这个文件）。内容真正会用到的自定义组件加在
 * `defaultMdxComponents` 之后：
 *
 * - `Callout`：一句「这里容易踩坑」；
 * - `Steps` / `Step`：三步接入；
 * - `<OpenAPIPage />`：`scripts/generate-openapi-docs.ts` 生成的逐端点页面靠它
 *   把 schema 渲染成交互式文档。生成出来的 MDX 是
 *   `props.components.OpenAPIPage` 这样拿的，所以这张表就是它的唯一入口 ——
 *   少了这一项，端点页会渲染出一个不存在的元素。
 *
 * `defaultMdxComponents` 负责标题锚点、代码块与表格的排版，那是 MDX 页面能读起来
 * 像文档而不是像一段 JSX 的原因。
 *
 * 组件表按页面收窄而不是全量导出：`fumadocs-ui` 还有 `Tabs` / `Accordion` /
 * `Files`，用不上就是三种没人维护的写法入口。
 */
import { Callout } from "fumadocs-ui/components/callout"
import { Step, Steps } from "fumadocs-ui/components/steps"
import defaultMdxComponents from "fumadocs-ui/mdx"
import type { MDXComponents } from "mdx/types"

import { OpenAPIPage } from "@/components/docs/openapi-page"

export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...defaultMdxComponents,
    Callout,
    Steps,
    Step,
    OpenAPIPage,
    ...components,
  } satisfies MDXComponents
}

/**
 * `useMDXComponents()` 的入口。fumadocs-mdx 编译出来的 MDX 在没有显式
 * `components` 时会向这里要默认表。
 */
export const useMDXComponents = getMDXComponents

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>
}