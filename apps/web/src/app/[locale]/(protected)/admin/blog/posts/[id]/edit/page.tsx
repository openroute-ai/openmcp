'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import {
  BlockTypeSelect,
  BoldItalicUnderlineToggles,
  CreateLink,
  codeBlockPlugin,
  codeMirrorPlugin,
  DiffSourceToggleWrapper,
  diffSourcePlugin,
  frontmatterPlugin,
  GenericJsxEditor,
  headingsPlugin,
  InsertCodeBlock,
  InsertFrontmatter,
  InsertImage,
  InsertTable,
  InsertThematicBreak,
  imagePlugin,
  type JsxComponentDescriptor,
  jsxPlugin,
  ListsToggle,
  linkDialogPlugin,
  linkPlugin,
  listsPlugin,
  MDXEditor,
  markdownShortcutPlugin,
  quotePlugin,
  Separator,
  tablePlugin,
  thematicBreakPlugin,
  toolbarPlugin,
  UndoRedo,
} from '@mdxeditor/editor'
import { ArrowLeft, Loader2, Save } from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { Button } from '@workspace/ui/components/button'
import { Card, CardContent, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { Input } from '@workspace/ui/components/input'
import { Skeleton } from '@workspace/ui/components/skeleton'
import { Textarea } from '@workspace/ui/components/textarea'
import { trpc } from '@/lib/trpc/client'
import '@mdxeditor/editor/style.css'
import { ImageUploadInput } from '@/components/admin/image-upload-input'
import { Checkbox } from '@workspace/ui/components/checkbox'
import { uploadFileToStorage } from '@/lib/storage/upload-client'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/shared/form'

const postFormSchema = z.object({
  slug: z.string().min(1, 'Slug 不能为空'),
  path: z.string().min(1, '路径不能为空'),
  slugs: z.array(z.string()),
  title: z.string().min(1, '标题不能为空'),
  description: z.string().optional(),
  content: z.string().min(1, '内容不能为空'),
  image: z.string().optional(),
  locale: z.string(),
  date: z.date(),
  published: z.boolean(),
})

type PostFormValues = z.infer<typeof postFormSchema>

// 支持的自定义 MDX 组件描述，用于在 MDXEditor 中渲染 JSX 组件
const customJsxComponentDescriptors: JsxComponentDescriptor[] = [
  {
    name: 'Callout',
    kind: 'flow',
    hasChildren: true,
    props: [{ name: 'type', type: 'string' }],
    Editor: GenericJsxEditor,
  },
  {
    name: 'Tabs',
    kind: 'flow',
    hasChildren: true,
    props: [{ name: 'defaultValue', type: 'string' }],
    Editor: GenericJsxEditor,
  },
  {
    name: 'TabsList',
    kind: 'flow',
    hasChildren: true,
    props: [],
    Editor: GenericJsxEditor,
  },
  {
    name: 'TabsTrigger',
    kind: 'flow',
    hasChildren: true,
    props: [{ name: 'value', type: 'string' }],
    Editor: GenericJsxEditor,
  },
  {
    name: 'TabsContent',
    kind: 'flow',
    hasChildren: true,
    props: [{ name: 'value', type: 'string' }],
    Editor: GenericJsxEditor,
  },
  {
    name: 'Accordion',
    kind: 'flow',
    hasChildren: true,
    props: [],
    Editor: GenericJsxEditor,
  },
  {
    name: 'Accordions',
    kind: 'flow',
    hasChildren: true,
    props: [],
    Editor: GenericJsxEditor,
  },
  {
    name: 'Mermaid',
    kind: 'flow',
    hasChildren: false,
    props: [{ name: 'source', type: 'string' }],
    Editor: GenericJsxEditor,
  },
  {
    name: 'TypeTable',
    kind: 'flow',
    hasChildren: false,
    props: [],
    Editor: GenericJsxEditor,
  },
  {
    name: 'Updates',
    kind: 'flow',
    hasChildren: true,
    props: [],
    Editor: GenericJsxEditor,
  },
  {
    name: 'Update',
    kind: 'flow',
    hasChildren: true,
    props: [],
    Editor: GenericJsxEditor,
  },
]

// 图片上传函数
// 源项目直接 POST `/api/upload/image`，目标项目没有该路由；改用目标已有的
// `@/lib/storage/upload-client`（内部走 `/api/storage/upload` + 可选预签名 PUT，
// 服务端按 scope 决定目录）。函数名、签名与 base64 fallback 行为保持不变。
async function uploadImageToOSS(file: File): Promise<string> {
  try {
    const { url } = await uploadFileToStorage(file, 'asset')
    return url
  } catch (error) {
    console.error('图片上传错误:', error)
    // 如果上传失败，返回一个临时的base64 URL作为fallback
    return new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.readAsDataURL(file)
    })
  }
}

