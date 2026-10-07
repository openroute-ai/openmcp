'use client'

import { Avatar, AvatarFallback, AvatarImage } from '@workspace/ui/components/avatar'
import { CheckCircle2, Globe, Link2 } from 'lucide-react'
import { useTranslations } from 'next-intl'

interface AuthorHeroProps {
  author: {
    id: string
    name: string
    username: string
    avatar: string | null
    description?: string
    website?: string
    workflowCount: number
    skillCount: number
    personaCount: number
    verified?: boolean
    hasLinks?: boolean
  }
}

export function AuthorHero({ author }: AuthorHeroProps) {
  const t = useTranslations('AuthorsPage.authorDetail')

  return (
    <div className='mx-auto w-full max-w-7xl px-5 py-10 sm:px-6 lg:px-10'>
      <div className='flex flex-col items-center gap-6 md:flex-row md:items-start'>
        <div className='h-24 w-24 flex-shrink-0 overflow-hidden rounded-full md:h-32 md:w-32'>
          <Avatar className='h-full w-full'>
            <AvatarImage src={author.avatar || '/placeholder-avatar.png'} alt={`${author.name}'s avatar`} />
            <AvatarFallback className='text-2xl'>{author.name.charAt(0)}</AvatarFallback>
          </Avatar>
        </div>

        <div className='flex-1 text-center md:text-left'>
          <div className='mb-2 flex items-center justify-center md:justify-start'>
            <h1 className='font-bold text-foreground text-5xl'>{author.name}</h1>
            {author.verified && <CheckCircle2 className='ml-2 h-6 w-6 flex-shrink-0 text-primary' />}
          </div>

          <p className='mb-2 text-lg text-muted-foreground'>@{author.username}</p>

          {author.description && (
            <p className='mb-4 max-w-2xl whitespace-pre-line text-foreground'>{author.description}</p>
          )}

          {author.website && (
            <div className='mb-4'>
              <div className='flex items-center justify-center text-muted-foreground text-sm md:justify-start'>
                <Globe className='mr-2 h-4 w-4' />
                <a
                  href={author.website}
                  target='_blank'
                  rel='noopener noreferrer'
                  className='break-all text-primary transition-colors hover:text-primary/80'
                >
                  {author.website}
                </a>
              </div>
            </div>
          )}

          <div className='flex flex-wrap items-center justify-center gap-2 md:justify-start'>
            <div className='inline-flex items-center rounded-full bg-primary/10 px-3 py-1 text-primary'>
              <span className='font-semibold'>{author.skillCount}</span>
              <span className='ml-1'>{t('statSkills')}</span>
            </div>
            <div className='inline-flex items-center rounded-full bg-primary/10 px-3 py-1 text-primary'>
              <span className='font-semibold'>{author.workflowCount}</span>
              <span className='ml-1'>{t('statWorkflows')}</span>
            </div>
            <div className='inline-flex items-center rounded-full bg-primary/10 px-3 py-1 text-primary'>
              <span className='font-semibold'>{author.personaCount}</span>
              <span className='ml-1'>{t('statPersonas')}</span>
            </div>
          </div>

          {author.hasLinks && (
            <div className='mt-3 flex items-center justify-center text-muted-foreground text-xs md:justify-start'>
              <Link2 className='mr-1 h-3 w-3' />
              <span>{t('hasLinksNote')}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
