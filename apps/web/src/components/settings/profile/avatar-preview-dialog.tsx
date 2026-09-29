'use client'

import Image from 'next/image'
import { useTranslations } from 'next-intl'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@workspace/ui/components/dialog'
import { useAvatarPreviewStore } from '@/lib/stores/avatar-preview-store'

/**
 * Avatar preview dialog component
 */
export function AvatarPreviewDialog() {
  const t = useTranslations('Dashboard.settings.profile')
  const { isOpen, imageUrl, userName, closePreview } = useAvatarPreviewStore()

  if (!imageUrl) {
    return null
  }

  return (
    <Dialog open={isOpen} onOpenChange={closePreview}>
      <DialogContent className='min-w-2xl'>
        <DialogHeader>
          <DialogTitle>{t('avatar.preview')}</DialogTitle>
        </DialogHeader>
        <div className='flex flex-col items-center space-y-4'>
          <div className='relative h-96 w-96 overflow-hidden rounded-full border-4 border-border'>
            <Image
              src={imageUrl}
              alt={userName || 'Avatar'}
              fill
              className='object-cover'
              sizes='(max-width: 768px) 192px, 192px'
              priority
            />
          </div>
          {userName && <p className='text-center text-muted-foreground text-sm'>{userName}</p>}
        </div>
      </DialogContent>
    </Dialog>
  )
}
