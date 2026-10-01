"use client"

import { useCallback, useEffect, useRef, useState } from "react"

type ThumbState = { height: number; top: number; visible: boolean }

/**
 * 页面级悬浮滚动条：平时隐藏、滚动/悬停右缘时淡入，避免布局偏移。
 * 仅在 <html> 是滚动容器（document.scrollingElement）的常规页面生效。
 */
export function PageScrollbar() {
  const [thumb, setThumb] = useState<ThumbState>({
    height: 0,
    top: 0,
    visible: false,
  })
  const hideTimer = useRef<number | null>(null)
  const drag = useRef<{
    startY: number
    startTop: number
    thumbHeight: number
  } | null>(null)

  const measure = useCallback(() => {
    const scroller = document.scrollingElement
    if (!scroller) return
    const { scrollTop, scrollHeight, clientHeight } = scroller
    const max = scrollHeight - clientHeight
    if (max <= 0) {
      setThumb((t) => (t.height === 0 ? t : { height: 0, top: 0, visible: t.visible }))
      return
    }
    const height = Math.max(28, (clientHeight / scrollHeight) * clientHeight)
    const top = (scrollTop / max) * (clientHeight - height)
    setThumb((t) =>
      t.height === height && t.top === top ? t : { height, top, visible: t.visible }
    )
  }, [])

  const pulse = useCallback(() => {
    setThumb((t) => (t.visible ? t : { ...t, visible: true }))
    if (hideTimer.current) window.clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => {
      setThumb((t) => (t.visible ? { ...t, visible: false } : t))
    }, 1600)
  }, [])

  useEffect(() => {
    const onScroll = () => {
      measure()
      pulse()
    }
    const onResize = () => measure()
    const onPointerMove = (event: MouseEvent) => {
      if (event.clientX >= window.innerWidth - 18) pulse()
    }
    document.addEventListener("scroll", onScroll, { capture: true, passive: true })
    window.addEventListener("resize", onResize)
    window.addEventListener("pointermove", onPointerMove, { passive: true })
    const initial = window.requestAnimationFrame(measure)
    return () => {
      window.cancelAnimationFrame(initial)
      document.removeEventListener("scroll", onScroll, { capture: true })
      window.removeEventListener("resize", onResize)
      window.removeEventListener("pointermove", onPointerMove)
      if (hideTimer.current) window.clearTimeout(hideTimer.current)
    }
  }, [measure, pulse])

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const scroller = document.scrollingElement
    if (!scroller) return
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = {
      startY: event.clientY,
      startTop: scroller.scrollTop,
      thumbHeight: thumb.height,
    }
  }

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return
    const scroller = document.scrollingElement as HTMLElement | null
    if (!scroller) return
    const { scrollHeight, clientHeight } = scroller
    const max = scrollHeight - clientHeight
    if (max <= 0) return
    const track = clientHeight - drag.current.thumbHeight
    const delta = event.clientY - drag.current.startY
    scroller.scrollTop = Math.min(
      max,
      Math.max(0, drag.current.startTop + (delta / track) * max)
    )
  }

  const endDrag = () => {
    if (drag.current) drag.current = null
  }

  return (
    <div
      className="page-scrollbar"
      data-visible={thumb.visible ? "true" : undefined}
      aria-hidden="true"
    >
      <div
        className="page-scrollbar-thumb"
        style={{ height: `${thumb.height}px`, top: `${thumb.top}px` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      />
    </div>
  )
}
