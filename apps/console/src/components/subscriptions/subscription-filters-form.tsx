/**
 * 订阅过滤器的编辑器与只读摘要。
 *
 * 一份 schema 两处用：`SubscriptionFiltersForm` 是建订阅与改订阅时填的，`FilterSummary`
 * 是列表与详情里显示的。两者必须同源——分开写就会出现"保存的是 A、显示的是 B"，而订阅
 * 方判断一条订阅推的是不是他要的东西，靠的正是这个摘要。
 *
 * ## 分类是下拉多选，仓库 id 是多行框
 *
 * 两处控件都跟着数据的形状走，而不是跟着"实现起来多便宜"走：
 *
 * - `categoryCodes` 是 `categories.code`，运营会随时加，而读者要的是**挑一个**而不是
 *   记住一个 slug。文本框的错误只在投递时才暴露（`matchedRepos` 变成一个讲不通的数字），
 *   所以这里给下拉：选项来自 `tags.categories`，值仍然是 code，服务层的 zod 与投递时的
 *   `in (...)` 一点没变。**已存的 code 不会因为选项里没有它而被丢掉**——删过分类的
 *   订阅在下拉里照样看得到自己选了什么，否则一次只改名字的保存就会悄悄改掉推送范围。
 * - `repoIds` 是一串 id，一个逗号分隔的单行输入框要横向滚动才看得全，而"我是不是把
 *   那个 id 复制全了"恰恰是这里最常问的问题。多行框让它逐行可见，分隔符仍然兼容逗号。
 *
 * ## 刻意不给的两个开关
 *
 * `includePlatformProjects` 与 `includeUncurated` 在表单里没有控件，但字段还在：
 * `filtersToForm` / `filtersToInput` 照常往返，所以改一条已有订阅不会把它们改成默认值。
 * 它们的缺省由 `resolveIncludeUncurated` 推导、由列默认值兜底，读者不该在每次建订阅时
 * 被问一遍"要不要纳入未策展的仓库"——那是产品口径，不是每条订阅的选择。
 */
"use client"

import * as React from "react"
import { useTranslations } from "next-intl"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@workspace/ui/components/command"
import { Label } from "@workspace/ui/components/label"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover"
import { Switch } from "@workspace/ui/components/switch"
import { Textarea } from "@workspace/ui/components/textarea"
import { IconCheck, IconChevronDown } from "@tabler/icons-react"
import { PROJECT_TYPES, type ProjectType } from "@/db/schema/github"
import { useTRPC } from "@/lib/trpc/client"
import { useQuery } from "@tanstack/react-query"

export interface SubscriptionFilterValue {
  projectTypes: ProjectType[]
  categoryCodes: string[]
  includePlatformProjects: boolean
  includeUncurated: boolean
  includeOwnSubmissions: boolean
  repoIds: string[]
}

/**
 * 空过滤器，也就是 `filters: {}` 的形状。
 *
 * `includeOwnSubmissions` 默认 `true`：console 用户的订阅最常见的用途就是"把我自己提交的
 * 也推给我"，而这一列的缺省就是 `true`（§6.1）。另外两个开关不在表单里，见文件头。
 */
export const EMPTY_FILTERS: SubscriptionFilterValue = {
  projectTypes: [],
  categoryCodes: [],
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
  includePlatformProjects?: boolean
  includeUncurated?: boolean
  includeOwnSubmissions?: boolean
  repoIds?: string[] | null
}): SubscriptionFilterValue {
  return {
    projectTypes: filters.projectTypes ?? [],
    categoryCodes: filters.categoryCodes ?? [],
    includePlatformProjects: filters.includePlatformProjects !== false,
    includeUncurated: filters.includeUncurated === true,
    includeOwnSubmissions: filters.includeOwnSubmissions !== false,
    repoIds: filters.repoIds ?? [],
  }
}

/**
 * 表单 → 请求体。空的数组一律不发，服务层会存成空数组而不是 NULL。
 *
 * 两个没有控件的开关**照发**：省掉它们会让服务层重新推导 `includeUncurated`，而推导
 * 的结果与这条订阅已存的值可以不同——一次只改了名字的保存因此会悄悄改掉推送范围。
 */
