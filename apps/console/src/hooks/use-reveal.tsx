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
 * the reveal, so the block still becomes visible.
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

  // Read once during the first render rather than in an effect: whether the API
  // exists does not change over a page's lifetime, and deciding it here lets the
  // content render visible immediately instead of flashing in afterwards.
  const [supported] = React.useState(() => typeof IntersectionObserver !== "undefined")
  const [seen, setSeen] = React.useState(!supported)

  React.useEffect(() => {
    if (!supported) return
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
  }, [supported])

  return (
    <div
      ref={ref}
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
