"use client"

import { IconMoon, IconSun } from "@tabler/icons-react";

const STORAGE_KEY = "vcx-theme";

/**
 * Theme toggle. The actual class on <html> is applied by an inline script in
 * the document head (before hydration) so there is no flash; this button just
 * flips the class and persists the choice.
 */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const apply = (dark: boolean) => {
    document.documentElement.classList.toggle("dark", dark);
    try {
      localStorage.setItem(STORAGE_KEY, dark ? "dark" : "light");
    } catch {
      // ignore storage errors (private mode etc.)
    }
  };

  return (
    <button
      type="button"
      aria-label="切换深色 / 浅色主题"
      title="切换深色 / 浅色主题"
      onClick={() => apply(!document.documentElement.classList.contains("dark"))}
      className={`grid size-9 shrink-0 place-items-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:text-foreground ${className}`}
    >
      {/* CSS-controlled icons: no hydration mismatch, matches the class set by the head script */}
      <IconSun size={16} className="hidden dark:block" />
      <IconMoon size={16} className="dark:hidden" />
    </button>
  );
}
