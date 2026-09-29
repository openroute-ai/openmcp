import z from 'zod'

// Workflow管理相关的Zod schema
export const zWorkflowAuthorSchema = z.object({
  id: z.string(),
  name: z.string(),
  username: z.string(),
  avatar: z.string().nullable(),
  verified: z.boolean(),
})

export const zWorkflowCategorySchema = z.object({
  id: z.string(),
  name: z.string(),
  nameEn: z.string(),
  slug: z.string(),
})

export const zWorkflowSchema = z.object({
  id: z.string(),
  referenceId: z.string(),
  slug: z.string(),
  title: z.string(),
  titleEn: z.string().nullable(),
  description: z.string().nullable(),
  descriptionEn: z.string().nullable(),
  summary: z.string().nullable(),
  metaDescription: z.string().nullable(),
  authorId: z.string(),
  author: zWorkflowAuthorSchema,
  imageUrl: z.string().nullable(),
  workflowUrl: z.string().nullable(),
  workflowJson: z.any().nullable(),
  readme: z.string().nullable(),
  readmeEn: z.string().nullable(),
  priceType: z.enum(['free', 'paid']),
  priceAmount: z.string().nullable(),
  currency: z.string().nullable(),
  complexity: z.enum(['beginner', 'intermediate', 'advanced']).nullable(),
  certified: z.boolean(),
  certifiedAt: z.date().nullable(),
  verificationCount: z.number(),
  popularity: z.number(),
  views: z.number(),
  downloads: z.number(),
  likes: z.number(),
  status: z.enum(['draft', 'published', 'archived', 'rejected']),
  publishedAt: z.date().nullable(),
  categories: z.array(zWorkflowCategorySchema),
  nodeTypes: z.array(z.string()),
  createdAt: z.date(),
  updatedAt: z.date(),
})

export type Workflow = z.infer<typeof zWorkflowSchema>
export type WorkflowAuthor = z.infer<typeof zWorkflowAuthorSchema>
export type WorkflowCategory = z.infer<typeof zWorkflowCategorySchema>