export function filtersToInput(value: SubscriptionFilterValue) {
  return {
    ...(value.projectTypes.length > 0
      ? { projectTypes: value.projectTypes }
      : {}),
    ...(value.categoryCodes.length > 0
      ? { categoryCodes: value.categoryCodes }
      : {}),
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
        <Label>{t("filterCategoryCodes")}</Label>
        <CategoryPicker
          value={value.categoryCodes}
          onChange={(categoryCodes) => onChange({ ...value, categoryCodes })}
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor={`${id}-repoIds`}>{t("filterRepoIds")}</Label>
        <Textarea
          id={`${id}-repoIds`}
          value={value.repoIds.join("\n")}
          onChange={(event) =>
            onChange({ ...value, repoIds: splitList(event.target.value) })
          }
          placeholder={"V1StGXR8Z5jd\nxUcFqN0dPwAb"}
          rows={3}
        />
        <p className="text-xs text-muted-foreground">
          {t("filterRepoIdsHint")}
        </p>
      </div>

      <div className="rounded-md border p-3">
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

/**
 * 运营分类的多选。
 *
 * 值是 `categories.code`（投递时走 `in (...)`），显示的是 `name`。选项来自
 * `tags.categories`：**不过滤 `isActive`**——停用一个分类只是让它不再有新项目，
 * 已经归档在它名下的仓库仍然该被这条订阅推到，而过滤器读的是历史事实。
 */
function CategoryPicker({
  value,
  onChange,
}: {
  value: string[]
  onChange: (next: string[]) => void
}) {
  const t = useTranslations("Subscriptions")
  const trpc = useTRPC()
  const [open, setOpen] = React.useState(false)
  const categories = useQuery(trpc.tags.categories.queryOptions())

  const options = React.useMemo(() => categories.data ?? [], [categories.data])
  const known = React.useMemo(
    () => new Set(options.map((option) => option.code)),
    [options]
  )
  // 选项里没有的 code（分类被删了）必须继续留在下拉里，否则这个订阅的范围会在
  // 读者毫不知情的情况下缩小——他只是打开看了一眼，没打算改。
  const stale = value.filter((code) => !known.has(code))
  const nameOf = (code: string) =>
    options.find((option) => option.code === code)?.name ?? code

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="h-9 w-full justify-between gap-2 px-3 font-normal disabled:opacity-60"
          disabled={categories.isPending}
        >
          <span className="truncate">
            {value.length === 0
              ? t("filterCategoryAny")
              : value.map(nameOf).join("、")}
          </span>
          <IconChevronDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-(--radix-popover-trigger-width) p-0"
      >
        <Command>
          <CommandInput placeholder={t("categorySearch")} />
          <CommandList>
            <CommandEmpty>
              {categories.isPending ? "…" : t("categoryEmpty")}
            </CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CategoryOption
                  key={option.code}
                  code={option.code}
                  name={option.name}
                  checked={value.includes(option.code)}
                  onCheckedChange={() => onChange(toggle(value, option.code))}
                />
              ))}
              {stale.map((code) => (
                <CategoryOption
                  key={code}
                  code={code}
                  name={code}
                  checked
                  onCheckedChange={() =>
                    onChange(value.filter((item) => item !== code))
                  }
                />
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function CategoryOption({
  code,
  name,
  checked,
  onCheckedChange,
}: {
  code: string
  name: string
  checked: boolean
  onCheckedChange: () => void
}) {
  return (
    <CommandItem
      value={`${name} ${code}`}
      onSelect={() => onCheckedChange()}
      className="gap-2"
    >
      <Checkbox checked={checked} className="pointer-events-none" />
      <span className="truncate">{name}</span>
      <span className="ml-auto font-mono text-xs text-muted-foreground">
        {code}
      </span>
      {checked ? <IconCheck className="size-4" /> : null}
    </CommandItem>
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
    return (
      <span className="text-xs text-muted-foreground">{t("filterAll")}</span>
    )
  }

  return <div className="flex flex-wrap gap-1">{badges}</div>
}
