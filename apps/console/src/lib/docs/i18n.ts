import { defineI18n } from "fumadocs-core/i18n"

/**
 * fumadocs 自己的 i18n，只管 UI 文案。
 *
 * 与 `lib/config/i18n.ts`（next-intl，管整站）是两回事：那个决定 URL 前缀和
 * 消息文件，这个决定 fumadocs 组件里那些按钮、aria-label 和目录标题怎么说。
 *
 * 只有一种语言：`/docs` 是中文的公开面，内容文件不带 locale 后缀
 * （见 `lib/docs/source.ts`），所以 `lib/docs/source.ts` 的 loader 也没有
 * 传 `i18n` —— URL 里不会出现语言段，页数与 `[locale]` 的取值无关。
 * `locales` 只有一项，语言切换器因此不会被渲染出来。
 */
export const docsI18n = defineI18n({
  defaultLanguage: "zh",
  languages: ["zh"],
  hideLocale: "default-locale",
})