'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@workspace/ui/components/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@workspace/ui/components/dialog'
import { Input } from '@workspace/ui/components/input'
import { Label } from '@workspace/ui/components/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@workspace/ui/components/select'
import { Textarea } from '@workspace/ui/components/textarea'
import { trpc } from '@/lib/trpc/client'

interface CreateAuthorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

export function CreateAuthorDialog({ open, onOpenChange, onSuccess }: CreateAuthorDialogProps) {
  const [formData, setFormData] = useState({
    name: '',
    username: '',
    avatar: '',
    description: '',
    bio: '',
    website: '',
    twitter: '',
    linkedin: '',
    github: '',
    verified: false,
    status: 'active' as 'active' | 'inactive' | 'suspended',
  })

  const createAuthorMutation = trpc.admin.authors.createAuthor.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        toast.success('创建成功')
        onSuccess()
        setFormData({
          name: '',
          username: '',
          avatar: '',
          description: '',
          bio: '',
          website: '',
          twitter: '',
          linkedin: '',
          github: '',
          verified: false,
          status: 'active',
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
    createAuthorMutation.mutate(formData)
  }

  const handleInputChange = (field: string, value: string | boolean) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='no-scrollbar max-h-[85vh] min-w-4xl overflow-y-auto'>
        <DialogHeader>
          <DialogTitle>创建作者</DialogTitle>
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
              <Label htmlFor='username'>用户名 *</Label>
              <Input
                id='username'
                value={formData.username}
                onChange={(e) => handleInputChange('username', e.target.value)}
                required
              />
            </div>
          </div>

          <div className='space-y-2'>
            <Label htmlFor='avatar'>头像URL</Label>
            <Input id='avatar' value={formData.avatar} onChange={(e) => handleInputChange('avatar', e.target.value)} />
          </div>

          <div className='space-y-2'>
            <Label htmlFor='description'>简介</Label>
            <Textarea
              id='description'
              value={formData.description}
              onChange={(e) => handleInputChange('description', e.target.value)}
              rows={2}
            />
          </div>

          <div className='space-y-2'>
            <Label htmlFor='bio'>详细简介</Label>
            <Textarea
              id='bio'
              value={formData.bio}
              onChange={(e) => handleInputChange('bio', e.target.value)}
              rows={4}
            />
          </div>

          <div className='grid grid-cols-2 gap-4'>
            <div className='space-y-2'>
              <Label htmlFor='website'>网站</Label>
              <Input
                id='website'
                value={formData.website}
                onChange={(e) => handleInputChange('website', e.target.value)}
              />
            </div>

            <div className='space-y-2'>
              <Label htmlFor='twitter'>Twitter</Label>
              <Input
                id='twitter'
                value={formData.twitter}
                onChange={(e) => handleInputChange('twitter', e.target.value)}
              />
            </div>
          </div>

          <div className='grid grid-cols-2 gap-4'>
            <div className='space-y-2'>
              <Label htmlFor='linkedin'>LinkedIn</Label>
              <Input
                id='linkedin'
                value={formData.linkedin}
                onChange={(e) => handleInputChange('linkedin', e.target.value)}
              />
            </div>

            <div className='space-y-2'>
              <Label htmlFor='github'>GitHub</Label>
              <Input
                id='github'
                value={formData.github}
                onChange={(e) => handleInputChange('github', e.target.value)}
              />
            </div>
          </div>

          <div className='grid grid-cols-2 gap-4'>
            <div className='space-y-2'>
              <Label htmlFor='status'>状态 *</Label>
              <Select value={formData.status} onValueChange={(value) => handleInputChange('status', value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='active'>活跃</SelectItem>
                  <SelectItem value='inactive'>未激活</SelectItem>
                  <SelectItem value='suspended'>已暂停</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className='space-y-2'>
              <Label htmlFor='verified'>验证状态</Label>
              <div className='flex items-center space-x-2 pt-2'>
                <input
                  type='checkbox'
                  id='verified'
                  checked={formData.verified}
                  onChange={(e) => handleInputChange('verified', e.target.checked)}
                  className='rounded'
                />
                <Label htmlFor='verified' className='cursor-pointer'>
                  已验证
                </Label>
              </div>
            </div>
          </div>

          <div className='flex justify-end space-x-2'>
            <Button type='button' variant='outline' onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type='submit' disabled={createAuthorMutation.isPending}>
              {createAuthorMutation.isPending ? '创建中...' : '创建'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
