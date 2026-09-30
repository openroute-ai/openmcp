'use client'

import { PostsTab } from '../components/posts-tab'

/**
 * The blog post list.
 *
 * `Routes.CMSBlog` in `lib/routes.ts` points at `/admin/blog/posts`, and
 * `create-post-dialog` / `edit/page.tsx` both navigate here after a mutation,
 * so this route has to exist for the blog admin to be reachable. `/admin/blog`
 * renders the same tab.
 */
export default function BlogPostsPage() {
  return <PostsTab />
}
