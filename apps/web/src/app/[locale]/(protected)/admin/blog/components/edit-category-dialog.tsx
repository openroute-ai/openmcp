'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
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
import { Textarea } from '@workspace/ui/components/textarea'
import { trpc } from '@/lib/trpc/client'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/shared/form'

const editCategorySchema = z.object({
  slug: z.string().min(1, 'Slug 不能为空'),
  name: z.string().min(1, '名称不能为空'),
  description: z.string().min(1, '描述不能为空'),
  locale: z.string().min(1, '语言不能为空'),
})

type EditCategoryFormValues = z.infer<typeof editCategorySchema>

interface EditCategoryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
  categoryId: string | null
}

export function EditCategoryDialog({ open, onOpenChange, onSuccess, categoryId }: EditCategoryDialogProps) {
  const { data: categoryData, isLoading } = trpc.admin.blog.getCategoryById.useQuery(
    { id: categoryId || '' },
    { enabled: !!categoryId && open }
  )

  const updateCategoryMutation = trpc.admin.blog.updateCategory.useMutation({
    onSuccess: () => {
      toast.success('更新成功')
      onSuccess()
      onOpenChange(false)
    },
    onError: (error) => {
      toast.error(error.message || '更新失败')
    },
  })

  const form = useForm<EditCategoryFormValues>({
    resolver: zodResolver(editCategorySchema),
    defaultValues: {
      slug: '',
      name: '',
      description: '',
      locale: 'zh',
    },
  })

  useEffect(() => {
    if (categoryData?.success && categoryData.data) {
      form.reset({
        slug: categoryData.data.slug,
        name: categoryData.data.name,
        description: categoryData.data.description,
        locale: categoryData.data.locale,
      })
    }
  }, [categoryData, form])

  const onSubmit = async (data: EditCategoryFormValues) => {
    if (!categoryId) return
    updateCategoryMutation.mutate({
      id: categoryId,
      ...data,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>编辑分类</DialogTitle>
          <DialogDescription>修改博客分类信息</DialogDescription>
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
                      <Input placeholder='分类名称' {...field} />
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
                        <Input placeholder='category-slug' {...field} />
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
                name='description'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>描述 *</FormLabel>
                    <FormControl>
                      <Textarea placeholder='分类描述' {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type='button' variant='outline' onClick={() => onOpenChange(false)}>
                  取消
                </Button>
                <Button type='submit' disabled={updateCategoryMutation.isPending}>
                  {updateCategoryMutation.isPending ? '保存中...' : '保存'}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  )
}