export default function EditPostPage() {
  const params = useParams()
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(false)
  const [diffMarkdown, setDiffMarkdown] = useState('')
  const [editorKey, setEditorKey] = useState(0) // 用于在文章加载后强制重新渲染编辑器
  const postId = params.id as string

  const { data: postData, isLoading: isLoadingPost } = trpc.admin.blog.getPostById.useQuery(
    { id: postId },
    { enabled: !!postId }
  )

  const updatePostMutation = trpc.admin.blog.updatePost.useMutation({
    onSuccess: () => {
      toast.success('文章更新成功')
      router.push(`/admin/blog/posts`)
    },
    onError: (error) => {
      toast.error(error.message || '更新失败')
    },
  })

  const form = useForm<PostFormValues>({
    resolver: zodResolver(postFormSchema),
    defaultValues: {
      slug: '',
      path: '',
      slugs: [],
      title: '',
      description: '',
      content: '',
      image: '',
      locale: 'zh',
      date: new Date(),
      published: true,
    },
  })

  useEffect(() => {
    if (postData?.success && postData.data) {
      const post = postData.data
      form.reset({
        slug: post.slug,
        path: post.path,
        slugs: post.slugs as string[],
        title: post.title,
        description: post.description || '',
        content: post.content || '',
        image: post.image || '',
        locale: post.locale,
        date: post.date ? new Date(post.date) : new Date(),
        published: post.published ?? true,
      })
      // 设置diff markdown为原始内容
      setDiffMarkdown(post.content || '')
      // 重新挂载编辑器以确保内容正确展示
      setEditorKey((key) => key + 1)
    }
  }, [postData, form])

  const onSubmit = async (data: PostFormValues) => {
    setIsLoading(true)
    try {
      updatePostMutation.mutate({
        id: postId,
        ...data,
      })
    } finally {
      setIsLoading(false)
    }
  }

  const handleCancel = () => {
    router.push('/admin/blog/posts')
  }

  if (isLoadingPost) {
    return (
      <div className='space-y-6'>
        <Skeleton className='h-9 w-32' />
        <Card>
          <CardHeader>
            <Skeleton className='h-6 w-24' />
          </CardHeader>
          <CardContent className='space-y-4'>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className='space-y-2'>
                <Skeleton className='h-4 w-20' />
                <Skeleton className='h-10 w-full' />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!postData?.success || !postData.data) {
    return (
      <div className='space-y-6'>
        <div className='flex items-center gap-4'>
          <Button variant='outline' size='sm' onClick={() => router.back()}>
            <ArrowLeft className='mr-2 h-4 w-4' />
            返回
          </Button>
        </div>
        <Card>
          <CardContent className='flex items-center justify-center py-12'>
            <div className='text-center'>
              <h3 className='font-medium text-lg'>文章不存在</h3>
              <p className='text-muted-foreground'>请求的文章可能已被删除或不存在。</p>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className='space-y-6'>
      <div className='flex items-center justify-between'>
        <div className='flex items-center gap-4'>
          <Button variant='outline' size='sm' onClick={() => router.back()}>
            <ArrowLeft className='mr-2 h-4 w-4' />
            返回
          </Button>
          <div>
            <h1 className='font-bold text-2xl tracking-tight'>编辑文章: {postData.data.title}</h1>
          </div>
        </div>
        <div className='flex items-center gap-2'>
          <Button variant='outline' onClick={handleCancel}>
            取消
          </Button>
          <Button onClick={form.handleSubmit(onSubmit)} disabled={isLoading || updatePostMutation.isPending}>
            {isLoading || updatePostMutation.isPending ? (
              <>
                <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                保存中...
              </>
            ) : (
              <>
                <Save className='mr-2 h-4 w-4' />
                保存更改
              </>
            )}
          </Button>
        </div>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-8'>
          {/* 基本信息 */}
          <Card>
            <CardHeader>
              <CardTitle>基本信息</CardTitle>
            </CardHeader>
            <CardContent className='space-y-4'>
              <div className='grid gap-4 lg:grid-cols-2'>
                <FormField
                  control={form.control}
                  name='title'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className='font-medium text-sm'>标题 *</FormLabel>
                      <FormControl>
                        <Input placeholder='文章标题' {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name='slug'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className='font-medium text-sm'>Slug *</FormLabel>
                      <FormControl>
                        <Input placeholder='文章 slug' {...field} />
                      </FormControl>
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
                    <FormLabel className='font-medium text-sm'>描述</FormLabel>
                    <FormControl>
                      <Textarea placeholder='文章描述' className='min-h-[80px]' {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className='grid gap-4 lg:grid-cols-2'>
                <FormField
                  control={form.control}
                  name='image'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className='font-medium text-sm'>封面图片</FormLabel>
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
                      <FormLabel className='font-medium text-sm'>发布日期</FormLabel>
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
              </div>

              <div className='grid gap-4 lg:grid-cols-2'>
                <FormField
                  control={form.control}
                  name='locale'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className='font-medium text-sm'>语言</FormLabel>
                      <FormControl>
                        <Input placeholder='语言代码 (如: zh, en)' {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name='published'
                  render={({ field }) => (
                    <FormItem className='flex flex-row items-center space-x-3 space-y-0'>
                      <FormControl>
                        <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                      <div className='space-y-1 leading-none'>
                        <FormLabel className='cursor-pointer font-medium text-sm'>已发布</FormLabel>
                      </div>
                    </FormItem>
                  )}
                />
              </div>
            </CardContent>
          </Card>

          {/* 内容编辑 */}
          <Card>
            <CardHeader>
              <CardTitle>内容</CardTitle>
            </CardHeader>
            <CardContent>
              <FormField
                control={form.control}
                name='content'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className='font-medium text-sm'>MDX 内容 *</FormLabel>
                    <FormControl>
                      <div className='overflow-hidden rounded-lg border'>
                        <div className='max-h-[calc(100vh-500px)] overflow-y-auto'>
                          <MDXEditor
                            key={editorKey}
                            markdown={field.value || ''}
                            onChange={field.onChange}
                            onError={(error) => {
                              // 统一处理 MDXEditor 的解析错误，避免直接渲染报错信息
                              // 这里保留控制台输出，方便本地调试
                              // eslint-disable-next-line no-console
                              console.error('MDXEditor parsing error:', error)
                            }}
                            plugins={[
                              // diffSourcePlugin 必须在最前面，以便其他插件可以使用它
                              diffSourcePlugin({
                                viewMode: 'rich-text',
                                diffMarkdown: diffMarkdown,
                              }),
                              // 基础插件 - markdownShortcutPlugin 需要这些插件支持
                              headingsPlugin({ allowedHeadingLevels: [1, 2, 3, 4, 5, 6] }),
                              listsPlugin(),
                              quotePlugin(),
                              linkPlugin(),
                              // linkDialogPlugin 提供链接编辑对话框和快捷键支持
                              linkDialogPlugin({
                                linkAutocompleteSuggestions: [],
                              }),
                              // 表格插件
                              tablePlugin(),
                              // 主题分隔符插件
                              thematicBreakPlugin(),
                              // 代码块插件
                              codeBlockPlugin({ defaultCodeBlockLanguage: 'tsx' }),
                              codeMirrorPlugin({
                                codeBlockLanguages: {
                                  js: 'JavaScript',
                                  ts: 'TypeScript',
                                  typescript: 'TypeScript',
                                  tsx: 'TSX',
                                  jsx: 'JSX',
                                  html: 'HTML',
                                  css: 'CSS',
                                  json: 'JSON',
                                  md: 'Markdown',
                                  python: 'Python',
                                  java: 'Java',
                                  go: 'Go',
                                  rust: 'Rust',
                                  sql: 'SQL',
                                  bash: 'Bash',
                                  shell: 'Shell',
                                  text: 'Text',
                                },
                              }),
                              // 图片插件
                              imagePlugin({
                                imageAutocompleteSuggestions: [],
                                imageUploadHandler: async (file: File) => {
                                  try {
                                    const url = await uploadImageToOSS(file)
                                    return url
                                  } catch (error) {
                                    toast.error('图片上传失败，请重试')
                                    throw error
                                  }
                                },
                              }),
                              // frontmatter 插件
                              frontmatterPlugin(),
                              // JSX 组件插件，用于支持自定义 MDX 组件的渲染
                              jsxPlugin({
                                jsxComponentDescriptors: customJsxComponentDescriptors,
                              }),
                              // markdownShortcutPlugin 必须在对应的插件之后
                              markdownShortcutPlugin(),
                              // 工具栏插件 - 使用 DiffSourceToggleWrapper 包裹工具栏内容
                              toolbarPlugin({
                                toolbarContents: () => (
                                  <DiffSourceToggleWrapper>
                                    <UndoRedo />
                                    <Separator />
                                    <BoldItalicUnderlineToggles />
                                    <Separator />
                                    <BlockTypeSelect />
                                    <Separator />
                                    <ListsToggle />
                                    <Separator />
                                    <CreateLink />
                                    <InsertImage />
                                    <Separator />
                                    <InsertTable />
                                    <InsertCodeBlock />
                                    <InsertThematicBreak />
                                    <Separator />
                                    <InsertFrontmatter />
                                  </DiffSourceToggleWrapper>
                                ),
                              }),
                            ]}
                            contentEditableClassName='prose prose-sm sm:prose lg:prose-lg xl:prose-2xl mx-auto focus:outline-none min-h-[560px] max-h-none'
                          />
                        </div>
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>
        </form>
      </Form>
    </div>
  )
}
