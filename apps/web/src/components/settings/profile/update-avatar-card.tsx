'use client'

import { User2Icon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { FormError } from '@/components/shared/form-error'
import { Avatar, AvatarFallback, AvatarImage } from '@workspace/ui/components/avatar'
import { Button } from '@workspace/ui/components/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { authClient } from '@/lib/auth-client'
import { useAvatarPreviewStore } from '@/lib/stores/avatar-preview-store'
import { cn } from '@/lib/utils'
import { uploadFileToStorage } from '@/lib/storage/upload-client'

interface UpdateAvatarCardProps {
  className?: string
}

/**
 * Update the user's avatar
 */
export function UpdateAvatarCard({ className }: UpdateAvatarCardProps) {
  const t = useTranslations('Dashboard.settings.profile')
  const [isUploading, setIsUploading] = useState(false)
  const [error, setError] = useState<string | undefined>('')
  const { data: session, refetch } = authClient.useSession()
  const [avatarUrl, setAvatarUrl] = useState('')
  const [tempAvatarUrl, setTempAvatarUrl] = useState('')
  const { openPreview } = useAvatarPreviewStore()

  useEffect(() => {
    if (session?.user?.image) {
      setAvatarUrl(session.user.image)
    }
  }, [session])

  const user = session?.user
  if (!user) {
    return null
  }

  const handleAvatarClick = () => {
    if (avatarUrl) {
      openPreview(avatarUrl, user.name || '')
    }
  }

  const handleUploadClick = () => {
    // Create a hidden file input and trigger it
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/png, image/jpeg, image/webp'
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (file) {
        handleFileUpload(file)
      }
    }
    input.click()
  }

  const handleFileUpload = async (file: File) => {
    setIsUploading(true)
    setError('')

    try {
      // Create a temporary URL for preview and store the original URL
      const tempUrl = URL.createObjectURL(file)
      setTempAvatarUrl(tempUrl)
      // Show temporary avatar immediately for better UX
      setAvatarUrl(tempUrl)

      // Upload the file to storage
      const result = await uploadFileToStorage(file, 'avatar')
      const { url } = result

      // Update the user's avatar using authClient
      await authClient.updateUser(
        {
          image: url,
        },
        {
          onRequest: () => {
            // console.log('update avatar, request:', ctx.url);
          },
          onResponse: () => {
            // console.log('update avatar, response:', ctx.response);
          },
          onSuccess: () => {
            // console.log('update avatar, success:', ctx.data);
            // Set the permanent avatar URL on success
            setAvatarUrl(url)
            toast.success(t('avatar.success'))
            // Refetch the session to get the latest data
            refetch()
          },
          onError: (ctx) => {
            console.error('update avatar error:', ctx.error)
            setError(`${ctx.error.status}: ${ctx.error.message}`)
            // Restore the previous avatar on error
            if (session?.user?.image) {
              setAvatarUrl(session.user.image)
            }
            toast.error(t('avatar.fail'))
          },
        }
      )
    } catch (error) {
      console.error('update avatar error:', error)
      setError(error instanceof Error ? error.message : t('avatar.fail'))
      // Restore the previous avatar if there was an error
      if (session?.user?.image) {
        setAvatarUrl(session.user.image)
      }
      toast.error(t('avatar.fail'))
    } finally {
      setIsUploading(false)
      // Clean up temporary URL
      if (tempAvatarUrl) {
        URL.revokeObjectURL(tempAvatarUrl)
        setTempAvatarUrl('')
      }
    }
  }

  return (
    <Card className={cn('flex w-full max-w-lg flex-col overflow-hidden py-0 pt-6 md:max-w-xl', className)}>
      <CardHeader>
        <CardTitle className='font-semibold text-lg'>{t('avatar.title')}</CardTitle>
        <CardDescription>{t('avatar.description')}</CardDescription>
      </CardHeader>
      <CardContent className='flex-1 space-y-4'>
        <div className='flex flex-col items-center gap-4 sm:flex-row sm:gap-8'>
          {/* avatar */}
          <Avatar
            className={cn(
              'h-16 w-16 cursor-pointer border transition-all duration-200 hover:scale-105 hover:shadow-md',
              avatarUrl && 'hover:ring-2 hover:ring-primary/20'
            )}
            onClick={handleAvatarClick}
          >
            <AvatarImage src={avatarUrl ?? ''} alt={user.name} />
            <AvatarFallback>
              <User2Icon className='h-8 w-8 text-muted-foreground' />
            </AvatarFallback>
          </Avatar>

          {/* upload button */}
          <Button
            variant='outline'
            size='sm'
            onClick={handleUploadClick}
            disabled={isUploading}
            className='cursor-pointer'
          >
            {isUploading ? t('avatar.uploading') : t('avatar.uploadAvatar')}
          </Button>
        </div>

        <FormError message={error} />
      </CardContent>
      <CardFooter className='mt-auto flex items-center justify-between rounded-none bg-background px-6 py-4'>
        <p className='text-muted-foreground text-sm'>{t('avatar.recommendation')}</p>
      </CardFooter>
    </Card>
  )
}
