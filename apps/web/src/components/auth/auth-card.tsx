'use client'

import { cn } from '@workspace/ui/lib/utils'
import { Card, CardContent, CardFooter, CardHeader } from '@workspace/ui/components/card'
import { LocaleLink } from '@/i18n/navigation'

export interface AuthCardProps {
  headerLabel: string
  description?: string
  bottomButtonLabel?: string
  bottomButtonHref?: string
  children: React.ReactNode
  className?: string
}

/**
 * Shared shell for the sign-in / sign-up forms.
 *
 * Kept presentational so each form owns only its own fields; the header and the
 * footer link stay identical across the two flows.
 */
export function AuthCard({
  headerLabel,
  description,
  bottomButtonLabel,
  bottomButtonHref,
  children,
  className,
}: AuthCardProps) {
  return (
    <Card className={cn('w-full shadow-sm', className)}>
      <CardHeader className="space-y-1 text-center">
        <h2 className="text-2xl font-semibold tracking-tight">{headerLabel}</h2>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </CardHeader>
      <CardContent>{children}</CardContent>
      {bottomButtonLabel && bottomButtonHref && (
        <CardFooter className="flex justify-center border-t pt-4">
          <LocaleLink
            href={bottomButtonHref}
            className="text-sm text-muted-foreground hover:text-primary"
          >
            {bottomButtonLabel}
          </LocaleLink>
        </CardFooter>
      )}
    </Card>
  )
}
