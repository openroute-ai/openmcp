import { FileText, Upload } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { LocaleLink } from '@/i18n/navigation'

export function ShareWorkflowCard() {
  const t = useTranslations('Workflows')
  return (
    <div className='mb-6 rounded-lg border border-primary/30 bg-gradient-to-br from-primary/10 to-primary/20 p-6 shadow-sm'>
      <div className='text-center'>
        {/* Icon */}
        <div className='mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary'>
          <Upload className='h-6 w-6 text-primary-foreground' />
        </div>

        {/* Title */}
        <h3 className='mb-2 font-semibold text-foreground text-lg'>{t('share.title')}</h3>

        {/* Description */}
        <p className='mb-4 text-muted-foreground text-sm'>
          {t('share.description')}
        </p>

        {/* Buttons */}
        <div className='space-y-3'>
          {/* Primary Button - Submit Template */}
          <LocaleLink
            href='/workflows/submit'
            target='_blank'
            rel='noopener noreferrer'
            className='block w-full rounded-lg bg-primary px-4 py-2.5 font-medium text-primary-foreground text-sm transition-colors duration-200 hover:bg-primary/90'
          >
            <div className='flex items-center justify-center'>
              <Upload className='mr-2 h-4 w-4' />
              {t('share.submitCta')}
            </div>
          </LocaleLink>

          {/* Secondary Button - How to Guide */}
          <LocaleLink
            href='/docs/submit-workflow'
            target='_blank'
            rel='noopener noreferrer'
            className='block w-full rounded-lg border border-primary/30 bg-background px-4 py-2.5 font-medium text-primary text-sm transition-colors duration-200 hover:bg-accent'
          >
            <div className='flex items-center justify-center'>
              <FileText className='mr-2 h-4 w-4' />
              {t('share.howTo')}
            </div>
          </LocaleLink>
        </div>

        {/* Additional Note */}
        <p className='mt-3 text-muted-foreground text-xs'>{t('share.footnote')}</p>
      </div>
    </div>
  )
}
