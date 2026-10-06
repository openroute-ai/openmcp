/**
 * Tests for the outbound-link helper.
 *
 * Pure input handling, like the rest of the pure tests: the helper is the only
 * thing that stands between a stored URL — a README line, a repository field,
 * an author's homepage — and the console's public redirect. Two of the cases
 * below are the ones that matter: the redirect is public, so it must never
 * bounce a crafted `javascript:` or `data:` value (the reward for that would be
 * an open redirect), and a relative path has no destination worth counting, so
 * it stays where it is.
 */
import { describe, expect, it } from "vitest"
import { outboundHref } from "@/lib/outbound"

describe("outboundHref", () => {
  it("routes an absolute https target through the console's own link", () => {
    expect(outboundHref("https://github.com/acme/tool")).toBe(
      "/out?url=https%3A%2F%2Fgithub.com%2Facme%2Ftool"
    )
  })

  it("accepts http as well as https", () => {
    expect(
      outboundHref("http://example.com/README.md#usage")
    ).toBe("/out?url=http%3A%2F%2Fexample.com%2FREADME.md%23usage")
  })

  it("keeps the query string intact for a reportable link", () => {
    expect(outboundHref("https://example.com/?ref=console&src=readme")).toBe(
      "/out?url=https%3A%2F%2Fexample.com%2F%3Fref%3Dconsole%26src%3Dreadme"
    )
  })

  it("refuses a scheme the redirect cannot navigate to", () => {
    for (const url of [
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "mailto:owner@example.com",
      "ftp://example.com/file",
      "file:///etc/passwd",
    ]) {
      expect(outboundHref(url), url).toBeNull()
    }
  })

  it("refuses a relative path: there is no exit to bounce", () => {
    for (const url of ["/projects/acme/tool", "docs/README.md"]) {
      expect(outboundHref(url), url).toBeNull()
    }
  })

  it("refuses a protocol-relative URL, which could mean anything", () => {
    expect(outboundHref("//example.com/evil")).toBeNull()
  })

  it("refuses a URL the parser cannot even make sense of", () => {
    expect(outboundHref("not a url at all")).toBeNull()
    expect(outboundHref("https://")).toBeNull()
    expect(outboundHref("")).toBeNull()
  })
})