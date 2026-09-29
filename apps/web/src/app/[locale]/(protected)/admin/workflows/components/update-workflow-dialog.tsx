'use client'

import { Button } from '@workspace/ui/components/button'
import { Checkbox } from '@workspace/ui/components/checkbox'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@workspace/ui/components/dialog'
import { Input } from '@workspace/ui/components/input'
import { Label } from '@workspace/ui/components/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@workspace/ui/components/select'
import { Textarea } from '@workspace/ui/components/textarea'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { trpc } from '@/lib/trpc/client'

interface UpdateWorkflowDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workflow: any
  onSuccess: () => void
}

export function UpdateWorkflowDialog({ open, onOpenChange, workflow, onSuccess }: UpdateWorkflowDialogProps) {
  const [formData, setFormData] = useState({
    referenceId: '',
    slug: '',
    title: '',
    titleEn: '',
    description: '',
    descriptionEn: '',
    summary: '',
    metaDescription: '',
    authorId: '',
    imageUrl: '',
    workflowUrl: '',
    workflowJson: null as any,
    readme: '',
    readmeEn: '',
    priceType: 'free' as 'free' | 'paid',
    priceAmount: '',
    currency: 'CNY',
    complexity: 'beginner' as 'beginner' | 'intermediate' | 'advanced' | '',
    status: 'draft' as 'draft' | 'published' | 'archived' | 'rejected',
    categoryIds: [] as string[],
  })

  const [workflowJsonError, setWorkflowJsonError] = useState('')

  // 获取工作流详情
  const { data: workflowDetail } = trpc.admin.workflows.getWorkflowById.useQuery(
    { id: workflow?.id || '' },
    { enabled: !!workflow?.id }
  )

  // 获取作者列表
  const { data: authorsData } = trpc.admin.authors.getAuthorsPaginated.useQuery({
    page: 1,
    limit: 100,
  })

  // 获取分类列表
  const { data: categoriesData } = trpc.admin.categories.getCategoriesPaginated.useQuery({
    page: 1,
    limit: 100,
  })

  useEffect(() => {
    if (workflowDetail?.success && workflowDetail.data) {
      const data = workflowDetail.data
      setFormData({
        referenceId: data.referenceId || '',
        slug: data.slug || '',
        title: data.title || '',
        titleEn: data.titleEn || '',
        description: data.description || '',
        descriptionEn: data.descriptionEn || '',
        summary: data.summary || '',
        metaDescription: data.metaDescription || '',
        authorId: data.authorId || '',
        imageUrl: data.imageUrl || '',
        workflowUrl: data.workflowUrl || '',
        workflowJson: data.workflowJson || null,
        readme: data.readme || '',
        readmeEn: data.readmeEn || '',
        priceType: data.priceType || 'free',
        priceAmount: data.priceAmount || '',
        currency: data.currency || 'CNY',
        complexity: data.complexity || '',
        status: data.status || 'draft',
        categoryIds: data.categories?.map((c: any) => c.id) || [],
      })
    }
  }, [workflowDetail])

  const updateWorkflowMutation = trpc.admin.workflows.updateWorkflow.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        toast.success('更新成功')
        onSuccess()
      } else {
        toast.error(data.error || '更新失败')
      }
    },
    onError: (error) => {
      toast.error(error.message || '更新失败')
    },
  })

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (file.type !== 'application/json' && !file.name.endsWith('.json')) {
      setWorkflowJsonError('请上传JSON文件')
      return
    }

    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        const jsonContent = JSON.parse(event.target?.result as string)
        setFormData((prev) => ({ ...prev, workflowJson: jsonContent }))
        setWorkflowJsonError('')
      } catch (error) {
        setWorkflowJsonError('JSON文件格式错误')
      }
    }
    reader.onerror = () => {
      setWorkflowJsonError('文件读取失败')
    }
    reader.readAsText(file)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    if (!workflow?.id) return

    updateWorkflowMutation.mutate({
      id: workflow.id,
      ...formData,
      priceAmount: formData.priceAmount || undefined,
      complexity: formData.complexity || undefined,
      categoryIds: formData.categoryIds.length > 0 ? formData.categoryIds : undefined,
      workflowJson: formData.workflowJson || undefined,
    })
  }

  const handleInputChange = (field: string, value: string | string[]) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
  }

  const handleCategoryToggle = (categoryId: string) => {
    setFormData((prev) => ({
      ...prev,
      categoryIds: prev.categoryIds.includes(categoryId)
        ? prev.categoryIds.filter((id) => id !== categoryId)
        : [...prev.categoryIds, categoryId],
    }))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='no-scrollbar max-h-[85vh] min-w-4xl overflow-y-auto'>
        <DialogHeader>
          <DialogTitle>更新工作流</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className='space-y-4'>
          <div className='grid grid-cols-2 gap-4'>
            <div className='space-y-2'>
              <Label htmlFor='referenceId'>引用ID *</Label>
              <Input
                id='referenceId'
                value={formData.referenceId}
                onChange={(e) => handleInputChange('referenceId', e.target.value)}
                required
              />
            </div>

            <div className='space-y-2'>
              <Label htmlFor='slug'>标识符 *</Label>
              <Input
                id='slug'
                value={formData.slug}
                onChange={(e) => handleInputChange('slug', e.target.value)}
                required
              />
            </div>
          </div>

          <div className='grid grid-cols-2 gap-4'>
            <div className='space-y-2'>
              <Label htmlFor='title'>标题 *</Label>
              <Input
                id='title'
                value={formData.title}
                onChange={(e) => handleInputChange('title', e.target.value)}
                required
              />
            </div>

            <div className='space-y-2'>
              <Label htmlFor='titleEn'>英文标题</Label>
              <Input
                id='titleEn'
                value={formData.titleEn}
                onChange={(e) => handleInputChange('titleEn', e.target.value)}
              />
            </div>
          </div>

          <div className='grid grid-cols-2 gap-4'>
            <div className='space-y-2'>
              <Label htmlFor='description'>描述</Label>
              <Textarea
                id='description'
                value={formData.description}
                onChange={(e) => handleInputChange('description', e.target.value)}
                rows={3}
              />
            </div>

            <div className='space-y-2'>
              <Label htmlFor='descriptionEn'>英文描述</Label>
              <Textarea
                id='descriptionEn'
                value={formData.descriptionEn}
                onChange={(e) => handleInputChange('descriptionEn', e.target.value)}
                rows={3}
              />
            </div>
          </div>

          <div className='space-y-2'>
            <Label htmlFor='summary'>摘要</Label>
            <Textarea
              id='summary'
              value={formData.summary}
              onChange={(e) => handleInputChange('summary', e.target.value)}
              rows={2}
            />
          </div>

          <div className='grid grid-cols-2 gap-4'>
            <div className='space-y-2'>
              <Label htmlFor='authorId'>作者 *</Label>
              <Select value={formData.authorId} onValueChange={(value) => handleInputChange('authorId', value)}>
                <SelectTrigger>
                  <SelectValue placeholder='选择作者' />
                </SelectTrigger>
                <SelectContent>
                  {authorsData?.success &&
                    authorsData.data?.map((author: any) => (
                      <SelectItem key={author.id} value={author.id}>
                        {author.name} ({author.username})
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            <div className='space-y-2'>
              <Label htmlFor='imageUrl'>预览图URL</Label>
              <Input
                id='imageUrl'
                value={formData.imageUrl}
                onChange={(e) => handleInputChange('imageUrl', e.target.value)}
              />
            </div>
          </div>

          <div className='space-y-2'>
            <Label htmlFor='workflowUrl'>工作流URL</Label>
            <Input
              id='workflowUrl'
              value={formData.workflowUrl}
              onChange={(e) => handleInputChange('workflowUrl', e.target.value)}
            />
          </div>

          <div className='space-y-2'>
            <Label htmlFor='workflowJson'>工作流JSON文件（可选，留空则保持现有）</Label>
            <Input id='workflowJson' type='file' accept='.json,application/json' onChange={handleFileChange} />
            {workflowJsonError && <p className='text-destructive text-sm'>{workflowJsonError}</p>}
            {formData.workflowJson && (
              <p className='text-muted-foreground text-sm'>
                已选择新文件，包含 {formData.workflowJson.nodes?.length || 0} 个节点
              </p>
            )}
            {!formData.workflowJson && workflowDetail?.success && (
              <p className='text-muted-foreground text-sm'>
                当前工作流包含{' '}
                {(workflowDetail?.data?.workflowJson as { nodes?: unknown[] } | null | undefined)?.nodes?.length || 0}{' '}
                个节点
              </p>
            )}
          </div>

          <div className='space-y-2'>
            <Label>分类</Label>
            <div className='grid max-h-32 grid-cols-3 gap-2 overflow-y-auto rounded border p-2'>
              {categoriesData?.success &&
                categoriesData.data?.map((category: any) => (
                  <div key={category.id} className='flex items-center space-x-2'>
                    <Checkbox
                      id={`category-${category.id}`}
                      checked={formData.categoryIds.includes(category.id)}
                      onCheckedChange={() => handleCategoryToggle(category.id)}
                    />
                    <Label htmlFor={`category-${category.id}`} className='cursor-pointer text-sm'>
                      {category.name}
                    </Label>
                  </div>
                ))}
            </div>
          </div>

          <div className='grid grid-cols-3 gap-4'>
            <div className='space-y-2'>
              <Label htmlFor='priceType'>价格类型 *</Label>
              <Select value={formData.priceType} onValueChange={(value) => handleInputChange('priceType', value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='free'>免费</SelectItem>
                  <SelectItem value='paid'>付费</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {formData.priceType === 'paid' && (
              <div className='space-y-2'>
                <Label htmlFor='priceAmount'>价格</Label>
                <Input
                  id='priceAmount'
                  type='number'
                  step='0.01'
                  min='0'
                  value={formData.priceAmount}
                  onChange={(e) => handleInputChange('priceAmount', e.target.value)}
                />
              </div>
            )}

            <div className='space-y-2'>
              <Label htmlFor='currency'>货币</Label>
              <Select value={formData.currency} onValueChange={(value) => handleInputChange('currency', value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='CNY'>CNY</SelectItem>
                  <SelectItem value='USD'>USD</SelectItem>
                  <SelectItem value='EUR'>EUR</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className='grid grid-cols-2 gap-4'>
            <div className='space-y-2'>
              <Label htmlFor='complexity'>复杂度</Label>
              <Select value={formData.complexity} onValueChange={(value) => handleInputChange('complexity', value)}>
                <SelectTrigger>
                  <SelectValue placeholder='选择复杂度' />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='beginner'>初级</SelectItem>
                  <SelectItem value='intermediate'>中级</SelectItem>
                  <SelectItem value='advanced'>高级</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className='space-y-2'>
              <Label htmlFor='status'>状态 *</Label>
              <Select value={formData.status} onValueChange={(value) => handleInputChange('status', value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='draft'>草稿</SelectItem>
                  <SelectItem value='published'>已发布</SelectItem>
                  <SelectItem value='archived'>已归档</SelectItem>
                  <SelectItem value='rejected'>已拒绝</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className='grid grid-cols-2 gap-4'>
            <div className='space-y-2'>
              <Label htmlFor='readme'>README</Label>
              <Textarea
                id='readme'
                value={formData.readme}
                onChange={(e) => handleInputChange('readme', e.target.value)}
                rows={4}
              />
            </div>

            <div className='space-y-2'>
              <Label htmlFor='readmeEn'>README英文</Label>
              <Textarea
                id='readmeEn'
                value={formData.readmeEn}
                onChange={(e) => handleInputChange('readmeEn', e.target.value)}
                rows={4}
              />
            </div>
          </div>

          <div className='flex justify-end space-x-2'>
            <Button type='button' variant='outline' onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type='submit' disabled={updateWorkflowMutation.isPending}>
              {updateWorkflowMutation.isPending ? '更新中...' : '更新'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
