"use client"

import { createOpenAPIPage } from "fumadocs-openapi/ui"

/**
 * `<OpenAPIPage />` 的客户端部分：交互式的请求示例、schema 展开、代码片段
 * 都需要在浏览器里跑，所以工厂必须在 client 模块里调用。
 *
 * 服务端那半在 `openapi-page.tsx`，负责把文档喂给它。
 */
export const OpenAPIPageClient = createOpenAPIPage()
