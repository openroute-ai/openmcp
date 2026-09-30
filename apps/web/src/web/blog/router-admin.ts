import { and, asc, desc, eq, like, or, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { db } from '@/lib/db'
import { blogAuthors, blogCategories, blogPosts } from '@workspace/db'
import { adminProcedure, createTRPCRouter } from '@/server/routers/trpc'

// ========== Schema 定义 ==========

const postCreateSchema = z.object({
  slug: z.string().min(1),
  path: z.string().min(1),
  slugs: z.array(z.string()),
  title: z.string().min(1),
  description: z.string().min(1),
  content: z.string().min(1),
  image: z.string().min(1),
  locale: z.string().default('zh'),
  date: z.date(),
  published: z.boolean().default(true),
  estimatedTime: z.number().optional(),
  authorId: z.string().optional(),
  categoryIds: z.array(z.string()).default([]),
})

const postUpdateSchema = postCreateSchema.partial().extend({
  id: z.string(),
})

const authorCreateSchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  avatar: z.string().min(1),
  locale: z.string().default('zh'),
})

const authorUpdateSchema = authorCreateSchema.partial().extend({
  id: z.string(),
})

const categoryCreateSchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  locale: z.string().default('zh'),
})

const categoryUpdateSchema = categoryCreateSchema.partial().extend({
  id: z.string(),
})

const listPostsSchema = z.object({
  filters: z
    .object({
      search: z.string().optional(),
      locale: z.string().optional(),
      published: z.boolean().optional(),
      authorId: z.string().optional(),
      categoryId: z.string().optional(),
    })
    .optional(),
  pagination: z.object({
    page: z.number().min(1).default(1),
    limit: z.number().min(1).max(100).default(20),
  }),
})

// ========== 文章管理 ==========

