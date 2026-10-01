import { DocsLayout } from "fumadocs-ui/layouts/notebook"
import { baseOptions } from "@/lib/layout.shared"
import { getSource } from "@/lib/source"

export default async function DocsLayoutPage({
  children,
  params,
}: LayoutProps<"/[locale]/docs">) {
  const { locale } = await params
  const source = await getSource()
  const { nav, ...base } = baseOptions()

  return (
    <DocsLayout
      {...base}
      tree={source.getPageTree(locale)}
      sidebar={{ collapsible: false }}
      searchToggle={{
        full: {
          className:
            "my-auto h-9 w-full max-w-sm rounded-xl border-fd-border/80 bg-fd-secondary/40 px-3 text-sm shadow-none max-md:hidden hover:bg-fd-accent/60 hover:text-fd-accent-foreground",
        },
      }}
      nav={{ ...nav, mode: "top" }}
    >
      {children}
    </DocsLayout>
  )
}
