'use client'

import { useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { ImageIcon, Upload, X } from 'lucide-react'
import { Button } from '@workspace/ui/components/button'
import { Spinner } from '@workspace/ui/components/spinner'
import { uploadFileToStorage } from '@/lib/storage/upload-client'
import type { UploadScope } from '@/server/storage/policy'

type ImageUploaderProps = {
  label: string
  hint?: string
  value?: string
  onChange: (url: string | undefined) => void
  scope?: Extract<UploadScope, 'asset' | 'kyc' | 'payout'>
  /** Mirrors the server-side limit so the user is told before uploading. */
  maxBytes: number
  /** Square preview for logos, wide for covers. */
  variant?: 'square' | 'wide'
  accept?: string
}

/**
 * Single-image uploader for listing artwork.
 *
 * The value only changes once storage has accepted the bytes, so a failed
 * upload leaves the previously persisted URL in place. The browser supplies
 * the file and the scope; the server still decides the object name and folder.
 */
export function ImageUploader({
  label,
  hint,
  value,
  onChange,
  scope = 'asset',
  maxBytes,
  variant = 'wide',
  accept = 'image/jpeg,image/png,image/webp',
}: ImageUploaderProps) {
  const t = useTranslations('ProviderPage.imageUpload')
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const maxMb = Math.round((maxBytes / (1024 * 1024)) * 10) / 10
  const tooLarge = t('tooLarge', { max: `${maxMb}MB` })

  const handleFile = async (file: File | undefined) => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setError(t('notImage'))
      return
    }
    if (file.size > maxBytes) {
      setError(tooLarge)
      return
    }

    setBusy(true)
    setError(null)
    try {
      const result = await uploadFileToStorage(file, scope)
      onChange(result.url)
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : t('failed'))
    } finally {
      setBusy(false)
      // Reset so choosing the same file again still fires a change event.
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className='space-y-2'>
      <span className='font-medium text-sm'>{label}</span>
      {hint && <p className='text-muted-foreground text-xs'>{hint}</p>}

      {value ? (
        <div className='flex items-center gap-3 rounded-md border p-3'>
          {/* Listing artwork is served from the platform's own bucket. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={value}
            alt={label}
            className={`shrink-0 rounded border object-cover ${
              variant === 'square' ? 'size-12' : 'h-12 w-20'
            }`}
          />
          <span className='min-w-0 flex-1 truncate text-muted-foreground text-xs'>
            {t('done')}
          </span>
          <Button
            type='button'
            size='icon'
            variant='ghost'
            onClick={() => onChange(undefined)}
            aria-label={t('remove')}
          >
            <X className='size-4' />
          </Button>
        </div>
      ) : (
        <div>
          <input
            ref={inputRef}
            type='file'
            accept={accept}
            className='sr-only'
            disabled={busy}
            onChange={(event) => void handleFile(event.target.files?.[0])}
          />
          <Button
            type='button'
            variant='outline'
            className='w-full'
            onClick={() => inputRef.current?.click()}
            disabled={busy}
          >
            {busy ? <Spinner /> : variant === 'square' ? (
              <ImageIcon className='size-4' />
            ) : (
              <Upload className='size-4' />
            )}
            {busy ? t('uploading') : t('choose')}
          </Button>
        </div>
      )}

      {error && <p className='text-destructive text-xs'>{error}</p>}
    </div>
  )
}
