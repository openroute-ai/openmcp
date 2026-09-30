'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect } from 'react'
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

const editAuthorSchema = z.object({
  slug: z.string().min(1, 'Slug 不能为空'),
  name: z.string().min(1, '名称不能为空'),
  avatar: z.string().min(1, '头像不能为空'),
  locale: z.string().min(1, '语言不能为空'),
})

type EditAuthorFormValues = z.infer<typeof editAuthorSchema>

interface EditAuthorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
  authorId: string | null
}

export function EditAuthorDialog({ open, onOpenChange, onSuccess, authorId }: EditAuthorDialogProps) {
  const { data: authorData, isLoading } = trpc.admin.blog.getAuthorById.useQuery(
    { id: authorId || '' },
    { enabled: !!authorId && open }
  )

  const updateAuthorMutation = trpc.admin.blog.updateAuthor.useMutation({
    onSuccess: () => {
      toast.success('更新成功')
      onSuccess()
      onOpenChange(false)
    },
    onError: (error) => {
      toast.error(error.message || '更新失败')
    },
  })

  const form = useForm<EditAuthorFormValues>({
    resolver: zodResolver(editAuthorSchema),
    defaultValues: {
      slug: '',
      name: '',
      avatar: '',
      locale: 'zh',
    },
  })

  useEffect(() => {
    if (authorData?.success && authorData.data) {
      form.reset({
        slug: authorData.data.slug,
        name: authorData.data.name,
        avatar: authorData.data.avatar,
        locale: authorData.data.locale,
      })
    }
  }, [authorData, form])

  const onSubmit = async (data: EditAuthorFormValues) => {
    if (!authorId) return
    updateAuthorMutation.mutate({
      id: authorId,
      ...data,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>编辑作者</DialogTitle>
          <DialogDescription>修改博客作者信息</DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className='py-8 text-center text-muted-foreground'>加载中...</div>
        ) : (
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
                <Button type='submit' disabled={updateAuthorMutation.isPending}>
                  {updateAuthorMutation.isPending ? '保存中...' : '保存'}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  )
}
