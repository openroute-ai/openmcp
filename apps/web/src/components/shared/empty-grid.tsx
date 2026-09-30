import { useTranslations } from 'next-intl'

export default function EmptyGrid() {
  const t = useTranslations('BlogPage')

  return (
    <div>
      <div className='grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-3'>
        <div className='col-span-full my-8 flex h-32 w-full items-center justify-center'>
          <p className='font-medium text-muted-foreground'>{t('noPostsFound')}</p>
        </div>
      </div>
    </div>
  )
}
