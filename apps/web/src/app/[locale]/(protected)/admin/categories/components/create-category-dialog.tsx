'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { IconPicker } from '@/components/admin/icon-picker'
import { Button } from '@workspace/ui/components/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@workspace/ui/components/dialog'
import { Input } from '@workspace/ui/components/input'
import { Label } from '@workspace/ui/components/label'
import { Textarea } from '@workspace/ui/components/textarea'
import { trpc } from '@/lib/trpc/client'

interface CreateCategoryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

export function CreateCategoryDialog({ open, onOpenChange, onSuccess }: CreateCategoryDialogProps) {
  const [formData, setFormData] = useState({
    referenceId: '',
    name: '',
    nameEn: '',
    slug: '',
    description: '',
    descriptionEn: '',
    icon: '',
    order: 0,
    isActive: true,
  })

  const createCategoryMutation = trpc.admin.categories.createCategory.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        toast.success('创建成功')
        onSuccess()
        setFormData({
          referenceId: '',
          name: '',
          nameEn: '',
          slug: '',
          description: '',
          descriptionEn: '',
          icon: '',
          order: 0,
          isActive: true,
        })
      } else {
        toast.error(data.error || '创建失败')
      }
    },
    onError: (error) => {
      toast.error(error.message || '创建失败')
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    createCategoryMutation.mutate(formData)
  }

  const handleInputChange = (field: string, value: string | number | boolean) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='no-scrollbar max-h-[85vh] min-w-4xl overflow-y-auto'>
        <DialogHeader>
          <DialogTitle>创建分类</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className='space-y-4'>
          <div className='grid grid-cols-2 gap-4'>
            <div className='space-y-2'>
              <Label htmlFor='name'>名称 *</Label>
              <Input
                id='name'
                value={formData.name}
                onChange={(e) => handleInputChange('name', e.target.value)}
                required
              />
            </div>

            <div className='space-y-2'>
              <Label htmlFor='nameEn'>英文名称 *</Label>
              <Input
                id='nameEn'
                value={formData.nameEn}
                onChange={(e) => handleInputChange('nameEn', e.target.value)}
                required
              />
            </div>
          </div>
          <div className='grid grid-cols-2 gap-4'>
            <div className='space-y-2'>
              <Label htmlFor='slug'>标识符 *</Label>
              <Input
                id='slug'
                value={formData.slug}
                onChange={(e) => handleInputChange('slug', e.target.value)}
                required
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='referenceId'>引用ID</Label>
              <Input
                id='referenceId'
                value={formData.referenceId}
                onChange={(e) => handleInputChange('referenceId', e.target.value)}
              />
            </div>
          </div>
          <div className='space-y-2'>
            <Label htmlFor='description'>描述</Label>
            <Textarea
              id='description'
              value={formData.description}
              onChange={(e) => handleInputChange('description', e.target.value)}
              rows={2}
            />
          </div>
          <div className='space-y-2'>
            <Label htmlFor='descriptionEn'>英文描述</Label>
            <Textarea
              id='descriptionEn'
              value={formData.descriptionEn}
              onChange={(e) => handleInputChange('descriptionEn', e.target.value)}
              rows={2}
            />
          </div>

          <div className='grid grid-cols-2 gap-4'>
            <div className='space-y-2'>
              <Label htmlFor='icon'>图标</Label>
              <IconPicker value={formData.icon} onChange={(iconName) => handleInputChange('icon', iconName)} />
            </div>

            <div className='space-y-2'>
              <Label htmlFor='order'>排序</Label>
              <Input
                id='order'
                type='number'
                value={formData.order}
                onChange={(e) => handleInputChange('order', parseInt(e.target.value) || 0)}
              />
            </div>
          </div>

          <div className='flex items-center space-x-2'>
            <input
              type='checkbox'
              id='isActive'
              checked={formData.isActive}
              onChange={(e) => handleInputChange('isActive', e.target.checked)}
              className='rounded'
            />
            <Label htmlFor='isActive' className='cursor-pointer'>
              激活
            </Label>
          </div>

          <div className='flex justify-end space-x-2'>
            <Button type='button' variant='outline' onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type='submit' disabled={createCategoryMutation.isPending}>
              {createCategoryMutation.isPending ? '创建中...' : '创建'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
