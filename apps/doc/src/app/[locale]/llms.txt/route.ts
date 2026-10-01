import { llms } from "fumadocs-core/source"
import { getSource } from "@/lib/source"

export const revalidate = false

export async function GET(
  _req: Request,
  { params }: RouteContext<"/[locale]/llms.txt">
) {
  const { locale } = await params
  const source = await getSource()
  return new Response(await llms(source).index(locale))
}
