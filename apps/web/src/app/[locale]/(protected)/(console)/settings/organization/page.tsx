'use client'

import { Button } from '@workspace/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { Input } from '@workspace/ui/components/input'
import { Label } from '@workspace/ui/components/label'
import { Skeleton } from '@workspace/ui/components/skeleton'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { DashboardHeader } from '@/components/dashboard/dashboard-header'
import { LocaleLink } from '@/i18n/navigation'
import { Routes } from '@/lib/routes'
import { trpc } from '@/lib/trpc/client'

export default function OrganizationPage() {
  const t = useTranslations('Dashboard.organization')
  const tSettings = useTranslations('Dashboard.settings.organization')
  const utils = trpc.useUtils()
  const { data, isLoading } = trpc.providers.getMyProfile.useQuery()
  const profile = data?.success ? data.data : null
  const isCompany = profile?.entityType === 'company'

  const [contactName, setContactName] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [documentationUrl, setDocumentationUrl] = useState('')

  useEffect(() => {
    if (profile) {
      setContactName(profile.contactName ?? '')
      setCompanyName(profile.companyName ?? '')
      setDocumentationUrl(profile.documentationUrl ?? '')
    }
  }, [profile])

  const updateMutation = trpc.providers.updateOrganizationContact.useMutation({
    onSuccess: (res) => {
      if (res.success) {
        toast.success(t('saveSuccess'))
        void utils.providers.getMyProfile.invalidate()
      } else {
        toast.error(res.error || t('saveFailed'))
      }
    },
    onError: (err) => toast.error(err.message || t('saveFailed')),
  })

  const breadcrumbs = [{ label: t('title'), isCurrentPage: true }]

  return (
    <>
      <DashboardHeader breadcrumbs={breadcrumbs} />
      <div className='flex-1 px-gutter py-8 sm:px-gutter-sm lg:px-gutter-lg'>
        <div className='mx-auto w-full max-w-page space-y-7'>
          <div>
            <h1 className='font-bold text-section tracking-tight'>{t('title')}</h1>
            <p className='mt-2 text-muted-foreground'>{t('description')}</p>
          </div>

          {isLoading ? (
            <Skeleton className='h-48 w-full' />
          ) : !isCompany ? (
            <Card>
              <CardHeader>
                <CardTitle>{t('title')}</CardTitle>
                <CardDescription>{t('individualHint')}</CardDescription>
              </CardHeader>
              <CardContent className='space-y-4'>
                <p className='text-muted-foreground text-sm'>{tSettings('payoutHint')}</p>
                <div className='flex flex-wrap gap-2'>
                  <Button asChild>
                    <LocaleLink href={`${Routes.ProviderOnboarding}/company`}>{t('goCompanyOnboarding')}</LocaleLink>
                  </Button>
                  <Button asChild variant='outline'>
                    <LocaleLink href={Routes.ProviderPayout}>{tSettings('payoutLink')}</LocaleLink>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>{t('companyTitle')}</CardTitle>
                <CardDescription>
                  {t('verificationStatus')}: {profile?.verificationStatus ?? '—'}
                </CardDescription>
              </CardHeader>
              <CardContent className='space-y-4'>
                <div className='space-y-2'>
                  <Label htmlFor='companyName'>{t('companyName')}</Label>
                  <Input id='companyName' value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
                </div>
                <div className='space-y-2'>
                  <Label htmlFor='contactName'>{t('contactName')}</Label>
                  <Input id='contactName' value={contactName} onChange={(e) => setContactName(e.target.value)} />
                </div>
                <div className='space-y-2'>
                  <Label htmlFor='documentationUrl'>{t('documentationUrl')}</Label>
                  <Input
                    id='documentationUrl'
                    value={documentationUrl}
                    onChange={(e) => setDocumentationUrl(e.target.value)}
                  />
                </div>
                {profile?.idNumber ? (
                  <p className='text-muted-foreground text-sm'>
                    {t('idNumber')}: {profile.idNumber}
                  </p>
                ) : null}
                <div className='flex flex-wrap gap-2'>
                  <Button
                    disabled={updateMutation.isPending}
                    onClick={() =>
                      updateMutation.mutate({
                        contactName,
                        companyName,
                        documentationUrl: documentationUrl || null,
                      })
                    }
                  >
                    {updateMutation.isPending ? t('saving') : t('save')}
                  </Button>
                  <Button asChild variant='outline'>
                    <LocaleLink href={Routes.ProviderPayout}>{tSettings('payoutLink')}</LocaleLink>
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </>
  )
}
