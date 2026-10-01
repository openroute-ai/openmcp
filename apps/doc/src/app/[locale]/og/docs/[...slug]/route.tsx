import { ImageResponse } from "@takumi-rs/image-response"
import { generate as DefaultImage } from "fumadocs-ui/og/takumi"
import { notFound } from "next/navigation"
import { getPageImage, getSource } from "@/lib/source"

export const revalidate = false

export async function GET(
  _req: Request,
  { params }: RouteContext<"/[locale]/og/docs/[...slug]">
) {
  const { locale, slug } = await params
  const source = await getSource()
  const page = source.getPage(slug.slice(0, -1), locale)
  if (!page) notFound()

  return new ImageResponse(
    <DefaultImage
      title={page.data.title}
      description={page.data.description}
      site="OpenMCP"
    />,
    {
      width: 1200,
      height: 630,
      format: "webp",
    }
  )
}

export async function generateStaticParams() {
  const source = await getSource()
  return source.getPages().map((page) => ({
    locale: page.locale ?? "zh",
    slug: getPageImage(page).segments,
  }))
}
