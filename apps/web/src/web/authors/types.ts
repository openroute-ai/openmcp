import z from 'zod'

// Author管理相关的Zod schema
export const zAuthorSchema = z.object({
  id: z.string(),
  name: z.string(),
  username: z.string(),
  avatar: z.string().nullable(),
  description: z.string().nullable(),
  bio: z.string().nullable(),
  website: z.string().nullable(),
  twitter: z.string().nullable(),
  linkedin: z.string().nullable(),
  github: z.string().nullable(),
  verified: z.boolean(),
  status: z.enum(['active', 'inactive', 'suspended']),
  workflowCount: z.number(), // 统计字段
  skillCount: z.number(),
  personaCount: z.number(),
  hasLinks: z.boolean(), // 是否有任何链接
  createdAt: z.date(),
  updatedAt: z.date(),
})

export type Author = z.infer<typeof zAuthorSchema>
