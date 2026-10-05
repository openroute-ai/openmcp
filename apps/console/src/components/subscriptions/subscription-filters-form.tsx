/**
 * 订阅过滤器的编辑器与只读摘要。
 *
 * 一份 schema 两处用：`SubscriptionFiltersForm` 是建订阅与改订阅时填的，`FilterSummary`
 * 是列表与详情里显示的。两者必须同源——分开写就会出现"保存的是 A、显示的是 B"，而订阅
 * 方判断一条订阅推的是不是他要的东西，靠的正是这个摘要。
 *
 * ## 为什么分类是自由文本而不是下拉
 *
 * `categoryCodes` 是 `categories.code`，运营会随时加，而运营分类的可选值要走一次查询才
 * 知道。一条"选错了就推错数据"的过滤轴，配一个需要额外请求的控件不划算：它只在填错时
 * 有代价，而填错的可见后果是列表里的 `matchedRepos` 立刻变成一个讲不通的数字。这里给
 * 一个逗号分隔的输入框，服务层的 zod 与投递时的 `in (...)` 仍然是真实校验。
 */
"use client"

import * as React from "react"
import { useTranslations } from "next-intl"
import { Badge } from "@workspace/ui/components/badge"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Switch } from "@workspace/ui/components/switch"
import { Checkbox } from "@workspace/ui/components/checkbox"
import { PROJECT_TYPES, type ProjectType } from "@/db/schema/github"

export interface SubscriptionFilterValue {
  projectTypes: ProjectType[]
  categoryCodes: string[]
  platformTypes: ProjectType[]
  includePlatformProjects: boolean
  includeUncurated: boolean
  includeOwnSubmissions: boolean
  repoIds: string[]
}

/**
 * 空过滤器，也就是 `filters: {}` 的形状。
 *
 * `includeOwnSubmissions` 默认 `true`：console 用户的订阅最常见的用途就是"把我自己提交的
 * 也推给我"，而这一列的缺省就是 `true`（§6.1）。
 */
export const EMPTY_FILTERS: SubscriptionFilterValue = {
  projectTypes: [],
  categoryCodes: [],
  platformTypes: [],
  includePlatformProjects: true,
  includeUncurated: false,
  includeOwnSubmissions: true,
  repoIds: [],
}

/**
 * 把库里的过滤器（`repoIds` 可空）读成表单的形状。
 *
 * `repoIds: null` 与 `repoIds: []` 在库里是两个意思（§6.6 规则 1：空数组是"白名单是空的，
 * 一个都不推"），而表单里只有一个空输入框，所以这里把 `null` 读成 `[]` —— 用户看到"没填"
 * 就是没填，写回去时 `[]` 又会被 `toStoredFilters` 存成 `NULL`。想表达"一个都不推"就在
 * 白名单里填一个不存在的 id，那不是这一层该拦的事。
 */
export function filtersToForm(filters: {
  projectTypes?: ProjectType[]
  categoryCodes?: string[]
  platformTypes?: ProjectType[]
  includePlatformProjects?: boolean
  includeUncurated?: boolean
  includeOwnSubmissions?: boolean
  repoIds?: string[] | null
}): SubscriptionFilterValue {
  return {
    projectTypes: filters.projectTypes ?? [],
    categoryCodes: filters.categoryCodes ?? [],
    platformTypes: filters.platformTypes ?? [],
    includePlatformProjects: filters.includePlatformProjects !== false,
    includeUncurated: filters.includeUncurated === true,
    includeOwnSubmissions: filters.includeOwnSubmissions !== false,
    repoIds: filters.repoIds ?? [],
  }
}

/** 表单 → 请求体。空的数组一律不发，服务层会存成空数组而不是 NULL。 */
export function filtersToInput(value: SubscriptionFilterValue) {
  return {
    ...(value.projectTypes.length > 0 ? { projectTypes: value.projectTypes } : {}),
    ...(value.categoryCodes.length > 0 ? { categoryCodes: value.categoryCodes } : {}),
    ...(value.platformTypes.length > 0 ? { platformTypes: value.platformTypes } : {}),
    ...(value.repoIds.length > 0 ? { repoIds: value.repoIds } : {}),
    includePlatformProjects: value.includePlatformProjects,
    includeUncurated: value.includeUncurated,
    includeOwnSubmissions: value.includeOwnSubmissions,
  }
}

