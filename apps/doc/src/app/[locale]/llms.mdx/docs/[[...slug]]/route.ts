import { notFound } from "next/navigation"
import { getLLMText, getPageMarkdownUrl, getSource } from "@/lib/source"

export const revalidate = false

export async function GET(
  _req: Request,
  { params }: RouteContext<"/[locale]/llms.mdx/docs/[[...slug]]">
) {
  const { locale, slug } = await params
  const source = await getSource()
  const page = source.getPage(slug?.slice(0, -1), locale)
  if (!page) notFound()

  return new Response(await getLLMText(page), {
    headers: {
      "Content-Type": "text/markdown",
    },
  })
}

export async function generateStaticParams() {
  const source = await getSource()
  return source.getPages().map((page) => ({
    locale: page.locale ?? "zh",
    slug: getPageMarkdownUrl(page).segments,
  }))
}