export const adminBlogRouter = createTRPCRouter({
  /**
   * 获取文章列表（分页）
   */
  listPosts: adminProcedure.input(listPostsSchema).query(async ({ input }) => {
    try {
      const { filters, pagination } = input
      const { page, limit } = pagination
      const offset = (page - 1) * limit

      const conditions = []
      if (filters?.search) {
        conditions.push(
          or(like(blogPosts.title, `%${filters.search}%`), like(blogPosts.description, `%${filters.search}%`))
        )
      }
      if (filters?.locale) {
        conditions.push(eq(blogPosts.locale, filters.locale))
      }
      if (filters?.published !== undefined) {
        conditions.push(eq(blogPosts.published, filters.published))
      }
      if (filters?.authorId) {
        conditions.push(eq(blogPosts.authorId, filters.authorId))
      }
      if (filters?.categoryId) {
        conditions.push(sql`${filters.categoryId} = ANY(${blogPosts.categoryIds})`)
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined

      const [data, totalResult] = await Promise.all([
        db
          .select({
            id: blogPosts.id,
            slug: blogPosts.slug,
            path: blogPosts.path,
            slugs: blogPosts.slugs,
            title: blogPosts.title,
            description: blogPosts.description,
            image: blogPosts.image,
            locale: blogPosts.locale,
            date: blogPosts.date,
            published: blogPosts.published,
            estimatedTime: blogPosts.estimatedTime,
            authorId: blogPosts.authorId,
            categoryIds: blogPosts.categoryIds,
            createdAt: blogPosts.createdAt,
            updatedAt: blogPosts.updatedAt,
            author: {
              id: blogAuthors.id,
              name: blogAuthors.name,
              avatar: blogAuthors.avatar,
            },
          })
          .from(blogPosts)
          .leftJoin(blogAuthors, eq(blogPosts.authorId, blogAuthors.id))
          .where(whereClause)
          .orderBy(desc(blogPosts.date))
          .limit(limit)
          .offset(offset),
        db.select({ count: sql<number>`count(*)` }).from(blogPosts).where(whereClause),
      ])

      const total = totalResult[0]?.count ?? 0

      return {
        success: true,
        data,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      }
    } catch (error) {
      console.error('获取文章列表失败:', error)
      return { success: false, error: '获取文章列表失败' }
    }
  }),

  /**
   * 获取单个文章
   */
  getPostById: adminProcedure.input(z.object({ id: z.string() })).query(async ({ input }) => {
    try {
      const [post] = await db
        .select({
          id: blogPosts.id,
          slug: blogPosts.slug,
          path: blogPosts.path,
          slugs: blogPosts.slugs,
          title: blogPosts.title,
          description: blogPosts.description,
          content: blogPosts.content,
          image: blogPosts.image,
          locale: blogPosts.locale,
          date: blogPosts.date,
          published: blogPosts.published,
          estimatedTime: blogPosts.estimatedTime,
          authorId: blogPosts.authorId,
          categoryIds: blogPosts.categoryIds,
          createdAt: blogPosts.createdAt,
          updatedAt: blogPosts.updatedAt,
          author: {
            id: blogAuthors.id,
            slug: blogAuthors.slug,
            name: blogAuthors.name,
            avatar: blogAuthors.avatar,
          },
        })
        .from(blogPosts)
        .leftJoin(blogAuthors, eq(blogPosts.authorId, blogAuthors.id))
        .where(eq(blogPosts.id, input.id))
        .limit(1)

      if (!post) {
        return { success: false, error: '文章不存在' }
      }

      return {
        success: true,
        data: post,
      }
    } catch (error) {
      console.error('获取文章失败:', error)
      return { success: false, error: '获取文章失败' }
    }
  }),

  /**
   * 创建文章
   */
  createPost: adminProcedure.input(postCreateSchema).mutation(async ({ input }) => {
    try {
      const [newPost] = await db.insert(blogPosts).values(input).returning()

      revalidatePath('/blog')

      return {
        success: true,
        data: newPost,
      }
    } catch (error) {
      console.error('创建文章失败:', error)
      return { success: false, error: '创建文章失败' }
    }
  }),

  /**
   * 更新文章
   */
  updatePost: adminProcedure.input(postUpdateSchema).mutation(async ({ input }) => {
    try {
      const { id, ...updateData } = input

      const [updatedPost] = await db
        .update(blogPosts)
        .set({
          ...updateData,
          updatedAt: new Date(),
        })
        .where(eq(blogPosts.id, id))
        .returning()

      if (!updatedPost) {
        return { success: false, error: '文章不存在' }
      }

      revalidatePath('/blog')

      return {
        success: true,
        data: updatedPost,
      }
    } catch (error) {
      console.error('更新文章失败:', error)
      return { success: false, error: '更新文章失败' }
    }
  }),

  /**
   * 删除文章
   */
  deletePost: adminProcedure.input(z.object({ id: z.string() })).mutation(async ({ input }) => {
    try {
      await db.delete(blogPosts).where(eq(blogPosts.id, input.id))

      revalidatePath('/blog')

      return {
        success: true,
      }
    } catch (error) {
      console.error('删除文章失败:', error)
      return { success: false, error: '删除文章失败' }
    }
  }),

  // ========== 作者管理 ==========

  /**
   * 获取作者列表
   */
  listAuthors: adminProcedure
    .input(
      z.object({
        locale: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      try {
        const authors = await db
          .select()
          .from(blogAuthors)
          .where(input.locale ? eq(blogAuthors.locale, input.locale) : undefined)
          .orderBy(asc(blogAuthors.name))

        return {
          success: true,
          data: authors,
        }
      } catch (error) {
        console.error('获取作者列表失败:', error)
        return { success: false, error: '获取作者列表失败' }
      }
    }),

  /**
   * 获取单个作者
   */
  getAuthorById: adminProcedure.input(z.object({ id: z.string() })).query(async ({ input }) => {
    try {
      const [author] = await db.select().from(blogAuthors).where(eq(blogAuthors.id, input.id)).limit(1)

      if (!author) {
        return { success: false, error: '作者不存在' }
      }

      return {
        success: true,
        data: author,
      }
    } catch (error) {
      console.error('获取作者失败:', error)
      return { success: false, error: '获取作者失败' }
    }
  }),

  /**
   * 创建作者
   */
  createAuthor: adminProcedure.input(authorCreateSchema).mutation(async ({ input }) => {
    try {
      const [newAuthor] = await db.insert(blogAuthors).values(input).returning()

      revalidatePath('/blog')

      return {
        success: true,
        data: newAuthor,
      }
    } catch (error) {
      console.error('创建作者失败:', error)
      return { success: false, error: '创建作者失败' }
    }
  }),

  /**
   * 更新作者
   */
  updateAuthor: adminProcedure.input(authorUpdateSchema).mutation(async ({ input }) => {
    try {
      const { id, ...updateData } = input

      const [updatedAuthor] = await db
        .update(blogAuthors)
        .set({
          ...updateData,
          updatedAt: new Date(),
        })
        .where(eq(blogAuthors.id, id))
        .returning()

      if (!updatedAuthor) {
        return { success: false, error: '作者不存在' }
      }

      revalidatePath('/blog')

      return {
        success: true,
        data: updatedAuthor,
      }
    } catch (error) {
      console.error('更新作者失败:', error)
      return { success: false, error: '更新作者失败' }
    }
  }),

  /**
   * 删除作者
   */
  deleteAuthor: adminProcedure.input(z.object({ id: z.string() })).mutation(async ({ input }) => {
    try {
      await db.delete(blogAuthors).where(eq(blogAuthors.id, input.id))

      revalidatePath('/blog')

      return {
        success: true,
      }
    } catch (error) {
      console.error('删除作者失败:', error)
      return { success: false, error: '删除作者失败' }
    }
  }),

  // ========== 分类管理 ==========

  /**
   * 获取分类列表
   */
  listCategories: adminProcedure
    .input(
      z.object({
        locale: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      try {
        const categories = await db
          .select()
          .from(blogCategories)
          .where(input.locale ? eq(blogCategories.locale, input.locale) : undefined)
          .orderBy(asc(blogCategories.name))

        return {
          success: true,
          data: categories,
        }
      } catch (error) {
        console.error('获取分类列表失败:', error)
        return { success: false, error: '获取分类列表失败' }
      }
    }),

  /**
   * 获取单个分类
   */
  getCategoryById: adminProcedure.input(z.object({ id: z.string() })).query(async ({ input }) => {
    try {
      const [category] = await db.select().from(blogCategories).where(eq(blogCategories.id, input.id)).limit(1)

      if (!category) {
        return { success: false, error: '分类不存在' }
      }

      return {
        success: true,
        data: category,
      }
    } catch (error) {
      console.error('获取分类失败:', error)
      return { success: false, error: '获取分类失败' }
    }
  }),

  /**
   * 创建分类
   */
  createCategory: adminProcedure.input(categoryCreateSchema).mutation(async ({ input }) => {
    try {
      const [newCategory] = await db.insert(blogCategories).values(input).returning()

      revalidatePath('/blog')

      return {
        success: true,
        data: newCategory,
      }
    } catch (error) {
      console.error('创建分类失败:', error)
      return { success: false, error: '创建分类失败' }
    }
  }),

  /**
   * 更新分类
   */
  updateCategory: adminProcedure.input(categoryUpdateSchema).mutation(async ({ input }) => {
    try {
      const { id, ...updateData } = input

      const [updatedCategory] = await db
        .update(blogCategories)
        .set({
          ...updateData,
          updatedAt: new Date(),
        })
        .where(eq(blogCategories.id, id))
        .returning()

      if (!updatedCategory) {
        return { success: false, error: '分类不存在' }
      }

      revalidatePath('/blog')

      return {
        success: true,
        data: updatedCategory,
      }
    } catch (error) {
      console.error('更新分类失败:', error)
      return { success: false, error: '更新分类失败' }
    }
  }),

  /**
   * 删除分类
   */
  deleteCategory: adminProcedure.input(z.object({ id: z.string() })).mutation(async ({ input }) => {
    try {
      await db.delete(blogCategories).where(eq(blogCategories.id, input.id))

      revalidatePath('/blog')

      return {
        success: true,
      }
    } catch (error) {
      console.error('删除分类失败:', error)
      return { success: false, error: '删除分类失败' }
    }
  }),
})
