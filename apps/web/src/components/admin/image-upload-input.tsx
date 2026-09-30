'use client'

import { ImageIcon, Loader2Icon, Trash2Icon, UploadIcon } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@workspace/ui/components/button'
import { cn } from '@/lib/utils'
import { uploadFileToStorage } from '@/lib/storage/upload-client'

interface ImageUploadInputProps {
  value?: string
  onChange: (url: string) => void
  scope?: 'asset' | 'avatar'
  className?: string
  disabled?: boolean
}

/** Mirrors `UPLOAD_SCOPES.asset` / `.avatar` server-side limits. */
const ACCEPT = 'image/jpeg,image/png,image/webp'

/**
 * Cover-image picker for the blog admin.
 *
 * The browser only supplies the bytes and a storage *scope*: the object name
 * and folder are derived server-side from the scope plus the caller's user id
 * (see `server/storage/policy.ts`). No free-form `folder` prop here, so a
 * signed-in admin cannot write outside the allowed namespaces.
 */
export function ImageUploadInput({
  value,
  onChange,
  scope = 'asset',
  className,
  disabled = false,
}: ImageUploadInputProps) {
  const [isUploading, setIsUploading] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(value || null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileSelect = useCallback(
    async (file: File | null) => {
      if (!file) return

      if (!ACCEPT.split(',').includes(file.type)) {
        toast.error(`Unsupported file type: ${file.type}`)
        return
      }

      // 10MB limit, matching UPLOAD_SCOPES.asset.maxBytes
      const maxSize = 10 * 1024 * 1024
      if (file.size > maxSize) {
        toast.error('File too large (max 10MB)')
        return
      }

      // Show preview
      const objectUrl = URL.createObjectURL(file)
      setPreviewUrl(objectUrl)
      setIsUploading(true)

      try {
        const result = await uploadFileToStorage(file, scope)
        onChange(result.url)
        // Cleanup object URL and use the uploaded URL
        URL.revokeObjectURL(objectUrl)
        setPreviewUrl(result.url)
        toast.success('Image uploaded')
      } catch (error) {
        console.error('Upload error:', error)
        toast.error('Image upload failed')
        // Reset preview on error
        URL.revokeObjectURL(objectUrl)
        setPreviewUrl(value || null)
      } finally {
        setIsUploading(false)
      }
    },
    [onChange, scope, value]
  )

  const handleClick = useCallback(() => {
    if (!disabled) {
      fileInputRef.current?.click()
    }
  }, [disabled])

  const handleDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      if (previewUrl && previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(previewUrl)
      }
      setPreviewUrl(null)
      onChange('')
    },
    [onChange, previewUrl]
  )

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) {
        handleFileSelect(file)
      }
      // Reset input value to allow selecting the same file again
      e.target.value = ''
    },
    [handleFileSelect]
  )

  return (
    <div className={cn('space-y-2', className)}>
      <div
        className={cn(
          'relative overflow-hidden rounded-lg border-2 border-dashed transition-all',
          disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:border-primary/50',
          previewUrl ? 'border-primary/50' : 'border-muted-foreground/25'
        )}
        onClick={handleClick}
      >
        {previewUrl ? (
          <div className='relative aspect-video bg-muted'>
            <img
              src={previewUrl}
              alt='Preview'
              className='h-full w-full object-cover'
              onError={() => {
                setPreviewUrl(null)
                onChange('')
              }}
            />
            {!disabled && (
              <Button
                type='button'
                variant='destructive'
                size='icon'
                className='absolute top-2 right-2 h-8 w-8'
                onClick={handleDelete}
                disabled={isUploading}
                aria-label='Remove image'
              >
                <Trash2Icon className='h-4 w-4' />
              </Button>
            )}
            {isUploading && (
              <div className='absolute inset-0 flex items-center justify-center bg-black/50'>
                <Loader2Icon className='h-6 w-6 animate-spin text-white' />
                <span className='sr-only'>Uploading...</span>
              </div>
            )}
          </div>
        ) : (
          <div className='flex min-h-[120px] flex-col items-center justify-center p-8 text-center'>
            {isUploading ? (
              <>
                <Loader2Icon className='mb-2 h-8 w-8 animate-spin text-muted-foreground' />
                <p className='text-muted-foreground text-sm'>Uploading...</p>
              </>
            ) : (
              <>
                <UploadIcon className='mb-2 h-8 w-8 text-muted-foreground' />
                <p className='text-muted-foreground text-sm'>Click to upload</p>
                <p className='mt-1 text-muted-foreground text-xs'>
                  PNG, JPEG, WEBP | max 10MB
                </p>
              </>
            )}
          </div>
        )}
      </div>
      <input
        ref={fileInputRef}
        type='file'
        accept={ACCEPT}
        onChange={handleInputChange}
        className='hidden'
        disabled={disabled || isUploading}
        aria-label='Upload image'
      />
      {value && !previewUrl && (
        <div className='flex items-center gap-2 text-muted-foreground text-sm'>
          <ImageIcon className='h-4 w-4' />
          <span className='truncate'>{value}</span>
        </div>
      )}
    </div>
  )
}
