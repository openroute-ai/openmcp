import type { Metadata } from "next"

import { siteTitle, siteUrl } from "@/lib/config/site"
import { LongFormPage } from "@/components/public/long-form-page"
import { LocaleLink } from "@/i18n/navigation"

/**
 * 安全声明。
 *
 * 这一页最容易变成一份没人核实的成绩单，所以写法反过来：先写「现状是什么」，再写
 * 「没有做什么」。没有第三方渗透测试、没有 SOC 2、没有赏金计划——这些都是真的没有，
 * 写在页面上比留白更安全，因为留白会被读成「大概有」。
 *
 * 「已实施」那几项每一条都对应代码里可见的机制（登录态校验、API Key 散列、接口速率
 * 限制、滑块验证码、HttpOnly 会话），所以这一页同样可以逐条核对。
 */

const UPDATED = "2026-10-02"

export const metadata: Metadata = {
  title: siteTitle("安全声明"),
  description:
    "已实施的安全机制、还没做的事，以及漏洞怎么报。",
  alternates: { canonical: "/security" },
  openGraph: {
    type: "website",
    title: siteTitle("安全声明"),
    description: "做了什么、没做什么。",
    url: siteUrl("/security"),
  },
}

export default function SecurityPage() {
  return (
    <LongFormPage
      title="安全声明"
      description="做了什么、没做什么。"
      updated={UPDATED}
      footerNote={
        <>
          最后更新 {UPDATED}。发现漏洞请走{" "}
          <LocaleLink href="/contact" className="underline underline-offset-2">
            联系我们
          </LocaleLink>
          ，细节不要发在公开渠道。
        </>
      }
    >
      <h2>已实施</h2>
      <ul>
        <li>
          <strong>公开页面不写 cookie、不加载第三方脚本。</strong>
          所以浏览榜单和异动流这条路径上没有可被第三方脚本读取的会话数据。
        </li>
        <li>
          <strong>需要登录的部分才有会话。</strong>
          会话 cookie 是 HttpOnly 的（JavaScript 读不到），受保护路径在服务端校验会话，
          不是靠前端隐藏入口。
        </li>
        <li>
          <strong>API Key 只存散列。</strong>
          生成时展示一次原文，之后无法取回；验证时只比对散列。控制台的 API key 只对账号
          自己的数据可见。
        </li>
        <li>
          <strong>登录与短信接口有限流。</strong>
          登录类接口按 IP 限流（每分钟 100 次），短信验证码按手机号与 IP 双维度限流，并
          要求先通过滑块验证码，以阻断批量注册和短信轰炸。
        </li>
        <li>
          <strong>角色不从注册请求里读。</strong>
          平台角色是账号表上的字段，注册时忽略请求体里的同名参数，避免把自己注册成
          管理员。
        </li>
        <li>
          <strong>采集不走带凭据的接口。</strong>
          数据来自匿名可访问的公开接口，不需要你的 GitHub token，也读不到私有仓库。
        </li>
      </ul>

      <h2>没有做的事</h2>
      <ul>
        <li>
          <strong>没有做过第三方渗透测试，也没有公开的安全审计报告。</strong>
        </li>
        <li>
          <strong>没有 SOC 2、ISO 27001 或等保之类的认证。</strong>谁采购谁都会问，所以
          直接写在这里。
        </li>
        <li>
          <strong>没有漏洞赏金计划。</strong>
          报告仍然欢迎，但目前不会有钱。
        </li>
        <li>
          <strong>没有多因素认证。</strong>控制台是单因子（密码 / 短信 / GitHub），
          账号里也没有 API Key 之外的第二道锁。
        </li>
        <li>
          <strong>公开接口没有鉴权，也没有速率限制。</strong>
          它们本来就是为了公开数据而开放的，但「无限制」意味着一次脚本可以把整份榜单
          拉走，请不要这么用。
        </li>
      </ul>

      <h2>怎么报告一个问题</h2>
      <p>
        通过{" "}
        <LocaleLink href="/contact" className="underline underline-offset-2">
          联系我们
        </LocaleLink>{" "}
        那个微信渠道发消息，说清是哪个页面或哪个接口、怎么复现、影响面是什么。请不要
        把可用的利用细节发在公开的 issue、评论区或聊天群里——那些地方不私密，而且一旦
        贴出来就等于公开了。
      </p>
      <p>
        我们不承诺响应时限，也不会在修复前公开讨论细节。但如果确实存在用户数据被他人
        访问的情况，请在那条消息里写明「涉及数据泄露」四个字，我们会优先处理并如实
        告知进展。
      </p>

      <h2>你能自己做的事</h2>
      <p>
        退出登录会清掉会话；撤销 API Key 会立刻让它失效，不需要等任何缓存过期。账号
        本身要删，走{" "}
        <LocaleLink href="/contact" className="underline underline-offset-2">
          联系我们
        </LocaleLink>{" "}
        即可；删除范围和保留期写在{" "}
        <LocaleLink href="/privacy" className="underline underline-offset-2">
          隐私政策
        </LocaleLink>{" "}
        里。
      </p>
    </LongFormPage>
  )
}
