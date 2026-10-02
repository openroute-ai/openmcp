import type { Metadata } from "next"

import { siteTitle, siteUrl } from "@/lib/config/site"
import { LongFormPage } from "@/components/public/long-form-page"
import { LocaleLink } from "@/i18n/navigation"

/**
 * 隐私政策。
 *
 * 内容对着代码写，不对着理想写：公开页面不写 cookie、也不加载任何第三方统计脚本；
 * 需要账号的是控制台，而控制台要存的东西（邮箱或手机号、密码散列、会话、关注的仓库、
 * 决策记录、API Key）都能在 `src/db/schema.ts` 里逐张表对上。这里出现而代码里没有的，
 * 或者代码里有而这里没写的，都算这一页的 bug。
 *
 * 唯一绕不开的第三方是登录与短信通道本身（GitHub OAuth、短信服务商），它们出现的地方
 * 都写明了。数据不出售、不用于广告投放——这不是承诺，是这里根本没有广告位，也没有
 * 任何代码路径能把星标时间轴和某个邮箱关联起来卖出去。
 */

const UPDATED = "2026-10-02"

export const metadata: Metadata = {
  title: siteTitle("隐私政策"),
  description:
    "公开页面不收集个人数据。需要账号的控制台存了什么、存多久、怎么删。",
  alternates: { canonical: "/privacy" },
  openGraph: {
    type: "website",
    title: siteTitle("隐私政策"),
    description: "存什么、存多久、怎么删。",
    url: siteUrl("/privacy"),
  },
}

export default function PrivacyPage() {
  return (
    <LongFormPage
      title="隐私政策"
      description="公开页面不收集个人数据。控制台存的东西列在下面。"
      updated={UPDATED}
      footerNote={
        <>
          最后更新 {UPDATED}。要删除账号里的数据或对这一页提出疑问，{" "}
          <LocaleLink href="/contact" className="underline underline-offset-2">
            联系我们
          </LocaleLink>
          。
        </>
      }
    >
      <h2>公开页面</h2>
      <p>
        浏览{" "}
        <LocaleLink href="/rankings" className="underline underline-offset-2">
          榜单
        </LocaleLink>
        、{" "}
        <LocaleLink href="/anomalies" className="underline underline-offset-2">
          异动流
        </LocaleLink>{" "}
        和这一站的其他公开页面不需要账号，我们不要求你留下任何身份信息：不设 cookie，
        不加载任何第三方统计、广告或行为追踪脚本，也不读取浏览器的指纹类标识。
      </p>
      <p>
        唯一可能的例外是语言选择：你在站内切换语言时，浏览器会存一枚
        <code>NEXT_LOCALE</code> cookie 记住这个选择。它只存在于你自己的浏览器里，
        我们看不到，也不用它做别的。它清掉之后下次访问会回到默认语言。
      </p>

      <h2>需要账号的控制台</h2>
      <p>
        <LocaleLink href="/console" className="underline underline-offset-2">
          控制台
        </LocaleLink>{" "}
        需要登录，因为它要做的是记住「你关注了哪些仓库、你做过哪些选型决策」。它会存：
      </p>
      <ul>
        <li>
          <strong>登录标识</strong>：邮箱地址，或者手机号（取决于你用的登录方式）。密码
          只以不可逆散列存储，我们看不到原文。
        </li>
        <li>
          <strong>会话记录</strong>：会话令牌、过期时间，以及该次登录的 IP 与浏览器标识。
          后两项用于登录接口的速率限制和异常登录排查。
        </li>
        <li>
          <strong>你添加的仓库与决策记录</strong>：关注的仓库列表、决策板、候选项目与
          结论。这些是控制台唯一的功能内容，不会被用于任何推荐。
        </li>
        <li>
          <strong>API Key</strong>：只存散列值。生成时给你看一次原文，之后无法再取回，
          丢了只能重建。
        </li>
        <li>
          <strong>账号状态</strong>：角色、封禁标记与封禁原因，仅在你触发风控或管理员操作
          时写入。
        </li>
      </ul>

      <h2>为什么存这些</h2>
      <p>
        每一项都对应控制台的一个功能：没有会话你无法登录，没有仓库列表和决策记录
        控制台就没有内容可显示，没有 API Key 散列就无法验证调用方。没有为了别的目的
        采集的数据——特别是，我们不做用户画像，也不把账号数据和星标时间轴做任何关联。
      </p>

      <h2>不做什么</h2>
      <ul>
        <li>不出售、不出租、不交换你的个人信息。</li>
        <li>不用于广告投放或定向，也不接入任何第三方广告网络。</li>
        <li>不因为「改进产品」而抓取你的浏览行为。</li>
      </ul>

      <h2>第三方</h2>
      <p>下面这些是必然会碰到第三方的环节，除此之外没有别的：</p>
      <ul>
        <li>
          <strong>GitHub 登录</strong>：你选择用它登录时，GitHub 会把账号的公开资料和邮箱
          提供给我们。你的 GitHub 密码我们拿不到，也从不要求你提供。
        </li>
        <li>
          <strong>短信通道</strong>：你选择手机号登录时，短信服务商会在发送验证码的过程中
          处理你的手机号。短信正文里不含任何其他信息。
        </li>
        <li>
          <strong>基础设施</strong>：服务器、数据库、对象存储与 CDN 由云服务商提供，他们
          在运维层面接触得到数据，这是托管的必然结果。
        </li>
      </ul>

      <h2>保存多久</h2>
      <p>
        账号数据保存到账号注销为止。注销会删除账号及其下属数据（仓库列表、决策记录、
        会话、API Key）；会话记录本身有有效期，过期即失效。删除请求走{" "}
        <LocaleLink href="/contact" className="underline underline-offset-2">
          联系我们
        </LocaleLink>
        ，人工处理，我们不做自助的数据导出工具，因为目前没有需要导出的东西。
      </p>

      <h2>Cookie 清单</h2>
      <ul>
        <li>
          <code>NEXT_LOCALE</code>：语言偏好，仅存于浏览器，可随时清除。
        </li>
        <li>
          会话 cookie：登录后才有，退出登录或过期后失效；HttpOnly，不可被 JavaScript 读取。
        </li>
      </ul>
      <p>公开页面上不会出现这两类之外的 cookie。</p>

      <h2>联系与变更</h2>
      <p>
        这一页的每次修改都会改上面的「最后更新」日期，不做静默修订。如果哪一段与实际
        行为不符，{" "}
        <LocaleLink href="/contact" className="underline underline-offset-2">
          告诉我们
        </LocaleLink>
        ——以实际行为为准，我们改文案。
      </p>
    </LongFormPage>
  )
}
