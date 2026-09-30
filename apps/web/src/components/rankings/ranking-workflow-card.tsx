import { useTranslations } from 'next-intl'
import { ArrowDown, ArrowUp, CheckCircle2, Download, Eye, Heart, MessageSquare, Minus, TrendingUp } from 'lucide-react'
import Image from 'next/image'
import { Badge } from '@workspace/ui/components/badge'
import { LocaleLink } from '@/i18n/navigation'
import { cn } from '@/lib/utils'
import type { RankingWorkflowRow } from '@/web/workflow-rankings/types'

interface RankingWorkflowCardProps {
  ranking: RankingWorkflowRow
  dimension: 'recent' | 'popular'
}

/**
 * One row in a ranking list.
 *
 * The card reads the counters that belong to the active dimension, so the
 * `popular` view shows the popularity score instead of mixing it in with the
 * period counters.
 */
export function RankingWorkflowCard({ ranking, dimension }: RankingWorkflowCardProps) {
  const t = useTranslations('Rankings.card')

  const { workflow, author } = ranking

  // Both dimensions were computed over the same window, so the counters are the
  // same values; the split only decides which score the sort used.
  const views = dimension === 'recent' ? ranking.recentViews : ranking.popularViews
  const downloads = dimension === 'recent' ? ranking.recentDownloads : ranking.popularDownloads
  const likes = dimension === 'recent' ? ranking.recentLikes : ranking.popularLikes
  const comments = dimension === 'recent' ? ranking.recentComments : ranking.popularComments
  const verifications =
    dimension === 'recent' ? ranking.recentVerifications : ranking.popularVerifications

  const complexityColor: Record<'beginner' | 'intermediate' | 'advanced', string> = {
    beginner: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    intermediate: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
    advanced: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  }

  const rankChange = ranking.rankChange ?? 0
  const trendIcon = (() => {
    if (ranking.trend === 'new') return <TrendingUp className='h-4 w-4 text-green-500' />
    if (rankChange > 0) return <ArrowUp className='h-4 w-4 text-green-500' />
    if (rankChange < 0) return <ArrowDown className='h-4 w-4 text-red-500' />
    return <Minus className='h-4 w-4 text-muted-foreground' />
  })()

  return (
    <LocaleLink href={`/workflows/${workflow.slug}`} className='group block' prefetch={false}>
      <div className='flex items-center gap-4 rounded-lg border border-border bg-card p-4 transition-all duration-300 hover:border-primary/50 hover:shadow-md'>
        <div className='flex min-w-[3rem] flex-col items-center justify-center'>
          <div className={cn('font-bold text-2xl', ranking.rank <= 3 ? 'text-primary' : 'text-muted-foreground')}>
            {ranking.rank}
          </div>
        </div>

        <div className='relative h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-muted'>
          <Image
            src={workflow.imageUrl || '/assets/svg/placeholder-workflow.svg'}
            alt={workflow.title}
            fill
            className='object-cover transition-transform duration-300 group-hover:scale-105'
          />
          {workflow.certified && (
            <div className='absolute top-1 right-1'>
              <CheckCircle2 className='h-4 w-4 fill-primary text-primary' />
            </div>
          )}
        </div>

        <div className='min-w-0 flex-1'>
          <div className='mb-1 flex items-start justify-between gap-2'>
            <h3 className='line-clamp-1 font-semibold text-card-foreground text-lg transition-colors group-hover:text-primary'>
              {workflow.title}
            </h3>
            <div className='flex shrink-0 items-center gap-1 text-xs'>
              {trendIcon}
              <span
                className={cn(
                  'font-medium',
                  ranking.trend === 'down' ? 'text-red-600' : 'text-muted-foreground'
                )}
              >
                {ranking.trend === 'new'
                  ? t('newEntry')
                  : rankChange === 0
                    ? t('noChange')
                    : t('rankChange', { count: Math.abs(rankChange) })}
              </span>
            </div>
          </div>

          <p className='mb-2 line-clamp-2 text-muted-foreground text-sm'>
            {workflow.description || workflow.summary || ''}
          </p>

          <div className='mb-2 flex items-center gap-3'>
            <div className='flex items-center gap-1.5 text-muted-foreground text-xs'>
              {author.avatar && (
                <Image src={author.avatar} alt={author.name} width={16} height={16} className='rounded-full' />
              )}
              <span>{author.name}</span>
              {author.verified && <CheckCircle2 className='h-3 w-3 text-primary' />}
            </div>

            {workflow.complexity && (
              <Badge variant='secondary' className={cn('text-xs', complexityColor[workflow.complexity])}>
                {t(`complexity.${workflow.complexity}`)}
              </Badge>
            )}

            <Badge variant='outline' className='text-xs'>
              {t(workflow.priceType === 'free' ? 'free' : 'paid')}
            </Badge>
          </div>

          <div className='flex items-center gap-4 text-muted-foreground text-xs'>
            <div className='flex items-center gap-1'>
              <Eye className='h-3.5 w-3.5' />
              <span>{views.toLocaleString()}</span>
            </div>
            <div className='flex items-center gap-1'>
              <Download className='h-3.5 w-3.5' />
              <span>{downloads.toLocaleString()}</span>
            </div>
            <div className='flex items-center gap-1'>
              <Heart className='h-3.5 w-3.5' />
              <span>{likes.toLocaleString()}</span>
            </div>
            {comments > 0 && (
              <div className='flex items-center gap-1'>
                <MessageSquare className='h-3.5 w-3.5' />
                <span>{comments.toLocaleString()}</span>
              </div>
            )}
            {verifications > 0 && (
              <div className='flex items-center gap-1'>
                <CheckCircle2 className='h-3.5 w-3.5' />
                <span>{verifications.toLocaleString()}</span>
              </div>
            )}
            {dimension === 'popular' && (
              <div className='ml-auto flex items-center gap-1'>
                <span className='font-medium text-primary'>
                  {t('popularityScore', { score: Number.parseFloat(ranking.popularityScore).toFixed(1) })}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </LocaleLink>
  )
}
