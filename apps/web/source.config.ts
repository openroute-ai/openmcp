import { defineDocs, defineConfig } from 'fumadocs-mdx/config'

/**
 * Fumadocs MDX 编译配置。
 *
 * 博客正文的来源是数据库而非文件系统（后台 MDX 编辑器写入 `blog_posts.content`），
 * 所以这里不声明 `dirs` / `docs` 之类的文件路由映射 —— 博客走
 * `@fumadocs/mdx-remote` 的运行时编译链路，见 `lib/blog/mdx-remote-compiler.ts`。
 *
 * `remarkPlugins` 与 `mdxOptions` 决定了后台编辑器能写什么语法，两者必须保持
 * 一致：编辑器能存进去的语法，服务端也得能编译出来，否则文章保存后渲染直接报错。
 */
export const docsCollections = defineDocs({
  dir: 'content/docs',
})

export default defineConfig({
  mdxOptions: {
    remarkPlugins: [],
    rehypePlugins: [],
  },
})