function splitList(value: string): string[] {
  return value
    .split(/[,\s]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
}

export function SubscriptionFiltersForm({
  value,
  onChange,
}: {
  value: SubscriptionFilterValue
  onChange: (next: SubscriptionFilterValue) => void
}) {
  const t = useTranslations("Subscriptions")
  const id = React.useId()

  return (
    <div className="space-y-4">
      <div className="grid gap-2">
        <Label>{t("filterProjectTypes")}</Label>
        <TypePicker
          idPrefix={`${id}-project`}
          selected={value.projectTypes}
          onToggle={(type) =>
            onChange({
              ...value,
              projectTypes: toggle(value.projectTypes, type),
            })
          }
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor={`${id}-categories`}>{t("filterCategoryCodes")}</Label>
        <Input
          id={`${id}-categories`}
          value={value.categoryCodes.join(", ")}
          onChange={(event) =>
            onChange({ ...value, categoryCodes: splitList(event.target.value) })
          }
          placeholder="mcp, radar"
        />
      </div>

      <div className="grid gap-2">
        <Label>{t("filterPlatformTypes")}</Label>
        <TypePicker
          idPrefix={`${id}-platform`}
          selected={value.platformTypes}
          onToggle={(type) =>
            onChange({
              ...value,
              platformTypes: toggle(value.platformTypes, type),
            })
          }
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor={`${id}-repoIds`}>{t("filterRepoIds")}</Label>
        <Input
          id={`${id}-repoIds`}
          value={value.repoIds.join(", ")}
          onChange={(event) =>
            onChange({ ...value, repoIds: splitList(event.target.value) })
          }
          placeholder="aBcDeFgHiJkLmNoP"
        />
        <p className="text-xs text-muted-foreground">{t("filterRepoIdsHint")}</p>
      </div>

      <div className="space-y-3 rounded-md border p-3">
        <SwitchRow
          id={`${id}-platform`}
          label={t("filterIncludePlatform")}
          checked={value.includePlatformProjects}
          onCheckedChange={(checked) =>
            onChange({ ...value, includePlatformProjects: checked })
          }
        />
        <SwitchRow
          id={`${id}-uncurated`}
          label={t("filterIncludeUncurated")}
          checked={value.includeUncurated}
          onCheckedChange={(checked) =>
            onChange({ ...value, includeUncurated: checked })
          }
        />
        <SwitchRow
          id={`${id}-own`}
          label={t("filterIncludeOwn")}
          checked={value.includeOwnSubmissions}
          onCheckedChange={(checked) =>
            onChange({ ...value, includeOwnSubmissions: checked })
          }
        />
      </div>
    </div>
  )
}

function toggle<T>(list: T[], item: T): T[] {
  return list.includes(item)
    ? list.filter((value) => value !== item)
    : [...list, item]
}

function SwitchRow({
  id,
  label,
  checked,
  onCheckedChange,
}: {
  id: string
  label: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <Label htmlFor={id} className="text-sm font-normal">
        {label}
      </Label>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  )
}

function TypePicker({
  idPrefix,
  selected,
  onToggle,
}: {
  idPrefix: string
  selected: ProjectType[]
  onToggle: (type: ProjectType) => void
}) {
  return (
    <div className="flex flex-wrap gap-3">
      {PROJECT_TYPES.map((type) => {
        const id = `${idPrefix}-${type}`
        return (
          <div key={type} className="flex items-center gap-1.5">
            <Checkbox
              id={id}
              checked={selected.includes(type)}
              onCheckedChange={() => onToggle(type)}
            />
            <Label htmlFor={id} className="font-mono text-xs font-normal">
              {type}
            </Label>
          </div>
        )
      })}
    </div>
  )
}

/**
 * 只读摘要。列表里那一列就是它。
 *
 * 白名单优先：非空时下面那些条件**根本不看**（§6.6 的求值顺序是"先命中即短路"），所以
 * 白名单存在时只显示白名单，否则这一行会读成"这些条件都生效"，而实际推的是那 5 个 id。
 */
export function FilterSummary({
  filters,
}: {
  filters: {
    projectTypes?: ProjectType[]
    categoryCodes?: string[]
    platformTypes?: ProjectType[]
    includePlatformProjects?: boolean
    includeUncurated?: boolean
    includeOwnSubmissions?: boolean
    repoIds?: string[] | null
  }
}) {
  const t = useTranslations("Subscriptions")

  const repoIds = filters.repoIds ?? []
  if (repoIds.length > 0) {
    return (
      <Badge variant="outline" className="font-mono text-xs">
        {t("filterWhitelist", { count: repoIds.length })}
      </Badge>
    )
  }

  const badges: React.ReactNode[] = []
  for (const type of filters.projectTypes ?? []) {
    badges.push(
      <Badge key={`p-${type}`} variant="outline" className="font-mono text-xs">
        {type}
      </Badge>
    )
  }
  for (const code of filters.categoryCodes ?? []) {
    badges.push(
      <Badge key={`c-${code}`} variant="outline" className="font-mono text-xs">
        {code}
      </Badge>
    )
  }
  for (const type of filters.platformTypes ?? []) {
    badges.push(
      <Badge key={`t-${type}`} variant="secondary" className="font-mono text-xs">
        {`platform:${type}`}
      </Badge>
    )
  }
  if (filters.includeUncurated) {
    badges.push(
      <Badge key="uncurated" variant="secondary" className="text-xs">
        {t("filterIncludeUncurated")}
      </Badge>
    )
  }
  if (filters.includeOwnSubmissions) {
    badges.push(
      <Badge key="own" variant="secondary" className="text-xs">
        {t("filterIncludeOwnShort")}
      </Badge>
    )
  }

  if (badges.length === 0) {
    return <span className="text-xs text-muted-foreground">{t("filterAll")}</span>
  }

  return <div className="flex flex-wrap gap-1">{badges}</div>
}