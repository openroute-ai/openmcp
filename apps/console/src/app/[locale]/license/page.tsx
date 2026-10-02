import type { Metadata } from "next"

import { LongFormPage } from "@/components/public/long-form-page"
import { LocaleLink } from "@/i18n/navigation"

/**
 * 开源许可。
 *
 * 仓库根目录的 LICENSE 文件是 LGPL-2.1，这一页照着它写，同时回答读者真正会问的两件事：
 * 我能不能自建一个、能不能把它嵌进闭源产品。答案都在 LGPL 自己的条款里，所以这一页
 * 只做翻译和指路，不解释条款含义——解释 LGPL 不是我们的资格。
 */

const UPDATED = "2026-10-02"

const REPO = "https://github.com/openroute-ai/openmcp"

export const metadata: Metadata = {
  title: "开源许可 — OpenMCP 雷达",
  description:
    "代码以 LGPL-2.1 发布：可以自建、内网使用、可改可分发。",
  alternates: { canonical: "/license" },
  openGraph: {
    type: "website",
    title: "开源许可 — OpenMCP 雷达",
    description: "LGPL-2.1。",
    url: "https://radar.openmcp.cn/license",
  },
}

export default function LicensePage() {
  return (
    <LongFormPage
      title="开源许可"
      description="站点代码以 LGPL-2.1 发布，自建和内网使用都可以。"
      updated={UPDATED}
      footerNote={
        <>
          最后更新 {UPDATED}。许可证原文见仓库根目录的{" "}
          <a
            href={`${REPO}/blob/main/LICENSE`}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2"
          >
            LICENSE
          </a>
          ；数据口径见{" "}
          <LocaleLink href="/method" className="underline underline-offset-2">
            判定规则
          </LocaleLink>
          。
        </>
      }
    >
      <h2>代码：LGPL-2.1</h2>
      <p>
        本站的采集、判定、榜单与页面代码以{" "}
        <a
          href="https://www.gnu.org/licenses/old-licenses/lgpl-2.1.html"
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2"
        >
          GNU LGPL 2.1
        </a>{" "}
        发布，许可证全文在仓库根目录的{" "}
        <a
          href={`${REPO}/blob/main/LICENSE`}
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2"
        >
          LICENSE
        </a>
        。仓库地址：
        <a
          href={REPO}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-1 underline underline-offset-2"
        >
          {REPO}
        </a>
        。
      </p>

      <h2>你可以直接做的</h2>
      <ul>
        <li>
          <strong>自建一份。</strong>内网、离线、或者只给自己团队用，不需要向我们申请任何
          许可，也不必联系我们。LGPL 不对「使用」收费，也不要求你公开你的部署。
        </li>
        <li>
          <strong>看、改、重新分发。</strong>
          修改后的版本同样按 LGPL 发布，你只需要保留许可证声明和版权声明。
        </li>
        <li>
          <strong>接自己的数据。</strong>四个 JSON 接口返回的是事实数据，本来就鼓励你拿去
          做自己的分析。
        </li>
      </ul>

      <h2>需要注意边界的</h2>
      <ul>
        <li>
          <strong>与闭源代码放在同一个产品里。</strong>
          LGPL 允许你链接使用 LGPL 代码，但用户必须能替换掉这部分库（典型做法是自己提供
          替换入口，或以共享库形式分发）。具体到你的产品能不能满足这一条，取决于你的
          分发方式。
        </li>
        <li>
          <strong>改成 SaaS 对外提供服务。</strong>
          网络提供服务本身不触发 LGPL 的源码开放义务（这是 LGPL 与 AGPL 的关键区别），
          但如果你分发了二进制或镜像，仍然要遵守 LGPL 的条款。
        </li>
        <li>
          <strong>改动了代码但不发布。</strong>允许：只在自己机器上用或自建时没有公开义务。
        </li>
      </ul>
      <p>
        上面三条是 LGPL 的常见读法，不是法律意见。条款以许可证原文为准；涉及商业合规的
        决定请过一遍你们的法务。
      </p>

      <h2>不属于我们的东西</h2>
      <p>
        页面上出现的项目名称、描述、README、代码、logo 与许可证，全部属于各自的作者或
        所有者。我们公开引用它们，不主张也不转移任何权利。第三方商标归其所有者所有。
        你在自建版本里保留第三方内容时，请遵守各自的许可证。
      </p>

      <h2>数据与文案</h2>
      <p>
        星标、提交数、发布数这类事实数据不受许可证约束，你可以自由使用。页面文案与图表
        归我们所有，你引用数字时注明出处即可，不必申请授权。
      </p>
    </LongFormPage>
  )
}
