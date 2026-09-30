import { z } from 'zod'

/**
 * Blog Author schema
 */
export const authorSchema = z.object({
  slug: z.string(),
  name: z.string(),
  avatar: z.string(),
  locale: z.string().optional().default('en'),
})

/**
 * Blog Category schema
 */
export const categorySchema = z.object({
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  locale: z.string().optional().default('en'),
})

/**
 * Blog Post schema
 */
export const postSchema = z.object({
  title: z.string(),
  description: z.string(),
  image: z.string(),
  date: z.date(),
  published: z.boolean().default(true),
  categories: z.array(z.string()),
  author: z.string(),
  estimatedTime: z.number().optional(),
})

/**
 * Extended Blog Post with resolved relations
 */
export const extendedPostSchema = z.object({
  title: z.string(),
  description: z.string(),
  image: z.string(),
  date: z.date(),
  published: z.boolean().default(true),
  estimatedTime: z.number().optional(),
  locale: z.string(),
  author: authorSchema.optional(),
  categories: z.array(categorySchema).optional(),
  slug: z.string(),
  slugAsParams: z.string(),
  body: z.string(),
  toc: z.any().optional(),
})

// Type exports
export type Author = z.infer<typeof authorSchema>
export type Category = z.infer<typeof categorySchema>
export type Post = z.infer<typeof postSchema>
export type ExtendedPost = z.infer<typeof extendedPostSchema>

/**
 * Blog Category with its posts
 */
export type CategoryWithPosts = Category & {
  posts?: Array<{
    id: string
    slug: string
    path: string
    slugs: string[]
    title: string
    description: string
    image: string
    date: Date
    published: boolean
    estimatedTime?: number
    locale: string
    author?: string
    categories: string[]
  }>
}
