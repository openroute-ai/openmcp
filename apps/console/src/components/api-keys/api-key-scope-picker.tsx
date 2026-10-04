/**
 * The scope picker, shared by the self-service page and the operator page.
 *
 * `available` is the whole difference between the two audiences, and it is a
 * prop rather than two components because the *selection* behaviour has to match
 * exactly: the self-service page must not be able to hand a subset of scopes to
 * the router, and the operator page must not be able to hand a superset. Two
 * copies of this component would be two chances to get that wrong, and the
 * difference is one word at the call site.
 */
"use client"

import * as React from "react"
import { useLocale, useTranslations } from "next-intl"
import { Checkbox } from "@workspace/ui/components/checkbox"
import { Label } from "@workspace/ui/components/label"
import { API_SCOPES, type ApiScope } from "@/lib/api/scopes"

/** What each scope actually unlocks, for the description under the label. */
const SCOPE_EFFECT: Record<ApiScope, { en: string; zh: string }> = {
  "repos:read": {
    en: "Read rankings and repository data",
    zh: "读取榜单与仓库数据",
  },
  "repos:write": {
    en: "Submit and update your own repositories",
    zh: "提交与更新你自己的仓库",
  },
  "rankings:read": {
    en: "Read the rising-star rankings",
    zh: "读取上升榜",
  },
  "projects:write": {
    en: "Publish projects on the public site",
    zh: "在公开站发布项目",
  },
  "subscriptions:write": {
    en: "Create and update email subscriptions",
    zh: "创建与更新邮件订阅",
  },
}

/**
 * Generic over the scope union rather than fixed at `ApiScope`, because the two
 * callers hold state of different widths: the self-service page's state is
 * `SelfServiceScope[]`. With a fixed `ApiScope` parameter, passing that state
 * setter here is a type error, and the "obvious" fix -- widening the state to
 * `ApiScope[]` -- is exactly the bug the generic prevents: it would let a future
 * scope reach `createMine` from this page with no type error and no runtime one.
 */
export function ApiKeyScopePicker<S extends ApiScope>({
  available,
  value,
  onChange,
  idPrefix,
}: {
  available: readonly S[]
  value: readonly S[]
  onChange: (next: S[]) => void
  /** Distinguishes the two pickers when both are on a page. */
  idPrefix: string
}) {
  const t = useTranslations("ApiKeys")
  const locale = useLocale()

  function toggle(scope: S, checked: boolean) {
    // Re-ordering by the click order would be simpler, and it makes the audit
    // log's `after` unreadable: two selections of the same set differing only in
    // click order are one change, and `updateApiKeyScopes` compares sorted. The
    // order is fixed here so the request body itself is stable too.
    const next = checked ? [...value, scope] : value.filter((s) => s !== scope)
    onChange(available.filter((s) => next.includes(s)))
  }

  return (
    <div className="space-y-3">
      {available.map((scope) => {
        const id = `${idPrefix}-${scope.replace(/[:/]/g, "-")}`
        const effect = SCOPE_EFFECT[scope]
        return (
          <div key={scope} className="flex items-start gap-3">
            <Checkbox
              id={id}
              className="mt-1"
              checked={value.includes(scope)}
              onCheckedChange={(checked) => toggle(scope, checked === true)}
            />
            <div className="grid gap-1">
              <Label htmlFor={id} className="font-mono text-sm">
                {scope}
              </Label>
              {effect ? (
                <p className="text-xs text-muted-foreground">
                  {locale === "zh" ? effect.zh : effect.en}
                </p>
              ) : null}
            </div>
          </div>
        )
      })}
      {available.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("scopes")}</p>
      ) : null}
    </div>
  )
}

/** Re-exported so callers do not need a second import for the full set. */
export { API_SCOPES }
