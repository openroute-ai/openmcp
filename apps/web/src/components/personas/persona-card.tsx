'use client'

import { useTranslations } from 'next-intl'
import { LocaleLink } from '@/i18n/navigation'

const GRADIENT_PALETTES = [
  'bg-gradient-to-b from-[#FFEBCA] to-white',
  'bg-gradient-to-b from-[#E5EFFF] to-white',
  'bg-gradient-to-b from-[#FFE8EC] to-white',
  'bg-gradient-to-b from-[#E6E7FF] to-white',
  'bg-gradient-to-b from-[#D6F5D6] to-white',
] as const

type PersonaCardData = {
  id: string
  slug: string
  code: string
  title: string
  description: string
  author: string
  imageUrl: string
  category: string | null
  price: string
  certified: boolean
  views: number
  downloads: number
  date: string
}

interface PersonaCardProps {
  persona: PersonaCardData
}

function pickPalette(id: string) {
  let hash = 0
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  }
  return GRADIENT_PALETTES[hash % GRADIENT_PALETTES.length]
}

export function PersonaCard({ persona }: PersonaCardProps) {
  const t = useTranslations('Personas.card')
  const palette = pickPalette(persona.id)
  const tag = persona.category || persona.price

  return (
    <LocaleLink
      href={`/personas/${persona.slug}`}
      prefetch={false}
      aria-label={t('ariaLabel', { code: persona.code || '', title: persona.title })}
      className='group flex h-[256px] w-[182px] flex-col items-center [perspective:1000px]'
    >
      <div className='relative h-full w-full transition-transform duration-500 [transform-style:preserve-3d] group-hover:[transform:rotateY(180deg)] group-focus-visible:[transform:rotateY(180deg)]'>
        {/* front */}
        <div
          className={`absolute inset-0 overflow-hidden rounded-lg border-2 border-white shadow-[0_20px_48px_rgba(0,0,0,0.05)] transition-shadow duration-300 [backface-visibility:hidden] group-hover:pointer-events-none group-hover:shadow-[0_28px_54px_rgba(0,0,0,0.07)] ${palette}`}
        >
          <div
            aria-hidden='true'
            className='absolute inset-0 bg-[radial-gradient(circle_at_50%_38%,rgba(255,255,255,0.68)_0%,rgba(255,255,255,0.24)_44%,rgba(255,255,255,0)_76%)]'
          />
          <div
            aria-hidden='true'
            className='absolute inset-x-0 bottom-0 h-[116px] bg-gradient-to-t from-white via-white/80 to-transparent'
          />
          <div className='relative flex h-full w-full flex-col p-3'>
            <div className='flex items-start justify-between'>
              <span className='rounded-full bg-white/85 px-3 py-1.5 font-semibold text-[13px] text-black/60 leading-none tracking-[0.02em] shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]'>
                {persona.code || 'SOUL'}
              </span>
              <span
                aria-hidden='true'
                className={`mt-1 h-[7px] w-[7px] rounded-full ${persona.certified ? 'bg-green-500' : 'bg-black/20'}`}
              />
            </div>
            <div className='flex flex-1 items-center justify-center pt-1 pb-[76px]'>
              <div className='h-[130px] w-[130px] overflow-hidden rounded-full border-2 border-white/85 bg-white/30 shadow-[0_12px_26px_rgba(0,0,0,0.08)]'>
                <img
                  alt=''
                  draggable='false'
                  className='h-full w-full select-none object-cover'
                  src={persona.imageUrl || '/assets/svg/placeholder-workflow.svg'}
                />
              </div>
            </div>
            <div className='absolute right-3 bottom-[22px] left-3 text-center'>
              <span className='block w-full max-w-full truncate font-medium text-[22px] text-black'>
                {persona.title}
              </span>
            </div>
          </div>
        </div>

        {/* back */}
        <div
          className={`pointer-events-none absolute inset-0 overflow-hidden rounded-lg border-2 border-white p-3 text-left shadow-[0_20px_48px_rgba(0,0,0,0.05)] [backface-visibility:hidden] [transform:rotateY(180deg)] group-hover:pointer-events-auto ${palette}`}
        >
          <div
            aria-hidden='true'
            className='absolute inset-0 opacity-20'
            style={{
              backgroundImage: `url(${persona.imageUrl || '/assets/svg/placeholder-workflow.svg'})`,
              backgroundPosition: 'center top',
              backgroundSize: 'cover',
            }}
          />
          <div aria-hidden='true' className='absolute inset-0 bg-white/30' />
          <div className='relative flex h-full flex-col rounded-md border border-white/70 bg-white/60 px-3 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)]'>
            <div className='flex items-start justify-between gap-3'>
              <span className='max-w-[116px] truncate font-bold text-[15px] text-black leading-[1.45]'>
                {persona.code ? `${persona.code}・` : ''}
                {persona.title}
              </span>
              <span className='shrink-0 rounded-full bg-black/5 px-2 py-1 font-medium text-[10px] text-black/45 leading-none'>
                SOUL
              </span>
            </div>
            <div className='my-auto'>
              <span className='mb-2 block font-medium text-[10px] text-black/40 tracking-[0.12em]'>{t('shortReview')}</span>
              <p className='line-clamp-5 text-[17px] text-black leading-[1.45]'>{persona.description}</p>
            </div>
            <div className='flex items-center justify-between border-black/10 border-t pt-2 font-medium text-[10px] text-black/40'>
              <span>{tag || persona.author}</span>
              <span>{t('viewDetail')}</span>
            </div>
          </div>
        </div>
      </div>
    </LocaleLink>
  )
}
