"use client"

import { Check, Copy } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import type { ReactNode } from "react"

type Shiki = {
  codeToHtml: (
    code: string,
    options: { lang: string; theme: string }
  ) => string | Promise<string>
}

let shikiPromise: Promise<Shiki> | null = null

function getShiki(): Promise<Shiki> {
  if (!shikiPromise) {
    shikiPromise = import("shiki").then(({ createHighlighter }) =>
      createHighlighter({
        themes: ["github-light", "github-dark"],
        langs: [
          "text",
          "ts",
          "tsx",
          "js",
          "jsx",
          "bash",
          "json",
          "html",
          "css",
          "md",
          "markdown",
          "python",
          "sql",
          "yaml",
          "yml",
          "diff",
          "go",
        ],
      })
    )
  }
  return shikiPromise
}

async function highlight(
  code: string,
  lang: string,
  dark: boolean
): Promise<string | null> {
  const theme = dark ? "github-dark" : "github-light"
  const shiki = await getShiki()
  try {
    return await shiki.codeToHtml(code, { lang, theme })
  } catch {
    if (lang === "text") return null
    try {
      return await shiki.codeToHtml(code, { lang: "text", theme })
    } catch {
      return null
    }
  }
}

function isDark(): boolean {
  return document.documentElement.classList.contains("dark")
}

type HighlightResult = { key: string; html: string | null }

export function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const [dark, setDark] = useState(isDark)
  const [result, setResult] = useState<HighlightResult | null>(null)
  const [copied, setCopied] = useState(false)

  const key = `${dark ? "d" : "l"}:${lang}:${code}`
  const html = result?.key === key ? result.html : null

  useEffect(() => {
    const root = document.documentElement
    const observer = new MutationObserver(() => setDark(isDark()))
    observer.observe(root, { attributes: true, attributeFilter: ["class"] })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    let alive = true
    highlight(code, lang, dark).then((h) => {
      if (!alive) return
      setResult({
        key: `${dark ? "d" : "l"}:${lang}:${code}`,
        html: h ?? null,
      })
    })
    return () => {
      alive = false
    }
  }, [code, lang, dark])

  const copy = useCallback(() => {
    void navigator.clipboard
      .writeText(code)
      .then(() => {
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1500)
      })
      .catch(() => {
        // 忽略复制失败
      })
  }, [code])

  return (
    <div className="group/code relative block overflow-hidden rounded-lg border border-fd-border bg-fd-muted/60">
      <div className="flex items-center justify-between border-b border-fd-border/80 bg-fd-muted/50 px-3 py-1">
        <span className="font-mono text-[10px] font-medium tracking-wider text-fd-muted-foreground uppercase">
          {lang === "text" ? "code" : lang}
        </span>
        <button
          type="button"
          onClick={copy}
          title={copied ? "已复制" : "复制代码"}
          aria-label={copied ? "已复制" : "复制代码"}
          className="inline-flex size-6 items-center justify-center rounded-md text-fd-muted-foreground opacity-0 transition-opacity group-hover/code:opacity-100 hover:bg-fd-muted hover:text-fd-foreground focus-visible:opacity-100"
        >
          {copied ? (
            <Check className="size-3.5 text-fd-primary" />
          ) : (
            <Copy className="size-3.5" />
          )}
        </button>
      </div>
      {html ? (
        <div
          className="break-words [&_pre]:my-0 [&_pre]:max-w-full [&_pre]:!whitespace-pre-wrap [&_pre]:!bg-transparent [&_pre]:p-3 [&_pre]:text-[13px] [&_pre]:leading-relaxed [&_pre]:overflow-wrap-anywhere"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <pre className="max-w-full overflow-hidden p-3 text-[13px] leading-relaxed break-words whitespace-pre-wrap [overflow-wrap:anywhere]">
          <code className="font-mono">{code}</code>
        </pre>
      )}
    </div>
  )
}

function extractText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(extractText).join("")
  if (node && typeof node === "object" && "props" in node && node.props) {
    return extractText((node.props as { children?: ReactNode }).children)
  }
  return ""
}

export function PreBlock({ children }: { children?: ReactNode }) {
  const child = Array.isArray(children) ? children[0] : children
  if (!child || typeof child !== "object" || !("props" in child) || !child.props) {
    return <pre className="overflow-x-auto p-3 text-[13px]">{children}</pre>
  }
  const props = child.props as { className?: string; children?: ReactNode }
  const match = /language-([\w+-]+)/.exec(props.className ?? "")
  const lang = match?.[1] ?? "text"
  const code = extractText(props.children)
  return <CodeBlock code={code} lang={lang} />
}
