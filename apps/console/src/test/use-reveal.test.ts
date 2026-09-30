import * as React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { Reveal } from "@/hooks/use-reveal"

/**
 * Regression test for the hydration mismatch the landing page was logging for
 * every section block.
 *
 * The failure was not observable from the outside: the server and the client
 * each produced plausible markup, just different markup. So this does not assert
 * what the block *should* look like, it asserts the property that was actually
 * broken — that the first render cannot depend on the environment.
 *
 * `renderToStaticMarkup` runs no effects, which is precisely the point: it
 * captures the initial render only, the one that has to agree across the wire.
 * Two renders, differing only in whether `IntersectionObserver` exists, must
 * therefore be byte-identical. The old implementation started *visible* when the
 * API was missing, so the server said `opacity:1` and the browser said
 * `opacity:0` — this test fails on it, and needs no DOM to do so.
 */
describe("Reveal initial render", () => {
  // `children` stays a required prop of `Reveal`, so the props object has to
  // carry it to satisfy the type — but the real child is passed as
  // createElement's third argument, which is what actually wins and what
  // react/no-children-prop wants.
  const render = (delay = 0) => {
    const props: React.ComponentProps<typeof Reveal> = { delay, children: null }
    return renderToStaticMarkup(
      React.createElement(Reveal, props, React.createElement("p", null, "x"))
    )
  }

  /** Installs a stand-in for the browser global, and returns a restore fn. */
  function withIntersectionObserver<T>(fn: () => T): T {
    const saved = Reflect.get(globalThis, "IntersectionObserver")
    Object.defineProperty(globalThis, "IntersectionObserver", {
      value: class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
      configurable: true,
      writable: true,
    })
    try {
      return fn()
    } finally {
      if (saved === undefined) {
        Reflect.deleteProperty(globalThis, "IntersectionObserver")
      } else {
        Object.defineProperty(globalThis, "IntersectionObserver", {
          value: saved,
          configurable: true,
          writable: true,
        })
      }
    }
  }

  it("renders identical markup with and without IntersectionObserver", () => {
    // This process has no IntersectionObserver, which is also the server's
    // condition, so `render()` here stands in for the server render.
    expect(typeof IntersectionObserver).toBe("undefined")

    const asServer = render()
    const asBrowser = withIntersectionObserver(() => render())

    expect(asBrowser).toBe(asServer)
  })

  it("starts hidden so the reveal is a transition, not a flash", () => {
    const html = render()
    expect(html).toContain('data-reveal=""')
    expect(html).toContain("opacity:0")
    expect(html).toContain("translateY(14px)")
  })

  it("keeps the delay in the transition for both callers' stagger", () => {
    expect(render(90)).toContain("600ms ease-out 90ms")
  })
})
