import { CalendarIcon, TagIcon } from 'lucide-react'
import { CustomMDXContent } from '@/components/shared/custom-mdx-content'
import { Badge } from '@workspace/ui/components/badge'
import { Card, CardContent, CardHeader } from '@workspace/ui/components/card'
import { Separator } from '@workspace/ui/components/separator'
import { formatDate } from '@/lib/utils'

interface ReleaseCardProps {
  title: string
  description: string
  date: string
  version: string
  content: string // MDX content
}

export function ReleaseCard({ title, description, date, version, content }: ReleaseCardProps) {
  const formattedDate = formatDate(new Date(date))

  return (
    <Card className='mb-8'>
      <CardHeader className='space-y-4'>
        <div className='flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between'>
          <h2 className='font-bold text-2xl tracking-tight'>{title}</h2>
          <Badge variant='default' className='w-fit'>
            <TagIcon className='mr-1 size-3' />
            {version}
          </Badge>
        </div>
        <p className='text-muted-foreground'>{description}</p>
        <div className='flex items-center gap-2'>
          <CalendarIcon className='size-4 text-muted-foreground' />
          <p className='text-muted-foreground text-sm'>{formattedDate}</p>
        </div>
        <Separator />
      </CardHeader>
      <CardContent>
        <div className='prose prose-neutral dark:prose-invert max-w-none prose-img:rounded-lg'>
          <CustomMDXContent code={content} />
        </div>
      </CardContent>
    </Card>
  )
}
