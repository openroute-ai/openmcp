'use client'

import { ChevronDown, ChevronUp } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface A2aDetailContentProps {
  description: string
  agentCard: Record<string, unknown> | null
}

type SkillRecord = { name?: unknown; description?: unknown; id?: unknown }

function skillList(agentCard: Record<string, unknown> | null): SkillRecord[] {
  const skills = agentCard?.skills
  return Array.isArray(skills) ? (skills as SkillRecord[]) : []
}

export function A2aDetailContent({ description, agentCard }: A2aDetailContentProps) {
  const t = useTranslations('A2APage.detail')
  const [descriptionOpen, setDescriptionOpen] = useState(true)
  const [cardOpen, setCardOpen] = useState(true)
  const [skillsOpen, setSkillsOpen] = useState(true)

  const skills = skillList(agentCard)

  return (
    <>
      <section className='mb-8 rounded-lg border border-border bg-card shadow-sm'>
        <button
          type='button'
          onClick={() => setDescriptionOpen((v) => !v)}
          className='flex w-full items-center justify-between p-4 text-left transition-colors hover:bg-muted/50'
          aria-expanded={descriptionOpen}
        >
          <h2 className='font-semibold text-lg'>{t('overview')}</h2>
          {descriptionOpen ? (
            <ChevronUp className='h-5 w-5 text-muted-foreground' />
          ) : (
            <ChevronDown className='h-5 w-5 text-muted-foreground' />
          )}
        </button>
        {descriptionOpen && (
          <div className='border-border border-t p-6 sm:p-10'>
            {description ? (
              <div className='prose dark:prose-invert prose-p:my-4 max-w-none prose-headings:scroll-mt-20 prose-code:rounded prose-pre:border prose-pre:border-border prose-code:bg-muted prose-pre:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-headings:font-bold prose-a:text-primary prose-code:text-foreground prose-h1:text-3xl prose-h2:text-2xl prose-h3:text-xl prose-strong:text-foreground prose-p:leading-relaxed prose-a:no-underline prose-code:before:content-none prose-code:after:content-none hover:prose-a:underline'>
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    // A remote markdown body can reference images; drop empty
                    // sources rather than rendering a broken <img>.
                    img: ({ src, ...props }) => (src ? <img src={src} alt='' {...props} /> : null),
                  }}
                >
                  {description}
                </ReactMarkdown>
              </div>
            ) : (
              <p className='text-muted-foreground'>{t('noDescription')}</p>
            )}
          </div>
        )}
      </section>

      {skills.length > 0 && (
        <section className='mb-8 rounded-lg border border-border bg-card shadow-sm'>
          <button
            type='button'
            onClick={() => setSkillsOpen((v) => !v)}
            className='flex w-full items-center justify-between p-4 text-left transition-colors hover:bg-muted/50'
            aria-expanded={skillsOpen}
          >
            <h2 className='font-semibold text-lg'>{t('skillsCount', { count: skills.length })}</h2>
            {skillsOpen ? (
              <ChevronUp className='h-5 w-5 text-muted-foreground' />
            ) : (
              <ChevronDown className='h-5 w-5 text-muted-foreground' />
            )}
          </button>
          {skillsOpen && (
            <div className='border-border border-t p-6'>
              <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
                {skills.map((skill, index) => {
                  const name = String(skill.name ?? skill.id ?? `skill-${index + 1}`)
                  const skillDescription = String(skill.description ?? '')
                  return (
                    <div key={`${name}-${index}`} className='rounded-lg border bg-muted/30 p-4'>
                      <p className='mb-1 font-mono font-medium text-foreground text-sm'>{name}</p>
                      {skillDescription && <p className='text-muted-foreground text-sm'>{skillDescription}</p>}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </section>
      )}

      {agentCard && (
        <section className='mb-8 rounded-lg border border-border bg-card shadow-sm'>
          <button
            type='button'
            onClick={() => setCardOpen((v) => !v)}
            className='flex w-full items-center justify-between p-4 text-left transition-colors hover:bg-muted/50'
            aria-expanded={cardOpen}
          >
            <h2 className='font-semibold text-lg'>{t('agentCard')}</h2>
            {cardOpen ? (
              <ChevronUp className='h-5 w-5 text-muted-foreground' />
            ) : (
              <ChevronDown className='h-5 w-5 text-muted-foreground' />
            )}
          </button>
          {cardOpen && (
            <div className='border-border border-t p-6'>
              <pre className='max-h-[32rem] overflow-auto text-muted-foreground text-sm'>
                {JSON.stringify(agentCard, null, 2)}
              </pre>
            </div>
          )}
        </section>
      )}
    </>
  )
}
