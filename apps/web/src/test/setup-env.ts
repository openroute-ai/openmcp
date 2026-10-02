/**
 * 测试环境引导。
 *
 * `@/lib/db` 在**模块求值时**就读取 `DATABASE_URL`，而 vitest 不像 Next.js
 * 那样自动加载 `.env`。所以必须在任何 import 之前把变量塞进 `process.env`，
 * 否则连接串是 `undefined`，报错会伪装成 SCRAM 认证失败
 * （`client password must be a string`），完全看不出根因是缺环境变量。
 *
 * 这里只读根目录的 `.env`，不读 `.env.local` 等，避免开发者本机覆盖值意外
 * 决定测试连到哪个库——集成测试会真的写数据，必须连到明确的测试库。
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))

// 向上找根 `.env`：写死层级在 pnpm workspace 调整目录后就会指向错误位置，
// 而错误的路径只会表现为"变量不存在"，很难一眼看出是层级算错了。
let repoRoot = here
let envPath = path.join(repoRoot, ".env")
for (let i = 0; i < 6; i += 1) {
  const candidate = path.join(repoRoot, ".env")
  if (fs.existsSync(candidate)) {
    envPath = candidate
    break
  }
  repoRoot = path.dirname(repoRoot)
}

if (fs.existsSync(envPath)) {
  for (const rawLine of fs.readFileSync(envPath, "utf8").split("\n")) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue
    const eq = line.indexOf("=")
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (key && process.env[key] === undefined) process.env[key] = value
  }
}

if (!process.env.DATABASE_URL) {
  throw new Error(
    `DATABASE_URL 未设置：在 ${envPath} 里找不到它。结算集成测试会写入真实数据库，` +
      `请先配置该变量再运行。`
  )
}