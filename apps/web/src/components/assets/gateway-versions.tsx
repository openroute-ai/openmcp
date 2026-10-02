'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@workspace/ui/components/badge'
import { Button } from '@workspace/ui/components/button'
import { Input } from '@workspace/ui/components/input'
import { Label } from '@workspace/ui/components/label'
import { Textarea } from '@workspace/ui/components/textarea'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@workspace/ui/components/table'
import { useTranslations } from 'next-intl'
import { trpc } from '@/lib/trpc/client'

/**
 * 网关资产（MCP / A2A）的版本面板。
 *
 * 与 Skill 版本面板的差别：没有文件列表，只有元数据快照。快照字段是端点 /
 * 工具 / 价格这些平台侧能看到的东西——平台拿不到远程进程里的代码，所以这里
 * **不会**假装能回滚对方的实现，只能回滚"平台侧承诺的元数据"。
 *
 * 下线（yank）不删除行：已购用户的授权和账本可能指向那一版，删掉会让那些
 * 记录指向不存在的版本。
 */

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  draft: 'outline',
  published: 'default',
  yanked: 'destructive',
  archived: 'secondary',
}

interface GatewayAssetVersionsProps {
  kind: 'mcp' | 'a2a'
  assetId: string
}

export function GatewayAssetVersions({ kind, assetId }: GatewayAssetVersionsProps) {
  const t = useTranslations('Dashboard.myAssets')
  const utils = trpc.useUtils()
  const [version, setVersion] = useState('')
  const [changelog, setChangelog] = useState('')

  const invalidate = () => utils.assets.listVersions.invalidate()
  const { data: versions, isLoading } = trpc.assets.listVersions.useQuery({ kind, assetId })

  const create = trpc.assets.createVersion.useMutation({
    onSuccess: (r) => {
      if (r.success) {
        toast.success(t('versionCreated'))
        setVersion('')
        setChangelog('')
        void invalidate()
      } else {
        toast.error(r.error)
      }
    },
    onError: (e) => toast.error(e.message),
  })

  const publish = trpc.assets.publishVersion.useMutation({
    onSuccess: (r) => {
      if (r.success) {
        toast.success(t('versionPublished'))
        void invalidate()
      } else toast.error(r.error)
    },
    onError: (e) => toast.error(e.message),
  })

  const rollback = trpc.assets.rollbackVersion.useMutation({
    onSuccess: (r) => {
      if (r.success) {
        toast.success(t('versionRolledBack'))
        void invalidate()
      } else toast.error(r.error)
    },
    onError: (e) => toast.error(e.message),
  })

  const yank = trpc.assets.yankVersion.useMutation({
    onSuccess: (r) => {
      if (r.success) {
        toast.success(t('versionYanked'))
        void invalidate()
      } else toast.error(r.error)
    },
    onError: (e) => toast.error(e.message),
  })

  return (
    <div className='space-y-4'>
      <div className='space-y-2 rounded-lg border p-4'>
        <Label htmlFor='gw-version'>{t('versionNewLabel')}</Label>
        <div className='flex gap-2'>
          <Input
            id='gw-version'
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            placeholder='1.0.0'
            className='max-w-40'
          />
          <Button
            size='sm'
            disabled={!version.trim() || create.isPending}
            onClick={() => create.mutate({ kind, assetId, version: version.trim(), changelog: changelog.trim() || undefined })}
          >
            {t('versionCreate')}
          </Button>
        </div>
        <Textarea
          value={changelog}
          onChange={(e) => setChangelog(e.target.value)}
          placeholder={t('versionChangelogPlaceholder')}
          rows={2}
        />
        <p className='text-muted-foreground text-xs'>{t('gatewayVersionHint')}</p>
      </div>

      {isLoading ? (
        <p className='text-muted-foreground text-sm'>{t('versionLoading')}</p>
      ) : (versions?.length ?? 0) === 0 ? (
        <p className='text-muted-foreground text-sm'>{t('versionEmpty')}</p>
      ) : (
        <div className='overflow-x-auto rounded-lg border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('versionColVersion')}</TableHead>
                <TableHead>{t('versionColStatus')}</TableHead>
                <TableHead>{t('versionColPublished')}</TableHead>
                <TableHead>{t('versionColChangelog')}</TableHead>
                <TableHead className='text-right'>{t('versionColActions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {versions!.map((v) => (
                <TableRow key={v.id}>
                  <TableCell className='font-mono text-xs'>{v.version}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[v.status] ?? 'outline'}>{v.status}</Badge>
                  </TableCell>
                  <TableCell className='text-muted-foreground text-xs'>
                    {v.publishedAt ? new Date(v.publishedAt).toLocaleString() : '—'}
                  </TableCell>
                  <TableCell className='max-w-48 truncate text-muted-foreground text-xs'>
                    {v.changelog || '—'}
                  </TableCell>
                  <TableCell className='text-right'>
                    <div className='flex justify-end gap-1'>
                      {v.status === 'draft' ? (
                        <Button
                          size='sm'
                          variant='outline'
                          disabled={publish.isPending}
                          onClick={() => publish.mutate({ kind, versionId: v.id })}
                        >
                          {t('versionPublish')}
                        </Button>
                      ) : null}
                      {v.status === 'published' ? (
                        <Button
                          size='sm'
                          variant='ghost'
                          disabled={rollback.isPending}
                          onClick={() => rollback.mutate({ kind, versionId: v.id })}
                        >
                          {t('versionRollback')}
                        </Button>
                      ) : null}
                      {v.status !== 'yanked' ? (
                        <Button
                          size='sm'
                          variant='ghost'
                          className='text-destructive'
                          disabled={yank.isPending}
                          onClick={() => yank.mutate({ kind, versionId: v.id })}
                        >
                          {t('versionYank')}
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}