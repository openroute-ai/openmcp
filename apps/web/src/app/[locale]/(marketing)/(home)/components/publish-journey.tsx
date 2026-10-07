'use client'

import { Badge } from '@workspace/ui/components/badge'
import { Button } from '@workspace/ui/components/button'
import { Card } from '@workspace/ui/components/card'
import { Skeleton } from '@workspace/ui/components/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@workspace/ui/components/tabs'
import {
  ToggleGroup,
  ToggleGroupItem,
} from '@workspace/ui/components/toggle-group'
import { cn } from '@workspace/ui/lib/utils'
import type { LucideIcon } from 'lucide-react'
import {
  ArrowRight,
  Check,
  Fingerprint,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react'
import { useTranslations } from 'next-intl'
import type * as React from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { LocaleLink } from '@/i18n/navigation'
import { PROVIDER_JOIN_CTA, SUBMIT_SKILL_CTA } from '@/lib/marketing/cta'

/** 吸顶偏移（lg:top-24） */
const STICKY_OFFSET = 96
/** 右侧卡片视口高度 */
const VIEWPORT_HEIGHT = 460
const CARD_HEIGHT = 340
const CARD_GAP = 24
/** 相邻卡片的纵向步长 */
const CARD_STEP = CARD_HEIGHT + CARD_GAP
const STEP_COUNT = 3
/** 滚动行程：卡片依次上移 STEP_COUNT 屏 */
const TRAVEL = STEP_COUNT * CARD_STEP

type ChannelKey = 'personal' | 'enterprise'
type VisualKind = 'identity' | 'review' | 'gate' | 'channels'

interface PublishCard {
  stat: string
  caption: string
  captionIcon?: LucideIcon
  description: string
  visual: VisualKind
}

interface PublishChannel {
  label: string
  cta: string
  href: string
  milestones: { title: string; card: PublishCard }[]
}

const CHANNEL_KEYS = ['personal', 'enterprise'] as const
const milestoneKeys = [1, 2, 3, 4] as const
const stageKeys = [1, 2, 3] as const
const wayKeys = ['web', 'agent', 'cli'] as const
const waySnippets = {
  web: 'openmcp.cn/dashboard/publish',
  agent: 'openmcp skill publish ./my-skill',
  cli: '$ openmcp publish --token $TOKEN',
} as const

/** 里程碑与右侧示意图的对应关系，两条通道一致 */
const visuals = [
  'identity',
  'review',
  'gate',
  'channels',
] as const satisfies readonly VisualKind[]
const captionIcons = [
  undefined,
  undefined,
  ShieldCheck,
  undefined,
] as const satisfies readonly (LucideIcon | undefined)[]

/** 审核流水线各阶段的通过 / 拦截标记，示例数据 */
const stageBlocked = [false, true, false] as const

/**
 * 个人 / 企业两条发布通道的完整链路。
 * 资质认证、安全审核、安全准入、内容指纹等信任卖点在本 section 一次性讲完，
 * 页面其他位置不再重复（90% 分成则只在 ProviderCta 出现）。
 */
export function PublishJourney() {
  const t = useTranslations('Landing.publish')
  const tc = useTranslations('Landing.cta')
  const sectionRef = useRef<HTMLElement>(null)
  const rowRef = useRef<HTMLDivElement>(null)
  const [channel, setChannel] = useState<ChannelKey>('personal')
  const [sectionHeight, setSectionHeight] = useState(VIEWPORT_HEIGHT + TRAVEL)
  const [offset, setOffset] = useState(0)

  const channels = useMemo<Record<ChannelKey, PublishChannel>>(
    () => ({
      personal: {
        label: t('personal.label'),
        cta: tc('submitSkill'),
        href: SUBMIT_SKILL_CTA.href,
        milestones: milestoneKeys.map((key, i) => ({
          title: t(`personal.milestones.${key}.title`),
          card: {
            stat: t(`personal.milestones.${key}.stat`),
            caption: t(`personal.milestones.${key}.caption`),
            description: t(`personal.milestones.${key}.description`),
            visual: visuals[i]!,
            captionIcon: captionIcons[i],
          },
        })),
      },
      enterprise: {
        label: t('enterprise.label'),
        cta: tc('providerJoin'),
        href: PROVIDER_JOIN_CTA.href,
        milestones: milestoneKeys.map((key, i) => ({
          title: t(`enterprise.milestones.${key}.title`),
          card: {
            stat: t(`enterprise.milestones.${key}.stat`),
            caption: t(`enterprise.milestones.${key}.caption`),
            description: t(`enterprise.milestones.${key}.description`),
            visual: visuals[i]!,
            captionIcon: captionIcons[i],
          },
        })),
      },
    }),
    [t, tc]
  )

  const active = channels[channel]

  useEffect(() => {
    const section = sectionRef.current
    const row = rowRef.current
    if (!section || !row) return

    const update = () => {
      const rowHeight = row.getBoundingClientRect().height
      if (rowHeight > 0) {
        const nextHeight = rowHeight + TRAVEL
        setSectionHeight((prev) =>
          Math.abs(prev - nextHeight) > 1 ? nextHeight : prev
        )
      }
      const rect = section.getBoundingClientRect()
      const next =
        Math.min(Math.max((STICKY_OFFSET - rect.top) / TRAVEL, 0), 1) * TRAVEL
      setOffset((prev) => (Math.abs(prev - next) > 0.5 ? next : prev))
    }
    const observer = new ResizeObserver(update)

    update()
    observer.observe(row)
    window.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => {
      observer.disconnect()
      window.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [])

  /** 当前高亮的里程碑：卡片顶端越过视口中线即切换 */
  const activeStep = Math.min(
    active.milestones.length - 1,
    Math.max(0, Math.floor((offset + VIEWPORT_HEIGHT / 2) / CARD_STEP))
  )

  return (
    <section
      ref={sectionRef}
      aria-label={t('ariaLabel')}
      className="w-full lg:h-[var(--journey-height)]"
      style={
        { '--journey-height': `${sectionHeight}px` } as React.CSSProperties
      }
    >
      <div className="w-full lg:sticky lg:top-24">
        <div
          ref={rowRef}
          className="py-18 mx-auto flex w-full max-w-page flex-col gap-10 px-5 sm:px-6 lg:min-h-[460px] lg:flex-row lg:gap-16 lg:px-10"
        >
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="mb-4 inline-flex w-fit items-center gap-1.5 rounded-full border border-border bg-muted/40 px-3 py-1 text-xs font-medium text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5 text-primary" />
              {t('eyebrow')}
            </span>
            <h2 className="mb-2 text-title font-medium tracking-tight text-foreground">
              {t('titleLead')}
              <br />
              {t('titleAccent')}
            </h2>
            <p className="mb-5 max-w-[420px] text-small text-muted-foreground xl:mb-6">
              {t('description')}
            </p>

            <Tabs
              className="mb-3 xl:mb-4"
              value={channel}
              onValueChange={(value) => setChannel(value as ChannelKey)}
            >
              <TabsList className="h-10 w-[196px] rounded-[10px]">
                {CHANNEL_KEYS.map((key) => (
                  <TabsTrigger className="text-sm" key={key} value={key}>
                    {channels[key].label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>

            <ol className="hidden flex-col lg:flex">
              {active.milestones.map((milestone, i) => (
                <li
                  className="flex items-center gap-3 py-1.5 xl:py-2"
                  key={milestone.title}
                >
                  <span
                    className={cn(
                      'h-1.5 w-1.5 shrink-0 rounded-full transition-all duration-300',
                      i === activeStep ? 'bg-foreground' : 'bg-foreground/15'
                    )}
                  />
                  <span
                    className={cn(
                      'text-small transition-colors duration-300',
                      i === activeStep
                        ? 'font-semibold text-foreground'
                        : 'text-foreground/40'
                    )}
                  >
                    {milestone.title}
                  </span>
                </li>
              ))}
            </ol>

            <Button
              asChild
              size="lg"
              className="mt-5 w-fit rounded-full hover:bg-foreground/90 xl:mt-6"
            >
              <LocaleLink href={active.href}>
                {active.cta}
                <ArrowRight className="h-3.5 w-3.5" />
              </LocaleLink>
            </Button>
          </div>

          <div className="relative flex flex-col gap-4 lg:h-[460px] lg:w-[60%] lg:shrink-0 lg:gap-0 lg:overflow-hidden">
            {active.milestones.map((milestone, i) => (
              <Card
                key={milestone.title}
                className="relative gap-0 overflow-hidden rounded-2xl border-0 bg-muted p-6 shadow-none lg:absolute lg:top-0 lg:right-0 lg:left-0 lg:h-[340px] lg:[transform:translateY(var(--card-y))] lg:p-8"
                style={
                  {
                    '--card-y': `${i * CARD_STEP - offset}px`,
                  } as React.CSSProperties
                }
              >
                <div className="relative z-10 flex h-full max-w-full flex-col lg:max-w-[46%] xl:max-w-[300px]">
                  <p className="text-subtitle font-medium text-foreground">
                    {milestone.card.stat}
                  </p>
                  <p className="mt-2 flex items-center gap-1.5 text-[13px] leading-[20px] text-muted-foreground">
                    {milestone.card.captionIcon && (
                      <milestone.card.captionIcon className="h-3.5 w-3.5 text-emerald-600" />
                    )}
                    {milestone.card.caption}
                  </p>
                  <p className="mt-auto pt-6 text-[13px] leading-[22px] text-muted-foreground">
                    {milestone.card.description}
                  </p>
                </div>
                <div className="absolute right-6 bottom-6 hidden w-[42%] lg:block xl:w-[48%]">
                  <CardVisual kind={milestone.card.visual} />
                </div>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-background p-4 shadow-sm">
      {children}
    </div>
  )
}

function IdentityVisual() {
  const tv = useTranslations('Landing.publish.visual')

  return (
    <Panel>
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Fingerprint className="h-4 w-4" />
        </div>
        <div className="flex-1 space-y-1.5">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-2.5 w-28" />
        </div>
        <Badge variant="secondary">
          <Check />
          {tv('verified')}
        </Badge>
      </div>
      <div className="mt-4 space-y-2">
        <Skeleton className="h-2.5 w-full" />
        <Skeleton className="h-2.5 w-4/5" />
      </div>
      <div className="mt-4 flex h-8 items-center justify-center rounded-full bg-foreground text-xs font-medium text-background">
        {tv('submit')}
      </div>
    </Panel>
  )
}

function ReviewVisual() {
  const tv = useTranslations('Landing.publish.visual')

  return (
    <Panel>
      <div className="mb-3 text-xs font-medium text-foreground">
        {tv('reviewTitle')}
      </div>
      <div className="space-y-2">
        {stageKeys.map((key, i) => {
          const blocked = stageBlocked[i]!
          return (
            <div
              className="flex items-center gap-2 rounded-lg bg-muted/60 px-2.5 py-2"
              key={key}
            >
              {blocked ? (
                <TriangleAlert className="h-3.5 w-3.5 text-destructive" />
              ) : (
                <Check className="h-3.5 w-3.5 text-emerald-600" />
              )}
              <span className="flex-1 text-xs text-muted-foreground">
                {tv(`reviewStages.${key}`)}
              </span>
              <span className="font-mono text-[10px] text-foreground/60">
                {tv(blocked ? 'blocked' : 'passed')}
              </span>
            </div>
          )
        })}
      </div>
    </Panel>
  )
}

function GateVisual() {
  const tv = useTranslations('Landing.publish.visual')

  return (
    <Panel>
      <div className="mb-3 flex items-center gap-1.5 text-xs font-medium text-foreground">
        <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
        {tv('gateTitle')}
      </div>
      <div className="space-y-2">
        {stageKeys.map((key, i) => (
          <div className="flex items-center gap-2" key={key}>
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border bg-background font-mono text-[10px] text-foreground/60">
              {String(i + 1).padStart(2, '0')}
            </div>
            <span className="text-xs text-muted-foreground">
              {tv(`gateStages.${key}`)}
            </span>
            <Check className="ml-auto h-3.5 w-3.5 text-emerald-600" />
          </div>
        ))}
      </div>
    </Panel>
  )
}

function ChannelsVisual() {
  const tv = useTranslations('Landing.publish.visual')
  const [way, setWay] = useState('web')
  const active = wayKeys.find((key) => key === way) ?? 'web'

  return (
    <Panel>
      <ToggleGroup
        type="single"
        value={active}
        onValueChange={setWay}
        variant="outline"
        size="sm"
        className="w-full"
      >
        {wayKeys.map((key) => (
          <ToggleGroupItem className="flex-1 text-xs" key={key} value={key}>
            {tv(`ways.${key}.label`)}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <div className="mt-3 space-y-2 rounded-lg bg-foreground p-3 font-mono text-[11px] leading-relaxed text-background">
        <p className="truncate">{waySnippets[active]}</p>
        <p className="text-background/60">{tv(`ways.${active}.caption`)}</p>
      </div>
    </Panel>
  )
}

function CardVisual({ kind }: { kind: VisualKind }) {
  if (kind === 'identity') return <IdentityVisual />
  if (kind === 'review') return <ReviewVisual />
  if (kind === 'gate') return <GateVisual />
  return <ChannelsVisual />
}
