'use client'

import { Alert, AlertDescription, AlertTitle } from '@workspace/ui/components/alert'
import { Badge } from '@workspace/ui/components/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@workspace/ui/components/tabs'
import { ShieldAlert, ShieldCheck } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { OpenmcpEvalReportV1 } from '@/lib/skills/eval-report'

interface SkillDetailContentProps {
  skill: {
    description: string
    readme: string | null
    scenario: string | null
    features: string[] | null
    securityGrade: string | null
    securityFlags: unknown[] | null
    securityLlmAnalysis: unknown
    evalReport: OpenmcpEvalReportV1 | null
    trustTier: number | null
  }
}

type LlmAnalysis = {
  riskSummary?: string
  recommendation?: string
  confidence?: number | string
  findings?: Array<{ title?: string; detail?: string; severity?: string } | string>
}

function proseClassName() {
  return 'prose dark:prose-invert prose-p:my-4 max-w-none prose-headings:scroll-mt-20 prose-code:rounded prose-pre:border prose-pre:border-border prose-code:bg-muted prose-pre:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-headings:font-bold prose-a:text-primary prose-code:text-foreground prose-h1:text-3xl prose-h2:text-2xl prose-h3:text-xl prose-strong:text-foreground prose-p:leading-relaxed prose-a:no-underline prose-code:before:content-none prose-code:after:content-none hover:prose-a:underline'
}

