'use client'

import { Button } from '@workspace/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { Input } from '@workspace/ui/components/input'
import { Label } from '@workspace/ui/components/label'
import { Skeleton } from '@workspace/ui/components/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@workspace/ui/components/table'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { DashboardHeader } from '@/components/dashboard/dashboard-header'
import { trpc } from '@/lib/trpc/client'

export default function InvoicePage() {
  const t = useTranslations('Dashboard.invoice')
  const utils = trpc.useUtils()
  const { data, isLoading } = trpc.providers.getInvoiceProfile.useQuery()
  const profile = data?.success ? data.data : null

  const [title, setTitle] = useState('')
  const [taxId, setTaxId] = useState('')
  const [address, setAddress] = useState('')
  const [bank, setBank] = useState('')
  const [phone, setPhone] = useState('')

  useEffect(() => {
    if (profile) {
      setTitle(profile.title ?? '')
      setTaxId(profile.taxId ?? '')
      setAddress(profile.address ?? '')
      setBank(profile.bank ?? '')
      setPhone(profile.phone ?? '')
    }
  }, [profile])

  const saveMutation = trpc.providers.upsertInvoiceProfile.useMutation({
    onSuccess: (res) => {
      if (res.success) {
        toast.success(t('saveSuccess'))
        void utils.providers.getInvoiceProfile.invalidate()
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
      <div className='flex-1 px-5 py-8 sm:px-6 lg:px-10'>
        <div className='mx-auto w-full max-w-7xl space-y-7'>
          <div>
            <h1 className='font-bold text-2xl tracking-tight'>{t('title')}</h1>
            <p className='mt-2 text-muted-foreground'>{t('description')}</p>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{t('profileTitle')}</CardTitle>
              <CardDescription>{t('profileHint')}</CardDescription>
            </CardHeader>
            <CardContent className='space-y-4'>
              {isLoading ? (
                <Skeleton className='h-40 w-full' />
              ) : (
                <>
                  <div className='grid gap-4 md:grid-cols-2'>
                    <div className='space-y-2'>
                      <Label htmlFor='title'>{t('fields.title')}</Label>
                      <Input id='title' value={title} onChange={(e) => setTitle(e.target.value)} />
                    </div>
                    <div className='space-y-2'>
                      <Label htmlFor='taxId'>{t('fields.taxId')}</Label>
                      <Input id='taxId' value={taxId} onChange={(e) => setTaxId(e.target.value)} />
                    </div>
                    <div className='space-y-2 md:col-span-2'>
                      <Label htmlFor='address'>{t('fields.address')}</Label>
                      <Input id='address' value={address} onChange={(e) => setAddress(e.target.value)} />
                    </div>
                    <div className='space-y-2'>
                      <Label htmlFor='bank'>{t('fields.bank')}</Label>
                      <Input id='bank' value={bank} onChange={(e) => setBank(e.target.value)} />
                    </div>
                    <div className='space-y-2'>
                      <Label htmlFor='phone'>{t('fields.phone')}</Label>
                      <Input id='phone' value={phone} onChange={(e) => setPhone(e.target.value)} />
                    </div>
                  </div>
                  <Button
                    disabled={saveMutation.isPending || !title.trim() || !taxId.trim()}
                    onClick={() =>
                      saveMutation.mutate({
                        title,
                        taxId,
                        address: address || undefined,
                        bank: bank || undefined,
                        phone: phone || undefined,
                      })
                    }
                  >
                    {saveMutation.isPending ? t('saving') : t('save')}
                  </Button>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('requestsTitle')}</CardTitle>
              <CardDescription>{t('requestsHint')}</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('requests.date')}</TableHead>
                    <TableHead>{t('requests.amount')}</TableHead>
                    <TableHead>{t('requests.status')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell colSpan={3} className='text-muted-foreground text-sm'>
                      {t('requests.empty')}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  )
}
