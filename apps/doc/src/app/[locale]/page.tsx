import { redirect } from "next/navigation"
import { localePath } from "@/lib/shared"

export default async function LocaleHomePage({
  params,
}: PageProps<"/[locale]">) {
  const { locale } = await params
  redirect(localePath(locale, "/docs"))
}
