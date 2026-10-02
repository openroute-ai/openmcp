import type { Metadata } from "next"

import { LongFormPage } from "@/components/public/long-form-page"
import { LocaleLink } from "@/i18n/navigation"

/**
 * 服务条款。
 *
 * 短，是因为它的核心只有一条：这里给的是数据，不是服务。任何写长了的条款都是在给
 * 一些不存在的行为打补丁——比如承诺「持续可用」，而这个站点是一个人的项目加一条
 * 每周跑一次的采集任务，诚实的写法是把不承诺什么写清楚。
 *
 * 明确写进去的两件事：数据可能有错（所以每条数字都带来源），以及任何一方的
 * 知识产权都归各自所有者（开源项目的名字、logo、代码都属于项目自己）。
 */

const UPDATED = "2026-10-02"

export const metadata: Metadata = {
  title: "服务条款 — OpenMCP 雷达",
  description:
    "数据怎么用、什么时候会不准、权利归谁。",
  alternates: { canonical: "/terms" },
  openGraph: {
    type: "website",
    title: "服务条款 — OpenMCP 雷达",
    description: "数据怎么用。",
    url: "https://radar.openmcp.cn/terms",
  },
}

export default function TermsPage() {
  return (
    <LongFormPage
      title="服务条款"
      description="这里给的是数据，不是服务，所以没有可用性承诺。"
      updated={UPDATED}
      footerNote={
        <>
          最后更新 {UPDATED}。开源许可见{" "}
          <LocaleLink href="/license" className="underline underline-offset-2">
            许可
          </LocaleLink>
          ，数据口径见{" "}
          <LocaleLink href="/method" className="underline underline-offset-2">
            判定规则
          </LocaleLink>
          。
        </>
      }
    >
      <h2>一、这是什么</h2>
      <p>
        OpenMCP 雷达是一个公开站点，按周采集 GitHub 上与 MCP 相关的公开仓库，公开它们的
        星标、提交、发布与许可证变化。它免费，不需要账号，不收费，也没有付费档位。
        {" "}
        <LocaleLink href="/about" className="underline underline-offset-2">
          这一页
        </LocaleLink>{" "}
        写清楚了它做什么、不做什么。
      </p>

      <h2>二、不承诺可用性，也不承诺准确</h2>
      <p>
        没有 SLA，没有状态页，也没有「持续可用」的承诺。采集每周跑一次，任何一次失败都
        会让某一周缺数据；缺的那一周会显示为没有数据，而不是被补成一个看起来完整的
        数字。
      </p>
      <p>
        数据来自 GitHub 的公开接口，可能出错，也可能已经过时。合并、改名、归档、fork、
        私有转公开这些事件我们不一定能及时发现。一条明显错的数据请报给我们，但请不要
        把这个站点的数字当作唯一依据——把它当线索，最终核实到仓库本身。
      </p>

      <h2>三、你可以怎么用这些数据</h2>
      <p>
        免费使用，不需要申请，不需要署名，也不设速率限制（目前的实现如此，未来可能会
        加，真加了会在这页写并说明理由）。批量抓取、接进你自己的系统、做二次分发都可以。
        引用数字时注明来自本雷达即可。
      </p>
      <p>
        不要用这些数据做两件事：一是把它包装成你自己的推荐服务并暗示我们背书，二是按
        它做自动化拦截（例如因为一次星标下跌就自动阻断某个依赖的构建）。
      </p>

      <h2>四、知识产权</h2>
      <p>
        站点自身的代码按仓库根目录的许可发布（见{" "}
        <LocaleLink href="/license" className="underline underline-offset-2">
          许可
        </LocaleLink>
        ）。页面文案与图表归我们。
      </p>
      <p>
        但所有出现在榜单、异动流和项目页上的内容——项目名称、描述、README、代码、
        logo、许可证——都属于各自的作者或所有者，我们只是公开引用。这是数据展示站，
        不主张也不转移任何上游权利。第三方商标归其所有者所有。
      </p>

      <h2>五、链接与外部站点</h2>
      <p>
        项目页会链到仓库、文档和站点。对这些外部站点的内容、可用性和条款我们没有控制，
        也不为它们背书。站内的{" "}
        <LocaleLink href="/contact" className="underline underline-offset-2">
          联系方式
        </LocaleLink>{" "}
        只通向我们自己的渠道。
      </p>

      <h2>六、你可以做的事</h2>
      <p>
        本站的代码、页面与接口都可以按许可使用。你可以举报错误数据、要求删除与你相关的
        账号数据、或者在公开场合引用任何数字。你不能做的是攻击站点、绕过访问控制、批量
        注册账号，或用自动化方式给我们的联系方式灌垃圾消息。
      </p>

      <h2>七、这一页怎么改</h2>
      <p>
        每次修改都会更新「最后更新」日期，不追溯适用旧版。条款本身不构成对你的约束力
        ——这一页是把你已经知道的规则写下来，而不是用来在纠纷里赢的。
      </p>
    </LongFormPage>
  )
}
