'use client'

import { useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import type { Components } from 'react-markdown'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Button } from '@workspace/ui/components/button'
import { Checkbox } from '@workspace/ui/components/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@workspace/ui/components/dialog'
import { Spinner } from '@workspace/ui/components/spinner'
import { legalDocumentPath, type LegalDocument } from './kyc-shared'

/** The two texts a provider agrees to, in the order they are read. */
const DOCUMENTS = [
  { key: 'legal/privacy', labelKey: 'privacy' },
  { key: 'legal/terms', labelKey: 'terms' },
] as const satisfies readonly {
  key: Extract<LegalDocument, `legal/${string}`>
  labelKey: string
}[]

type DocumentKey = (typeof DOCUMENTS)[number]['key']

/**
 * The agreement checkbox every KYC form ends with.
 *
 * The two texts are links rather than plain words because a provider is being
 * asked to agree to something: each opens the full document in a dialog instead
 * of navigating away, so the uploads already in the form survive the read. The
 * documents are markdown fetched on demand, which keeps the copy editable
 * without shipping a page of legal text inside every provider form.
 */
export function LegalConsent({
  checked,
  onCheckedChange,
  error,
}: {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  error?: string
}) {
  const t = useTranslations('ProviderPage.kyc')
  const locale = useLocale()
  const [open, setOpen] = useState<DocumentKey | undefined>(undefined)
  const [attempt, setAttempt] = useState(0)
  const document = DOCUMENTS.find((entry) => entry.key === open)

  return (
    <div className='space-y-2'>
      <div className='flex items-start gap-2'>
        <Checkbox
          id='kyc-legal-consent'
          checked={checked}
          onCheckedChange={(value) => onCheckedChange(value === true)}
          className='mt-0.5'
        />
        {/* The sentence is a `<label>` for the checkbox and the documents are
            buttons beside it, never links inside it: a click on an interactive
            child of a label also activates the label's control, so a link in
            here would toggle the checkbox on its way to opening the text. */}
        <p className='text-muted-foreground text-sm'>
          <label htmlFor='kyc-legal-consent' className='cursor-pointer'>
            {t('fields.agreedTermsPrefix')}
          </label>{' '}
          {DOCUMENTS.map((entry, index) => (
            <span key={entry.key}>
              {index > 0 && <span> {t('fields.agreedTermsJoin')} </span>}
              <button
                type='button'
                onClick={() => setOpen(entry.key)}
                className='cursor-pointer font-medium text-primary underline underline-offset-4 hover:text-primary/80'
              >
                {t(`legal.${entry.labelKey}`)}
              </button>
            </span>
          ))}
        </p>
      </div>
      {error && <p className='text-destructive text-xs'>{error}</p>}

      <Dialog
        open={document !== undefined}
        onOpenChange={(next) => {
          if (!next) setOpen(undefined)
        }}
      >
        <DialogContent className='max-h-[85svh] gap-3 sm:max-w-2xl'>
          <DialogHeader>
            <DialogTitle>
              {document ? t(`legal.${document.labelKey}`) : ''}
            </DialogTitle>
            <DialogDescription>{t('legal.dialogDescription')}</DialogDescription>
          </DialogHeader>
          {document && (
            // Keyed on the document and the attempt, so opening another text —
            // or retrying a failed one — starts from a clean fetch instead of
            // the previous document's content.
            <LegalDocumentBody
              key={`${document.key}:${attempt}`}
              href={legalDocumentPath(document.key, locale)}
              onRetry={() => setAttempt((value) => value + 1)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

/** Fetches one markdown document and renders it. */
function LegalDocumentBody({
  href,
  onRetry,
}: {
  href: string
  onRetry: () => void
}) {
  const t = useTranslations('ProviderPage.kyc')
  const [state, setState] = useState<
    { status: 'loading' } | { status: 'ready'; markdown: string } | { status: 'failed' }
  >({ status: 'loading' })

  useEffect(() => {
    // The dialog can move on to another document before a fetch settles, so a
    // response is only applied while it is still the one that was asked for.
    let current = true

    fetch(href)
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status))
        return response.text()
      })
      .then((markdown) => {
        if (current) setState({ status: 'ready', markdown })
      })
      .catch(() => {
        if (current) setState({ status: 'failed' })
      })

    return () => {
      current = false
    }
  }, [href])

  if (state.status === 'failed') {
    return (
      <div className='space-y-3 py-6 text-center'>
        <p className='text-muted-foreground text-sm'>{t('legal.loadFailed')}</p>
        <Button type='button' variant='outline' size='sm' onClick={onRetry}>
          {t('legal.retry')}
        </Button>
      </div>
    )
  }

  if (state.status === 'loading') {
    return (
      <div className='flex justify-center py-10'>
        <Spinner />
      </div>
    )
  }

  return (
    <div className='max-h-[60svh] overflow-y-auto pr-1'>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {state.markdown}
      </ReactMarkdown>
    </div>
  )
}

/**
 * Styling for the legal texts.
 *
 * Raw HTML is not enabled: the documents are repository files today, but the
 * fetch makes them data, and a document must not be able to inject markup into
 * the page that shows it.
 */
const markdownComponents: Components = {
  h1: ({ children }) => (
    <h1 className='mt-2 mb-3 font-semibold text-foreground text-xl first:mt-0'>
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className='mt-6 mb-2 font-semibold text-foreground text-base'>{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className='mt-4 mb-2 font-medium text-foreground text-sm'>{children}</h3>
  ),
  p: ({ children }) => (
    <p className='my-3 leading-relaxed first:mt-0 last:mb-0'>{children}</p>
  ),
  ul: ({ children }) => (
    <ul className='my-3 list-disc space-y-1.5 pl-5 marker:text-muted-foreground/70'>
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className='my-3 list-decimal space-y-1.5 pl-5 marker:text-muted-foreground/70'>
      {children}
    </ol>
  ),
  li: ({ children }) => <li className='leading-relaxed'>{children}</li>,
  strong: ({ children }) => (
    <strong className='font-medium text-foreground'>{children}</strong>
  ),
  a: ({ href, children }) => {
    const external = href?.startsWith('http') ?? false
    return (
      <a
        href={href}
        target={external ? '_blank' : undefined}
        rel={external ? 'noreferrer' : undefined}
        className='text-primary underline underline-offset-4'
      >
        {children}
      </a>
    )
  },
  hr: () => <hr className='my-6' />,
}
