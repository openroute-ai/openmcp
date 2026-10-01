import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
  MarkdownCopyButton,
  ViewOptionsPopover,
} from "fumadocs-ui/layouts/notebook/page"
import { createRelativeLink } from "fumadocs-ui/mdx"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { getMDXComponents } from "@/components/mdx"
import { gitConfig } from "@/lib/shared"
import { getPageImage, getPageMarkdownUrl, getSource } from "@/lib/source"

export default async function Page(
  props: PageProps<"/[locale]/docs/[[...slug]]">
) {
  const params = await props.params
  const source = await getSource()
  const page = source.getPage(params.slug, params.locale)
  if (!page) notFound()

  const markdownUrl = getPageMarkdownUrl(page).url
  const loaded = await page.data.load()
  const { toc, body } = await loaded.render(
    getMDXComponents({
      a: createRelativeLink(source, page),
    })
  )

  return (
    <DocsPage toc={toc} full={page.data.frontmatter.full}>
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription className="mb-0">
        {page.data.description}
      </DocsDescription>
      <div className="flex flex-row items-center gap-2 border-b pb-6">
        <MarkdownCopyButton markdownUrl={markdownUrl} />
        <ViewOptionsPopover
          markdownUrl={markdownUrl}
          githubUrl={`https://github.com/${gitConfig.user}/${gitConfig.repo}/blob/${gitConfig.branch}/apps/doc/content/docs/${page.path}`}
        />
      </div>
      <DocsBody>{body}</DocsBody>
    </DocsPage>
  )
}

export async function generateStaticParams() {
  const source = await getSource()
  return source.generateParams("slug", "locale")
}

export async function generateMetadata(
  props: PageProps<"/[locale]/docs/[[...slug]]">
): Promise<Metadata> {
  const params = await props.params
  const source = await getSource()
  const page = source.getPage(params.slug, params.locale)
  if (!page) notFound()

  return {
    title: page.data.title,
    description: page.data.description,
    openGraph: {
      images: getPageImage(page).url,
    },
  }
}
