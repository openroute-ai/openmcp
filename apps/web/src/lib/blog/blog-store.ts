import { create } from 'zustand'
import type { ExtendedPost } from './types'

/**
 * 博客数据缓存 Store
 * 只缓存编译后的文章详情（因为 MDX 编译耗时）
 */
interface BlogStore {
  // 缓存数据 - 只缓存文章详情（包含编译后的 MDX）
  posts: Map<string, ExtendedPost> // key: locale-slug, value: post

  // Actions
  setPost: (key: string, post: ExtendedPost) => void
  getPost: (key: string) => ExtendedPost | undefined
  clearPost: (key: string) => void
  clearAll: () => void
}

export const useBlogStore = create<BlogStore>((set, get) => ({
  // 初始状态
  posts: new Map(),

  // Actions
  setPost: (key, post) =>
    set((state) => ({
      posts: new Map(state.posts).set(key, post),
    })),

  getPost: (key) => get().posts.get(key),

  clearPost: (key) =>
    set((state) => {
      const newPosts = new Map(state.posts)
      newPosts.delete(key)
      return { posts: newPosts }
    }),

  clearAll: () =>
    set({
      posts: new Map(),
    }),
}))

/**
 * 生成缓存 key
 */
export function getPostCacheKey(slug: string[], locale: string): string {
  return `${locale}-${slug.join('/')}`
}
