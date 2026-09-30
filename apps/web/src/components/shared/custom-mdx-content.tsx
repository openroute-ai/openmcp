import { Accordion, Accordions } from 'fumadocs-ui/components/accordion'
import { Callout } from 'fumadocs-ui/components/callout'
import { File, Files, Folder } from 'fumadocs-ui/components/files'
import { Step, Steps } from 'fumadocs-ui/components/steps'
import { Tab, Tabs } from 'fumadocs-ui/components/tabs'
import { TypeTable } from 'fumadocs-ui/components/type-table'
import defaultMdxComponents from 'fumadocs-ui/mdx'
import * as icons from 'lucide-react'
import type { MDXComponents } from 'mdx/types'
import type { ComponentProps, FC } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface CustomMDXContentProps {
  code: string
}

/**
 * 把 Markdown 字符串渲染成 fumadocs 风格的富文本。
 *
 * 走 `react-markdown` 而非 `@fumadocs/mdx-remote`：更新日志这类内容在
 * 仓库里是纯 Markdown（`content/release/*.mdx`），不含任何 JSX，不需要真正
 * 编译 MDX，也就无需 `evaluate()` 的执行开销与安全边界。博客正文由
 * `lib/blog/mdx-remote-compiler.ts` 走真正的 MDX 编译链路。
 */
const baseComponents: Record<string, any> = {
  ...defaultMdxComponents,
  ...(icons as unknown as MDXComponents),
  Tabs,
  Tab,
  TypeTable,
  Accordion,
  Accordions,
  Steps,
  Step,
  File,
  Folder,
  Files,
  blockquote: Callout as unknown as FC<ComponentProps<'blockquote'>>,
}

export function CustomMDXContent({ code }: CustomMDXContentProps) {
  return (
    <div className='prose dark:prose-invert prose-headings:mt-8 prose-headings:mb-4 prose-ol:mb-6 prose-p:mb-4 prose-ul:mb-6 max-w-none'>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={baseComponents}>
        {code}
      </ReactMarkdown>
    </div>
  )
}
