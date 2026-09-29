"use client"

import * as React from "react"
import { Toaster } from "@workspace/ui/components/sonner"

/**
 * Theming, without a script tag in the React tree.
 *
 * This app used `next-themes`, whose `ThemeProvider` renders its no-flash
 * script with `createElement("script", ...)`. React 19 and Next 16 refuse to
 * execute a script that a component renders on the client, and say so on every
 * page:
 *
 *   Encountered a script tag while rendering React component. Scripts inside
 *   React components are never executed when rendering on the client.
 *
 * The script is only useful once, in the server-rendered HTML, before the
 * first paint. `THEME_SCRIPT` below is rendered by the root layout into
 * `<head>`, which is server output, and the provider only maintains state
 * afterwards. The class it applies is the one Tailwind's `dark:` variant keys
 * off, and the storage key is unchanged, so a visitor who already picked a
 * theme keeps it.
 *
 * `apps/web` still uses `next-themes`; the shared `Toaster` reads it, and this
 * app passes the theme in as a prop instead.
 */

export type Theme = "light" | "dark" | "system"
export type ResolvedTheme = "light" | "dark"

/** Unchanged from `next-themes`, so an existing choice is not lost. */
const STORAGE_KEY = "theme"

/**
 * Set for a frame around a theme change, so a colour swap does not animate
 * every element on the page. The rule is in the shared stylesheet rather than
 * in a `<style>` this component would have to inject.
 */
const TRANSITION_NONE_CLASS = "theme-transition-none"

const DARK_QUERY = "(prefers-color-scheme: dark)"

const isTheme = (value: unknown): value is Theme =>
  value === "light" || value === "dark" || value === "system"

/**
 * The no-flash script, kept small because it runs on every page load.
 *
 * Applies the stored choice, or the OS preference when nothing is stored, and
 * gives up quietly if storage is unavailable: a browser that blocks
 * `localStorage` should still get the OS theme rather than no theme at all.
 */
export const THEME_SCRIPT = `(function(){try{var s=localStorage.getItem("${STORAGE_KEY}");var d=s==="dark"||(s!=="light"&&matchMedia("${DARK_QUERY}").matches);var e=document.documentElement;e.classList.toggle("dark",d);e.style.colorScheme=d?"dark":"light"}catch(_){}})()`

/**
 * The script element for the document head, rendered by the root layout.
 *
 * A server component's `<script>` is part of the HTML response and runs during
 * parsing, which is what has to happen here. `next/script`'s
 * `beforeInteractive` would do the same thing, but it is only supported in
 * `pages/_document`, and reaching for it in the App Router is a lint error.
 */
export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
}

/*
 * The two sources of truth the theme is read from, as external stores.
 *
 * `useSyncExternalStore` is what the server-render case calls for: the server
 * has neither storage nor a media query, so it takes a snapshot from
 * `getServerSnapshot` and the client takes one from the browser. Reading
 * either in an effect instead would set state after the first paint and
 * cascade a second render for it.
 */

const storedListeners = new Set<() => void>()

/** The stored choice, or `fallback` when nothing valid is stored. */
const readStoredTheme = (fallback: Theme): Theme => {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY)
    return isTheme(value) ? value : fallback
  } catch {
    // Storage can be blocked; the OS preference is the fallback either way.
    return fallback
  }
}

const subscribeToStoredTheme = (onChange: () => void) => {
  storedListeners.add(onChange)
  return () => storedListeners.delete(onChange)
}

let mediaQuery: MediaQueryList | null = null
const systemMedia = () => (mediaQuery ??= window.matchMedia(DARK_QUERY))

const readSystemTheme = (): ResolvedTheme =>
  systemMedia().matches ? "dark" : "light"

const subscribeToSystemTheme = (onChange: () => void) => {
  const media = systemMedia()
  media.addEventListener("change", onChange)
  return () => media.removeEventListener("change", onChange)
}

type ThemeContextValue = {
  theme: Theme
  resolvedTheme: ResolvedTheme
  setTheme: (theme: Theme) => void
}

const ThemeContext = React.createContext<ThemeContextValue | null>(null)

export function useTheme(): ThemeContextValue {
  const value = React.useContext(ThemeContext)
  if (!value) {
    throw new Error("useTheme must be called inside <ThemeProvider>")
  }
  return value
}

export function ThemeProvider({
  children,
  defaultTheme = "system",
}: {
  children: React.ReactNode
  defaultTheme?: Theme
}) {
  // A ref rather than state: it seeds the server snapshot and the fallback
  // read, and nothing ever changes it while mounted.
  const fallback = React.useRef(defaultTheme)

  const theme = React.useSyncExternalStore(
    subscribeToStoredTheme,
    () => readStoredTheme(fallback.current),
    () => fallback.current
  )
  const systemTheme = React.useSyncExternalStore(
    subscribeToSystemTheme,
    readSystemTheme,
    () => "light" as ResolvedTheme
  )

  const resolvedTheme: ResolvedTheme = theme === "system" ? systemTheme : theme

  const setTheme = React.useCallback((next: Theme) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // A theme that cannot be remembered still applies for this page.
    }
    for (const onChange of storedListeners) onChange()
  }, [])

  React.useEffect(() => {
    const root = document.documentElement
    // `.dark` is what the `dark:` variant matches, and `colorScheme` is what
    // makes form controls and scrollbars follow without a stylesheet.
    root.classList.toggle("dark", resolvedTheme === "dark")
    root.style.colorScheme = resolvedTheme

    root.classList.add(TRANSITION_NONE_CLASS)
    const frame = requestAnimationFrame(() =>
      root.classList.remove(TRANSITION_NONE_CLASS)
    )
    return () => cancelAnimationFrame(frame)
  }, [resolvedTheme])

  const value = React.useMemo(
    () => ({ theme, resolvedTheme, setTheme }),
    [theme, resolvedTheme, setTheme]
  )

  return (
    <ThemeContext.Provider value={value}>
      <ThemeHotkey />
      {children}
    </ThemeContext.Provider>
  )
}

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  )
}

function ThemeHotkey() {
  const { resolvedTheme, setTheme } = useTheme()

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.repeat) {
        return
      }

      if (event.metaKey || event.ctrlKey || event.altKey) {
        return
      }

      if (event.key.toLowerCase() !== "d") {
        return
      }

      if (isTypingTarget(event.target)) {
        return
      }

      setTheme(resolvedTheme === "dark" ? "light" : "dark")
    }

    window.addEventListener("keydown", onKeyDown)

    return () => {
      window.removeEventListener("keydown", onKeyDown)
    }
  }, [resolvedTheme, setTheme])

  return null
}

/**
 * The shared `Toaster`, told which theme to use.
 *
 * The shared component reads `next-themes` for its default, which this app no
 * longer provides, so the theme is passed in. The prop is applied after the
 * internal default, so this wins.
 */
export function ThemedToaster() {
  const { theme } = useTheme()

  return <Toaster theme={theme} />
}
