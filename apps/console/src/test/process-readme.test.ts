import { describe, expect, it } from "vitest"
import { processReadMeHtml } from "@/lib/github/process-readme-html"
import { processReadMeMd } from "@/lib/github/process-readme-md"

// No OSS credentials are set in the test environment, so the Markdown
// processor exercises the link-rewriting path and the no-op image mirror.
const readme = processReadMeMd.bind(null)
const repo = "vercel/next.js"
const root = "https://github.com/vercel/next.js"

describe("processReadMeHtml", () => {
  it("makes in-page anchors absolute", () => {
    const html = `<h2><a href="#routing">Routing</a></h2>`
    expect(processReadMeHtml(html, repo)).toBe(
      `<h2><a href="${root}#routing">Routing</a></h2>`
    )
  })

  it("makes repository file links absolute", () => {
    expect(processReadMeHtml(`<a href="/docs">Docs</a>`, repo)).toBe(
      `<a href="${root}/blob/main/docs">Docs</a>`
    )
  })

  it("honours the default branch for file links", () => {
    expect(processReadMeHtml(`<a href="docs">Docs</a>`, repo, "canary")).toBe(
      `<a href="${root}/blob/canary/docs">Docs</a>`
    )
  })

  it("leaves absolute links untouched", () => {
    const html = `<a href="https://example.com/x">External</a>`
    expect(processReadMeHtml(html, repo)).toBe(html)
  })

  it("rewrites relative img sources to raw.githubusercontent.com", () => {
    expect(processReadMeHtml(`<img src="docs/a.png">`, repo)).toBe(
      `<img src="https://raw.githubusercontent.com/vercel/next.js/main/docs/a.png">`
    )
  })

  it("drops the ./ prefix on relative image paths", () => {
    expect(processReadMeHtml(`<img src="./a.png">`, repo)).toContain(
      "raw.githubusercontent.com/vercel/next.js/main/a.png"
    )
  })

  it("requests the sanitised variant for svg sources", () => {
    expect(processReadMeHtml(`<img src="logo.svg">`, repo)).toContain(
      "main/logo.svg?sanitize=true"
    )
  })

  it("strips the anchors GitHub injects into rendered HTML", () => {
    const html = `<a id="user-content-routing" class="anchor" href="#routing"></a>Text`
    expect(processReadMeHtml(html, repo)).toBe("Text")
  })
})

describe("processReadMeMd", () => {
  it("makes in-page anchors absolute", async () => {
    const md = `<a href="#quick-start">Quick Start</a>`
    await expect(readme(md, repo)).resolves.toBe(
      `<a href="${root}#quick-start">Quick Start</a>`
    )
  })

  it("makes relative markdown links absolute", async () => {
    const md = `[Self-Hosting](./docs/SELF-HOSTING.md)`
    await expect(readme(md, repo)).resolves.toBe(
      `[Self-Hosting](${root}/blob/main/docs/SELF-HOSTING.md)`
    )
  })

  it("makes root-relative markdown links absolute", async () => {
    await expect(readme(`[Guides](/docs)`, repo)).resolves.toBe(
      `[Guides](${root}/blob/main/docs)`
    )
  })

  it("leaves absolute and anchor markdown links untouched", async () => {
    const external = `[Site](https://example.com)`
    const anchor = `[Jump](#section)`
    await expect(readme(external, repo)).resolves.toBe(external)
    await expect(readme(anchor, repo)).resolves.toBe(anchor)
  })

  it("honours the default branch in link targets", async () => {
    await expect(readme(`[a](docs/a.md)`, repo, "develop")).resolves.toBe(
      `[a](${root}/blob/develop/docs/a.md)`
    )
  })

  it("rewrites bare relative links that have no ./ or / prefix", async () => {
    await expect(readme(`[a](docs/a.md)`, repo)).resolves.toBe(
      `[a](${root}/blob/main/docs/a.md)`
    )
  })

  it("does not rewrite relative image links as blob pages", async () => {
    // With no OSS mirror the image keeps its original target; turning it
    // into a blob link would render as a broken page instead of an image.
    const md = `![logo](docs/logo.png)`
    await expect(readme(md, repo)).resolves.toBe(md)
  })

  it("leaves non-http URI schemes alone", async () => {
    const mail = `[mail](mailto:hi@example.com)`
    const tel = `[call](tel:+15550100)`
    await expect(readme(mail, repo)).resolves.toBe(mail)
    await expect(readme(tel, repo)).resolves.toBe(tel)
  })

  it("keeps the original image URLs when no OSS bucket is configured", async () => {
    const md = `![logo](https://example.com/logo.png)`
    await expect(readme(md, repo)).resolves.toBe(md)
  })

  it("does not mangle a README with nothing to rewrite", async () => {
    const md = "# Title\n\nJust prose."
    await expect(readme(md, repo)).resolves.toBe(md)
  })
})
