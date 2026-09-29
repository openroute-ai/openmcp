'use client'

/**
 * Skill 版本管理组件
 * Provider 可查看、创建、发布、设置当前版本、撤回版本
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatDistanceToNow } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import { trpc } from '@/lib/trpc/client'
import { Button } from '@workspace/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@workspace/ui/components/dialog'
import { Input } from '@workspace/ui/components/input'
import { Label } from '@workspace/ui/components/label'
import { Textarea } from '@workspace/ui/components/textarea'
import { Badge } from '@workspace/ui/components/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@workspace/ui/components/table'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@workspace/ui/components/dropdown-menu'
import { CheckCircle2, Clock, MoreVertical, Plus, XCircle } from 'lucide-react'

interface SkillVersionsProps {
  skillId: string
  isProvider: boolean
}

export function SkillVersions({ skillId, isProvider }: SkillVersionsProps) {
  const router = useRouter()
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [newVersion, setNewVersion] = useState('')
  const [newChangelog, setNewChangelog] = useState('')
  const [autoPublish, setAutoPublish] = useState(false)

  const { data: versionsData, isLoading, refetch } = trpc.skills.listVersions.useQuery({
    skillId,
    isProvider,
  })

  const createVersionMutation = trpc.skills.createVersion.useMutation({
    onSuccess: () => {
      refetch()
      setIsCreateDialogOpen(false)
      setNewVersion('')
      setNewChangelog('')
      setAutoPublish(false)
    },
  })

  const publishVersionMutation = trpc.skills.publishVersion.useMutation({
    onSuccess: () => {
      refetch()
    },
  })

  const setCurrentVersionMutation = trpc.skills.setCurrentVersion.useMutation({
    onSuccess: () => {
      refetch()
      router.refresh()
    },
  })

  const yankVersionMutation = trpc.skills.yankVersion.useMutation({
    onSuccess: () => {
      refetch()
    },
  })

  const versions = versionsData?.success ? versionsData.data : []

  const handleCreateVersion = () => {
    if (!newVersion.trim()) return

    createVersionMutation.mutate({
      skillId,
      version: newVersion.trim(),
      changelog: newChangelog.trim() || undefined,
      autoPublish,
    })
  }

  const handlePublishVersion = (version: string) => {
    if (window.confirm(`确定要发布版本 ${version} 吗？`)) {
      publishVersionMutation.mutate({ skillId, version })
    }
  }

  const handleSetCurrentVersion = (version: string) => {
    if (window.confirm(`确定要将版本 ${version} 设为当前版本吗？这将成为用户默认下载的版本。`)) {
      setCurrentVersionMutation.mutate({ skillId, version })
    }
  }

  const handleYankVersion = (version: string) => {
    if (
      window.confirm(
        `确定要撤回版本 ${version} 吗？\n\n撤回后，新用户将无法下载此版本，但已下载的用户不受影响。\n\n注意：当前正在使用的版本不能被撤回。`
      )
    ) {
      yankVersionMutation.mutate({ skillId, version })
    }
  }

  const getStatusBadge = (status: string, isCurrent: boolean) => {
    if (isCurrent) {
      return (
        <Badge variant="default" className="gap-1">
          <CheckCircle2 className="h-3 w-3" />
          当前版本
        </Badge>
      )
    }

    switch (status) {
      case 'published':
        return <Badge variant="secondary">已发布</Badge>
      case 'draft':
        return <Badge variant="outline">草稿</Badge>
      case 'yanked':
        return (
          <Badge variant="destructive" className="gap-1">
            <XCircle className="h-3 w-3" />
            已撤回
          </Badge>
        )
      case 'archived':
        return <Badge variant="secondary">已归档</Badge>
      default:
        return <Badge variant="outline">{status}</Badge>
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Clock className="mr-2 h-4 w-4 animate-spin" />
        加载中...
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">版本管理</h3>
          <p className="text-sm text-muted-foreground">查看和管理 Skill 的所有版本</p>
        </div>
        {isProvider && (
          <Button onClick={() => setIsCreateDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            创建新版本
          </Button>
        )}
      </div>

      {versions.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-sm text-muted-foreground">暂无版本记录</p>
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>版本号</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>发布时间</TableHead>
                <TableHead>更新日志</TableHead>
                {isProvider && <TableHead className="text-right">操作</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {versions.map((version) => (
                <TableRow key={version.id}>
                  <TableCell className="font-mono font-medium">{version.version}</TableCell>
                  <TableCell>{getStatusBadge(version.status, version.isCurrent)}</TableCell>
                  <TableCell>
                    {version.publishedAt
                      ? formatDistanceToNow(new Date(version.publishedAt), {
                          addSuffix: true,
                          locale: zhCN,
                        })
                      : '-'}
                  </TableCell>
                  <TableCell className="max-w-md truncate">{version.changelog || '-'}</TableCell>
                  {isProvider && (
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {version.status === 'draft' && (
                            <DropdownMenuItem
                              onClick={() => handlePublishVersion(version.version)}
                              disabled={publishVersionMutation.isPending}
                            >
                              发布版本
                            </DropdownMenuItem>
                          )}
                          {version.status === 'published' && !version.isCurrent && (
                            <DropdownMenuItem
                              onClick={() => handleSetCurrentVersion(version.version)}
                              disabled={setCurrentVersionMutation.isPending}
                            >
                              设为当前版本
                            </DropdownMenuItem>
                          )}
                          {version.status === 'published' && !version.isCurrent && (
                            <DropdownMenuItem
                              onClick={() => handleYankVersion(version.version)}
                              disabled={yankVersionMutation.isPending}
                              className="text-destructive"
                            >
                              撤回版本
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem
                            onClick={() => {
                              window.open(`/api/skills/${skillId}/download?version=${version.version}`, '_blank')
                            }}
                          >
                            下载此版本
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* 创建新版本对话框 */}
      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>创建新版本</DialogTitle>
            <DialogDescription>基于当前 Skill 内容创建一个新版本快照。</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="version">版本号 *</Label>
              <Input
                id="version"
                placeholder="1.0.0"
                value={newVersion}
                onChange={(e) => setNewVersion(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">请使用语义化版本号（如 1.0.0、2.1.3）</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="changelog">更新日志</Label>
              <Textarea
                id="changelog"
                placeholder="描述此版本的主要变更..."
                value={newChangelog}
                onChange={(e) => setNewChangelog(e.target.value)}
                rows={4}
              />
            </div>
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="autoPublish"
                checked={autoPublish}
                onChange={(e) => setAutoPublish(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300"
              />
              <Label htmlFor="autoPublish" className="cursor-pointer font-normal">
                立即发布并设为当前版本
              </Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={handleCreateVersion} disabled={!newVersion.trim() || createVersionMutation.isPending}>
              {createVersionMutation.isPending ? '创建中...' : autoPublish ? '发布版本' : '创建草稿'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
