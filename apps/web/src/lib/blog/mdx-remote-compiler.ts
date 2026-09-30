import { createCompiler } from '@fumadocs/mdx-remote'

/**
 * Blog MDX Remote 编译器
 * createCompiler 会自动读取 source.config.ts 中的配置
 */
const compiler = createCompiler()

/**
 * 显式标注类型是必要的：`createCompiler` 返回匿名对象类型，其内部引用了
 * `@fumadocs/mdx-remote` 产物文件里的私有 `MdxContent`，让 TS 自动推导会生成
 * 指向 `node_modules/.../dist/render-XXXX` 的不可移植声明。这里的别名
 * 恰好绕开这层私有类型，同时保留完整的推导。
 */
export type MdxRemoteCompiler = ReturnType<typeof createCompiler>

export const blogMdxCompiler: MdxRemoteCompiler = compiler
