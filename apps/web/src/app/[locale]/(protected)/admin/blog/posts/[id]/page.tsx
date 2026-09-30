import { parseFrontmatter } from '@fumadocs/mdx-remote'
import { DocsLayout } from 'fumadocs-ui/layouts/notebook'
import defaultComponents from 'fumadocs-ui/mdx'
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from 'fumadocs-ui/page'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { blogMdxCompiler } from '@/lib/blog/mdx-remote-compiler'
import { createServerCaller } from '@/lib/trpc/server'

// 源项目在本文件里 `createCompiler()` 造了一个新实例；目标项目的
// `lib/blog/mdx-remote-compiler.ts` 已经导出共享的 `blogMdxCompiler`
// （同样是 `createCompiler()` 的返回值），复用它避免重复创建。

interface Frontmatter {
  title: string
  description?: string
}

export default async function Page(props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const api = await createServerCaller()
  const result = await api.admin.blog.getPostById({ id: params.id })

  if (!result.success || !result.data) {
    notFound()
  }

  const post = result.data

  const {
    frontmatter,
    body: MdxContent,
    toc,
  } = await blogMdxCompiler.compile<Frontmatter>({
    filePath: post.path,
    source: post.content,
  })

  return (
    <DocsLayout
      tree={{ name: 'Example Docs', children: [] }}
      nav={{ title: 'Example Docs' }}
      sidebar={{ components: (<></>) as any }}
    >
      <DocsPage toc={toc}>
        <DocsTitle>{frontmatter.title}</DocsTitle>
        <DocsDescription>{frontmatter.description}</DocsDescription>
        <DocsBody>
          <MdxContent components={{ ...defaultComponents }} />
        </DocsBody>
      </DocsPage>
    </DocsLayout>
  )
}

export async function generateMetadata(props: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const params = await props.params
  const api = await createServerCaller()
  const result = await api.admin.blog.getPostById({ id: params.id })

  if (!result.success || !result.data) {
    notFound()
  }

  const post = result.data
  const { frontmatter } = parseFrontmatter(post.content) as { frontmatter: Frontmatter }

  return {
    title: frontmatter.title,
  }
}
