import { createFromSource } from "fumadocs-core/search/server"

import { source } from "@/lib/docs/source"

/**
 * `/docs` 的搜索。
 *
 * 索引在第一个请求时建好，之后常驻内存——文档是构建期编译出来的静态内容，
 * 进程不重启就不会变，所以没有再落一份磁盘缓存的理由。
 *
 * 分词用默认的 `multilingual`：内容是中文，而按语言选分词器会让「星标增量」
 * 这类词切不开（`language: 'chinese'` 并不存在，`english` 会把汉字整段当一个
 * token，搜「榜单」就搜不到「周榜」）。
 *
 * `RootProvider` 里 `search.options.api` 指的就是这里，见
 * `components/docs/provider.tsx`。
 */
export const { GET } = createFromSource(source)