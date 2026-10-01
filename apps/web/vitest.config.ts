import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // 必须指向 `src` 而不是 `dist`。
      //
      // `@workspace/db` 的 package.json 让 Node 优先解析 `dist/index.mjs`，
      // 而那个构建产物可能落后于 schema 源码（本次就是这样：`dist` 里没有
      // `providerEarnings.statementId`）。TypeScript 侧靠 tsconfig `paths` 指向
      // src，所以 typecheck 全绿，运行时却拿到旧表定义——症状是生成
      // `where (is null and ...)` 这种少了一列的 SQL，报
      // `syntax error at or near "null"`，完全看不出是构建产物过期。
      //
      // 测试直接吃源码就和 typecheck 对齐，也免去"改了 schema 必须先记得
      // `pnpm --filter @workspace/db build`"这个隐式步骤——忘了就会得到一套
      // 测的是旧代码的绿灯。
      "@workspace/db": fileURLToPath(new URL("../../packages/db/src/index.ts", import.meta.url)),
      // 同理：`@workspace/litellm` 只存在于 tsconfig `paths`，没有在
      // `apps/web/package.json` 的 dependencies 里声明（next.config 的
      // `transpilePackages` 让 Next 认它，Vite 不读 tsconfig paths，所以只有
      // 测试会在这里炸）。`transpilePackages` 已经把它当项目内包处理，
      // 这里只是让解析路径和 tsconfig 一致。
      "@workspace/litellm": fileURLToPath(
        new URL("../../packages/litellm/src/index.ts", import.meta.url)
      ),
    },
  },
  test: {
    environment: "node",
    include: ["src/test/**/*.test.ts"],
    // `@/lib/db` 在模块求值时就读 DATABASE_URL，必须先加载 `.env`，
    // 否则缺变量会伪装成 SASL 认证失败。
    setupFiles: ["src/test/setup-env.ts"],
    // 结算链路的集成测试直接打真实 PostgreSQL（余额、收入行、账单都要有真实的
    // 事务与 `numeric` 语义），所以必须串行：这些用例会插入并删除共享的
    // provider 记录，并行跑会互相看到对方的中间状态。
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})