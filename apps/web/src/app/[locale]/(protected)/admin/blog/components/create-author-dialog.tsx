'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { ImageUploadInput } from '@/components/admin/image-upload-input'
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@workspace/ui/components/select'
import { trpc } from '@/lib/trpc/client'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/shared/form'

const createAuthorSchema = z.object({
  slug: z.string().min(1, 'Slug 不能为空'),
  name: z.string().min(1, '名称不能为空'),
  avatar: z.string().min(1, '头像不能为空'),
  locale: z.string().min(1, '语言不能为空'),
})

type CreateAuthorFormValues = z.infer<typeof createAuthorSchema>

interface CreateAuthorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

export function CreateAuthorDialog({ open, onOpenChange, onSuccess }: CreateAuthorDialogProps) {
  const createAuthorMutation = trpc.admin.blog.createAuthor.useMutation({
    onSuccess: () => {
      toast.success('创建成功')
      onSuccess()
    },
    onError: (error) => {
      toast.error(error.message || '创建失败')
    },
  })

  const form = useForm<CreateAuthorFormValues>({
    resolver: zodResolver(createAuthorSchema),
    defaultValues: {
      slug: '',
      name: '',
      avatar: '',
      locale: 'zh',
    },
  })

  const onSubmit = async (data: CreateAuthorFormValues) => {
    createAuthorMutation.mutate(data)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>创建新作者</DialogTitle>
          <DialogDescription>
            添加一个新的博客作者。如需创建多语言版本，请使用相同的 slug 但选择不同的语言。
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-4'>
            <FormField
              control={form.control}
              name='name'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>名称 *</FormLabel>
                  <FormControl>
                    <Input placeholder='作者名称' {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className='grid grid-cols-2 gap-4'>
              <FormField
                control={form.control}
                name='slug'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Slug *</FormLabel>
                    <FormControl>
                      <Input placeholder='author-slug' {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='locale'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>语言</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder='选择语言' />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value='zh'>中文</SelectItem>
                        <SelectItem value='en'>English</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name='avatar'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>头像 *</FormLabel>
                  <FormControl>
                    <ImageUploadInput
                      value={field.value}
                      onChange={field.onChange}
                      scope='avatar'
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type='button' variant='outline' onClick={() => onOpenChange(false)}>
                取消
              </Button>
              <Button type='submit' disabled={createAuthorMutation.isPending}>
                {createAuthorMutation.isPending ? '创建中...' : '创建'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
