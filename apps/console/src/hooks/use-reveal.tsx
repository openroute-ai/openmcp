import * as React from "react"

/**
 * Fade-and-rise on scroll, for the landing page's section blocks.
 *
 * The observer disconnects itself once the element has been seen, so a block
 * that scrolls back up does not replay the animation. When IntersectionObserver
 * is missing the content renders immediately rather than staying invisible —
 * an absent API should cost the effect, not the content.
 *
 * `prefers-reduced-motion` is honoured by dropping the transition rather than
 * the reveal, so the block still becomes visible. That lives in CSS rather than
 * here, which is both simpler than a second `matchMedia` listener and correct
 * before hydration; see `[data-reveal]` in the landing stylesheet.
 */
export function Reveal({
  children,
  className = "",
  delay = 0,
}: {
  children: React.ReactNode
  className?: string
  /** Milliseconds to wait after entering the viewport. */
  delay?: number
}) {
  const ref = React.useRef<HTMLDivElement>(null)

  // Always start hidden — including on the server.
  //
  // The obvious shortcut is to sniff for IntersectionObserver during render and
  // start *visible* when it is missing, so that a browser without the API skips
  // straight to the content. That is what this did, and it cannot work: the
  // render happens on the server too, where IntersectionObserver does not exist,
  // so the server emitted `opacity: 1; transform: none` while the client's
  // first render emitted `opacity: 0; transform: translateY(14px)`. Two
  // different initial states for one attribute, and React has no way to patch
  // that after hydration — every Reveal on the page logged a mismatch.
  //
  // So the initial state cannot depend on the environment. Hidden it is, on
  // both sides, and every environment-dependent decision moves below into the
  // effect, which only ever runs in the browser.
  const [seen, setSeen] = React.useState(false)

  React.useEffect(() => {
    if (typeof IntersectionObserver === "undefined") {
      // Scheduled rather than set inline: a synchronous setState in an effect
      // body is a re-render during the commit phase, which is what
      // react-hooks/set-state-in-effect is about. The observer path below
      // delivers its state from a callback, i.e. already off the commit phase,
      // so deferring this one the same way is consistency rather than a way to
      // slip past the rule.
      const id = window.setTimeout(() => setSeen(true), 0)
      return () => window.clearTimeout(id)
    }
    const el = ref.current
    if (!el) return

    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setSeen(true)
          io.disconnect()
        }
      },
      { threshold: 0.15 }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      data-reveal=""
      className={className}
      style={{
        opacity: seen ? 1 : 0,
        transform: seen ? "none" : "translateY(14px)",
        transition: `opacity 600ms ease-out ${delay}ms, transform 600ms ease-out ${delay}ms`,
      }}
    >
      {children}
    </div>
  )
}