export function SkillDetailContent({ skill }: SkillDetailContentProps) {
  const t = useTranslations('SkillPage.detail')
  const analysis = (skill.securityLlmAnalysis ?? null) as LlmAnalysis | null
  const defaultTab = skill.securityGrade === 'caution' ? 'security' : 'overview'

  const flagRows = useMemo(() => {
    const flags = Array.isArray(skill.securityFlags) ? skill.securityFlags : []
    return flags.map((flag, index) => {
      if (flag && typeof flag === 'object') {
        const record = flag as Record<string, unknown>
        return {
          key: String(record.id ?? record.name ?? index),
          name: String(record.name ?? record.id ?? t('flagFallback', { index: index + 1 })),
          severity: record.severity ? String(record.severity) : null,
          path: record.path || record.file ? String(record.path ?? record.file) : null,
          snippet: record.snippet ? String(record.snippet) : null,
        }
      }
      return {
        key: String(index),
        name: String(flag),
        severity: null,
        path: null,
        snippet: null,
      }
    })
  }, [skill.securityFlags, t])

  const trustScore =
    skill.evalReport?.dimensions?.trust ??
    (skill.securityGrade === 'safe' ? (skill.certified ? 4.5 : 4.0) : skill.securityGrade === 'caution' ? 3.0 : null)

  return (
    <Tabs defaultValue={defaultTab} className='w-full'>
      <TabsList variant='line' className='mb-4 w-full justify-start'>
        <TabsTrigger value='overview'>{t('tabOverview')}</TabsTrigger>
        <TabsTrigger value='readme'>{t('tabReadme')}</TabsTrigger>
        <TabsTrigger value='security'>{t('tabSecurity')}</TabsTrigger>
        <TabsTrigger value='eval'>{t('tabEval')}</TabsTrigger>
      </TabsList>

      <TabsContent value='overview' className='space-y-6'>
        <section className='rounded-lg border border-border bg-card p-6 shadow-sm'>
          <h2 className='mb-4 font-semibold text-lg'>{t('overview')}</h2>
          <div className={proseClassName()}>
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                img: ({ src, ...props }) => (src ? <img src={src} alt='' {...props} /> : null),
              }}
            >
              {skill.description || t('noDescription')}
            </ReactMarkdown>
          </div>
        </section>

        {skill.scenario ? (
          <section className='rounded-lg border border-border bg-card p-6 shadow-sm'>
            <h2 className='mb-3 font-semibold text-lg'>{t('scenario')}</h2>
            <p className='whitespace-pre-wrap text-muted-foreground text-sm leading-relaxed'>{skill.scenario}</p>
          </section>
        ) : null}

        {skill.features && skill.features.length > 0 ? (
          <section className='rounded-lg border border-border bg-card p-6 shadow-sm'>
            <h2 className='mb-3 font-semibold text-lg'>{t('features')}</h2>
            <ul className='list-disc space-y-1.5 pl-5 text-sm leading-relaxed'>
              {skill.features.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
          </section>
        ) : null}
      </TabsContent>

      <TabsContent value='readme'>
        <section className='rounded-lg border border-border bg-card p-6 shadow-sm'>
          <h2 className='mb-4 font-semibold text-lg'>{t('readme')}</h2>
          <div className={proseClassName()}>
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                img: ({ src, ...props }) => (src ? <img src={src} alt='' {...props} /> : null),
              }}
            >
              {skill.readme || t('noReadme')}
            </ReactMarkdown>
          </div>
        </section>
      </TabsContent>

      <TabsContent value='security' className='space-y-4'>
        <section className='rounded-lg border border-border bg-card p-6 shadow-sm'>
          <div className='mb-4 flex flex-wrap items-center gap-2'>
            <h2 className='font-semibold text-lg'>{t('securityReport')}</h2>
            {skill.securityGrade === 'safe' ? (
              <Badge variant='secondary' className='border-green-200 bg-green-50 text-green-700'>
                <ShieldCheck className='mr-1 h-3.5 w-3.5' />
                {t('safe')}
              </Badge>
            ) : null}
            {skill.securityGrade === 'caution' ? (
              <Badge variant='secondary' className='border-yellow-200 bg-yellow-50 text-yellow-700'>
                <ShieldAlert className='mr-1 h-3.5 w-3.5' />
                {t('caution')}
              </Badge>
            ) : null}
            {skill.trustTier != null ? (
              <Badge variant='outline'>{t('trustTier', { tier: skill.trustTier })}</Badge>
            ) : null}
          </div>

          {skill.securityGrade === 'caution' ? (
            <Alert className='mb-4'>
              <ShieldAlert className='h-4 w-4' />
              <AlertTitle>{t('cautionTitle')}</AlertTitle>
              <AlertDescription>
                {analysis?.riskSummary || t('cautionBody')}
              </AlertDescription>
            </Alert>
          ) : null}

          {analysis?.riskSummary && skill.securityGrade !== 'caution' ? (
            <p className='mb-4 text-muted-foreground text-sm leading-relaxed'>{analysis.riskSummary}</p>
          ) : null}

          {analysis?.recommendation ? (
            <p className='mb-4 text-sm leading-relaxed'>
              <span className='font-medium'>{t('recommendation')}: </span>
              {analysis.recommendation}
            </p>
          ) : null}

          {flagRows.length > 0 ? (
            <div className='space-y-3'>
              <h3 className='font-medium text-sm'>{t('flagsHeading')}</h3>
              {flagRows.map((row) => (
                <div key={row.key} className='rounded-md border border-border bg-muted/20 p-3 text-sm'>
                  <div className='flex flex-wrap items-center gap-2'>
                    <span className='font-medium'>{row.name}</span>
                    {row.severity ? <Badge variant='outline'>{row.severity}</Badge> : null}
                  </div>
                  {row.path ? <p className='mt-1 font-mono text-muted-foreground text-xs'>{row.path}</p> : null}
                  {row.snippet ? (
                    <pre className='mt-2 overflow-x-auto rounded bg-muted p-2 text-xs'>{row.snippet}</pre>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <p className='text-muted-foreground text-sm'>{t('noFlags')}</p>
          )}
        </section>
      </TabsContent>

      <TabsContent value='eval'>
        <section className='rounded-lg border border-border bg-card p-6 shadow-sm'>
          <h2 className='mb-4 font-semibold text-lg'>{t('evalReport')}</h2>
          {skill.evalReport ? (
            <div className='space-y-4'>
              <div className='flex items-end gap-3'>
                <span className='font-bold text-3xl tabular-nums'>{skill.evalReport.overall.toFixed(1)}</span>
                <span className='mb-1 text-muted-foreground text-sm'>/ 5</span>
              </div>
              <div className='space-y-3'>
                {(
                  [
                    ['trust', skill.evalReport.dimensions.trust],
                    ['reliability', skill.evalReport.dimensions.reliability],
                    ['adaptability', skill.evalReport.dimensions.adaptability],
                    ['convention', skill.evalReport.dimensions.convention],
                    ['effectiveness', skill.evalReport.dimensions.effectiveness],
                  ] as const
                ).map(([key, value]) => (
                  <div key={key}>
                    <div className='mb-1 flex items-center justify-between text-sm'>
                      <span>{t(`evalDim.${key}`)}</span>
                      <span className='tabular-nums'>{value.toFixed(1)}/5</span>
                    </div>
                    <div className='h-2 overflow-hidden rounded-full bg-muted'>
                      <div
                        className='h-full rounded-full bg-primary'
                        style={{ width: `${Math.max(0, Math.min(100, (value / 5) * 100))}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className='space-y-3'>
              <p className='text-muted-foreground text-sm'>{t('evalEmpty')}</p>
              {trustScore != null ? (
                <div>
                  <div className='mb-1 flex items-center justify-between text-sm'>
                    <span>{t('evalDim.trust')}</span>
                    <span className='tabular-nums'>{Number(trustScore).toFixed(1)}/5</span>
                  </div>
                  <div className='h-2 overflow-hidden rounded-full bg-muted'>
                    <div
                      className='h-full rounded-full bg-primary'
                      style={{ width: `${Math.max(0, Math.min(100, (Number(trustScore) / 5) * 100))}%` }}
                    />
                  </div>
                  <p className='mt-2 text-muted-foreground text-xs'>{t('evalTrustHint')}</p>
                </div>
              ) : null}
            </div>
          )}
        </section>
      </TabsContent>
    </Tabs>
  )
}
