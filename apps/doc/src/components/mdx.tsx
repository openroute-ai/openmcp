import { Accordion, Accordions } from "fumadocs-ui/components/accordion"
import { Callout } from "fumadocs-ui/components/callout"
import { File, Files, Folder } from "fumadocs-ui/components/files"
import { Step, Steps } from "fumadocs-ui/components/steps"
import { Tab, Tabs, TabsContent, TabsList, TabsTrigger } from "fumadocs-ui/components/tabs"
import { TypeTable } from "fumadocs-ui/components/type-table"
import defaultMdxComponents from "fumadocs-ui/mdx"
import type { MDXComponents } from "mdx/types"
import type { ComponentProps, ReactNode } from "react"
import { Tooltip } from "./mdx-tooltip"

type TreeFileProps = ComponentProps<typeof File> & { comment?: string }

function TreeFile(props: TreeFileProps) {
  const fileProps: ComponentProps<typeof File> = { ...props }
  delete (fileProps as TreeFileProps).comment
  return <File {...fileProps} />
}

type TreeComponent = ((props: { children?: ReactNode }) => ReactNode) & {
  File: typeof TreeFile
  Folder: typeof Folder
}

const Tree = (({ children }: { children?: ReactNode }) => (
  <Files>{children}</Files>
)) as unknown as TreeComponent

Tree.File = TreeFile
Tree.Folder = Folder

function LogoIcon({
  src,
  alt,
  className,
}: {
  src: string
  alt?: string
  className?: string
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt ?? ""}
      className={`inline-block size-5 align-text-bottom ${className ?? ""}`}
    />
  )
}

/**
 * 内容里的图片。
 *
 * 默认的 `img` 是 `next/image`，需要显式宽高；local-md 不注入图片尺寸，
 * 且远程图片在构建期无法取到尺寸（会超时），因此统一用原生 `<img>`。
 */
function MdxImage({ src, alt, ...props }: ComponentProps<"img">) {
  const external = typeof src === "string" && /^https?:\/\//.test(src)
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt ?? ""}
      loading="lazy"
      referrerPolicy={external ? "no-referrer" : undefined}
      className="h-auto max-w-full rounded-lg"
      {...props}
    />
  )
}

/** OpenMCP 企业版功能标记。 */
function EnterpriseFeature({ feature }: { feature?: string }) {
  return (
    <div className="my-3 inline-flex flex-wrap items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-700 dark:text-amber-400">
      <span className="inline-flex size-1.5 rounded-full bg-amber-500" />
      企业版功能
      {feature ? <span className="opacity-80">· {feature}</span> : null}
    </div>
  )
}

export function getMDXComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    Tabs,
    Tab,
    TabsList,
    TabsTrigger,
    TabsContent,
    Files,
    File,
    Folder,
    Tree,
    Steps,
    Step,
    Accordion,
    Accordions,
    Callout,
    TypeTable,
    LogoIcon,
    EnterpriseFeature,
    Tooltip,
    img: MdxImage,
    ...components,
  } satisfies MDXComponents
}

export const useMDXComponents = getMDXComponents

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>
}
