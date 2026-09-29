import z from 'zod'

// Category管理相关的Zod schema
export const zCategorySchema = z.object({
  id: z.string(),
  referenceId: z.string().nullable(),
  name: z.string(),
  nameEn: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  descriptionEn: z.string().nullable(),
  icon: z.string().nullable(),
  order: z.number().nullable(),
  isActive: z.boolean(),
  workflowCount: z.number(), // 统计字段
  createdAt: z.date(),
  updatedAt: z.date(),
})

export type Category = z.infer<typeof zCategorySchema>
