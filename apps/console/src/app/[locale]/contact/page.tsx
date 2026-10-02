import type { Metadata } from "next"

import { siteTitle, siteUrl } from "@/lib/config/site"
import { ContactCard } from "@/components/landing/contact-card"
import { LongFormPage } from "@/components/public/long-form-page"
import { LocaleLink } from "@/i18n/navigation"

/**
 * 联系我们 —— 一个人会读的消息入口，加上一份「什么该问」的清单。
 *
 * 只有微信一个渠道这件事本身是有意的：这个站点不收集表单，也不承诺 SLA。写清楚该问
 * 什么比多放几个渠道有用，因为大部分消息其实只需要一次核对——报一条明显错的数据，
 * 或者问某个仓库为什么不在榜上。
 */

export const metadata: Metadata = {
  title: siteTitle("联系我们"),
  description:
    "加微信问问题，或者报一条错的数据。",
  alternates: { canonical: "/contact" },
  openGraph: {
    type: "website",
    title: siteTitle("联系我们"),
    description: "加微信。",
    url: siteUrl("/contact"),
  },
}

export default function ContactPage() {
  return (
    <LongFormPage
      title="联系我们"
      description="加微信。没有表单，也没有自动回复；回不回、什么时候回，我不敢打包票。"
    >
      <ContactCard />

      <h2>可以问什么</h2>
      <ul>
        <li>
          <strong>报一条明显错的数据。</strong>
          仓库被合并、改名、归档、或者 fork 出了新的星标集中地，告诉我仓库名和大概是哪一周，
          我去查采集侧而不是让读者手动改。
        </li>
        <li>
          <strong>问某个仓库为什么不在榜上。</strong>榜单只覆盖能被匿名采集的公开仓库，
          排除原因通常在采样侧，这一条经常能直接答。
        </li>
        <li>
          <strong>阈值和口径。</strong>{" "}
          <LocaleLink href="/method" className="underline underline-offset-2">
            判定规则
          </LocaleLink>{" "}
          里写了每个门槛，但为什么是这个数是可以说清楚的。
        </li>
        <li>
          <strong>选型与部署。</strong>你在几个候选之间拿不定主意，或者要在内网离线环境里
          落地某一个方案，把约束说清楚我按约束说。
        </li>
      </ul>

      <h2>先自己看一眼</h2>
      <p>
        这一站的东西都是公开的，大部分问题自己就能查到：数据长什么样看{" "}
        <LocaleLink href="/anomalies" className="underline underline-offset-2">
          异动流
        </LocaleLink>
        ，怎么读看{" "}
        <LocaleLink href="/guide" className="underline underline-offset-2">
          选型指南
        </LocaleLink>
        ，字段和端点看{" "}
        <LocaleLink href="/docs" className="underline underline-offset-2">
          API 文档
        </LocaleLink>
        ，判定逻辑看{" "}
        <LocaleLink href="/method" className="underline underline-offset-2">
          判定规则
        </LocaleLink>
        。问之前先翻一遍，通常能省掉一轮。
      </p>

      <h2>不会做的事</h2>
      <ul>
        <li>不会因为你问得具体就给推荐清单。</li>
        <li>不会把问题排进路线图，也不会因此承诺时间。</li>
        <li>不会替你的法务判断某个许可证能不能用。</li>
      </ul>
    </LongFormPage>
  )
}
