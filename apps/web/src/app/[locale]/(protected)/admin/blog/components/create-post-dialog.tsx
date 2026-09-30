'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useRouter } from 'next/navigation'
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
import { Textarea } from '@workspace/ui/components/textarea'
import { trpc } from '@/lib/trpc/client'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/shared/form'

const createPostSchema = z.object({
  slug: z.string().min(1, 'Slug 不能为空'),
  title: z.string().min(1, '标题不能为空'),
  description: z.string().min(1, '描述不能为空'),
  image: z.string().min(1, '封面图片不能为空'),
  locale: z.string().min(1, '语言不能为空'),
  date: z.date(),
  published: z.boolean(),
})

type CreatePostFormValues = z.infer<typeof createPostSchema>

interface CreatePostDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

export function CreatePostDialog({ open, onOpenChange, onSuccess }: CreatePostDialogProps) {
  const router = useRouter()
  const createPostMutation = trpc.admin.blog.createPost.useMutation({
    onSuccess: (data) => {
      if (data.success && data.data) {
        toast.success('创建成功')
        onSuccess()
        router.push(`/admin/blog/posts/${data.data.id}/edit`)
      }
    },
    onError: (error) => {
      toast.error(error.message || '创建失败')
    },
  })

  const form = useForm<CreatePostFormValues>({
    resolver: zodResolver(createPostSchema),
    defaultValues: {
      slug: '',
      title: '',
      description: '',
      image: '',
      locale: 'zh',
      date: new Date(),
      published: true,
    },
  })

  const onSubmit = async (data: CreatePostFormValues) => {
    const slugs = data.slug.split('/').filter(Boolean)
    // 根据 slug 和 locale 生成 path
    // 如果 locale 是默认语言(zh)，path 就是 slug，否则是 slug.locale
    const path = data.locale === 'zh' ? slugs.join('/') : `${slugs.join('/')}.${data.locale}`

    createPostMutation.mutate({
      slug: data.slug,
      path,
      slugs,
      title: data.title,
      description: data.description,
      content: '# 新文章\n\n在这里开始编写内容...',
      image: data.image,
      locale: data.locale,
      date: data.date,
      published: data.published,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-2xl'>
        <DialogHeader>
          <DialogTitle>创建新文章</DialogTitle>
          <DialogDescription>
            创建一篇新的博客文章，创建后可以编辑完整内容。如需创建多语言版本，请使用相同的 slug 但选择不同的语言。
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-4'>
            <FormField
              control={form.control}
              name='title'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>标题 *</FormLabel>
                  <FormControl>
                    <Input placeholder='文章标题' {...field} />
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
                      <Input placeholder='my-first-post' {...field} />
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
                    <Textarea placeholder='文章描述' {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='image'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>封面图片 *</FormLabel>
                  <FormControl>
                    <ImageUploadInput
                      value={field.value}
                      onChange={field.onChange}
                      scope='asset'
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='date'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>发布日期</FormLabel>
                  <FormControl>
                    <Input
                      type='date'
                      value={field.value ? field.value.toISOString().split('T')[0] : ''}
                      onChange={(e) => field.onChange(e.target.value ? new Date(e.target.value) : new Date())}
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
              <Button type='submit' disabled={createPostMutation.isPending}>
                {createPostMutation.isPending ? '创建中...' : '创建'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
