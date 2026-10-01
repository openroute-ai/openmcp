import { Card, CardContent } from '@workspace/ui/components/card'
import { CalendarIcon } from 'lucide-react'
import { formatDate } from '@/lib/utils'

interface CustomPageProps {
  title: string
  description: string
  date: string
  content: React.ReactNode
}

/**
 * Renders a content-pages entry (`content/pages/*.mdx`) as a titled document.
 *
 * The body is passed as an element rather than a source string: legal copy and
 * the user guide are real MDX (they use `<Callout>` and friends), so the caller
 * compiles them with `getCompiledPage`. `CustomMDXContent` — which takes a raw
 * string and goes through react-markdown — cannot run those.
 */
export function CustomPage({ title, description, date, content }: CustomPageProps) {
  const formattedDate = date ? formatDate(new Date(date)) : null

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      {/* Header */}
      <div className="space-y-4">
        <h1 className="text-center font-bold text-title tracking-tight">{title}</h1>
        <p className="text-center text-lg text-muted-foreground">{description}</p>
        {formattedDate ? (
          <div className="flex items-center justify-center gap-2">
            <CalendarIcon className="size-4 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">{formattedDate}</p>
          </div>
        ) : null}
      </div>

      {/* Content */}
      <Card className="mb-8">
        <CardContent>
          <div className="prose prose-neutral dark:prose-invert max-w-none prose-img:rounded-lg">
            {content}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
