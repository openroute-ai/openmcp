/**
 * 串行化 MDX 编译调用。
 *
 * `@fumadocs/mdx-remote` 的 `createCompiler()` 复用一个模块级 MDX 处理器，
 * 并发 `.compile()` 会让 AST 互相踩踏，表现为偶发报错：
 *   Cannot use 'in' operator to search for 'children' in undefined
 *
 * 用一条全局 promise 链把所有编译排队，同一进程内至多一个进行中。
 * 博客列表页会一次性编译多篇正文，不加这个限制在流量高峰期会稳定复现。
 */
let tail: Promise<unknown> = Promise.resolve()

export function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = tail.then(fn, fn)
  tail = run.catch(() => {})
  return run
}
