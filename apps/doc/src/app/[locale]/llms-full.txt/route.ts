import { getLLMText, getSource } from "@/lib/source"

export const revalidate = false

export async function GET(
  _req: Request,
  { params }: RouteContext<"/[locale]/llms-full.txt">
) {
  const { locale } = await params
  const source = await getSource()
  const scanned = await Promise.all(
    source.getPages(locale).map((page) => getLLMText(page))
  )

  return new Response(scanned.join("\n\n"), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  })
}
