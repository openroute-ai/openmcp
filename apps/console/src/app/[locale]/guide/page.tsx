import type { Metadata } from "next"

import { siteTitle, siteUrl } from "@/lib/config/site"
import { LongFormPage } from "@/components/public/long-form-page"
import { LocaleLink } from "@/i18n/navigation"

/**
 * 选型指南 —— 怎么用这几张榜和异动流，而不是「推荐用哪个」。
 *
 * 这一页不给出选型结论，因为给出结论就要我们对某个仓库的质量、许可证合规和长期
 * 维护能力表态，而这三样都超出公开星标和提交数据能支撑的范围。它给出的是读法：先看
 * 什么、把哪个数当门槛、什么时候应该停下来去读代码。这比一份会过期的推荐清单有用，
 * 也不会在某天被人当成推荐清单引用。
 */

export const metadata: Metadata = {
  title: siteTitle("选型指南"),
  description:
    "三张榜各回答什么问题，门槛怎么定，以及什么时候数据已经不够用了。",
  alternates: { canonical: "/guide" },
  openGraph: {
    type: "website",
    title: siteTitle("选型指南"),
    description: "怎么读这几张榜。",
    url: siteUrl("/guide"),
  },
}

export default function GuidePage() {
  return (
    <LongFormPage
      title="选型指南"
      description="怎么用这几张榜和异动流。"
    >
      <h2>先定方向，再看榜</h2>
      <p>
        打开榜单时的第一个问题通常是「哪个最好」。这个问题在看到任何数字之前就已经答错了：
        你还没有取舍标准，榜上的行对你来说全都一样。先写下你在意什么——中文文档、能否离线
        部署、许可证能不能商用、活跃度、多久能上手——再拿它去筛。
      </p>
      <p>
        用 <LocaleLink href="/categories" className="underline underline-offset-2">
          应用分类
        </LocaleLink>{" "}
        做第一轮粗筛，用{" "}
        <LocaleLink href="/rankings" className="underline underline-offset-2">
          公开榜单
        </LocaleLink>{" "}
        里的月榜看规模增速是否匹配你的假设，用{" "}
        <LocaleLink href="/rankings/rising" className="underline underline-offset-2">
          飙升榜
        </LocaleLink>{" "}
        找正在被新发现的项目。
      </p>

      <h2>三张榜分别回答什么问题</h2>
      <ul>
        <li>
          <strong>月榜（绝对增量）</strong>：这个周期里，谁拿到的关注最多。适合判断
          「这东西是不是在行业里真的被用起来了」——大基数项目在这里的增量仍然有意义。
        </li>
        <li>
          <strong>飙升榜（相对增速 + 双门槛）</strong>：谁在被新发现。要求上周至少
          200 星、本周至少 +50 星，因为 4 涨到 8 是 +100% 且毫无信息量。百分比和分母
          在同一行上，看的时候不要只看百分比。
        </li>
        <li>
          <strong>异动流</strong>：谁刚刚变了——增长、衰退、维护停滞、许可证变更。适合
          已经上了候选名单的项目做定期复查，而不是用来发现新项目。
        </li>
      </ul>

      <h2>门槛怎么定</h2>
      <p>
        「至少 5,000 星」不是一个通用门槛：对数据库客户端和一个命令行工具来说它不是一个
        量级，更多反映的是项目类型和存在时间。相对可用的是这三条：
      </p>
      <ul>
        <li>
          <strong>候选进入短名单：</strong>上月增量超过 0，且不是本周突然冒出来的
          （避免被单周活动和榜单效应骗进去）。
        </li>
        <li>
          <strong>短名单进决策会：</strong>最近 3 周都出现在月榜前 N，且没有命中任何
          下行或风险类异动。
        </li>
        <li>
          <strong>任何时候的否决项：</strong>许可证变更、连续四周零提交、发布停滞超过
          自身节奏的两倍。这三条命中就停下来核实，不要试图用分数补偿。
        </li>
      </ul>
      <p>
        数值随你的场景改。判定的原始量在{" "}
        <LocaleLink href="/method" className="underline underline-offset-2">
          判定规则
        </LocaleLink>{" "}
        里逐条列出，也有 JSON 端点可读。
      </p>

      <h2>什么时候该去读代码</h2>
      <p>
        星标和提交数据能回答「它是不是在被用、在不在动」，回答不了「它是不是适合我」。
        下面几种情况已经不是数据能回答的，直接去读 README、源码和 issue：
      </p>
      <ul>
        <li>
          它要解决的问题正好是你不想自己解决的那一类（自托管、数据不出内网、已有
          系统的特定协议兼容）。
        </li>
        <li>
          它的许可证不在这份榜单的标签里：AGPL、SSPL、自定义条款，以及任何非 OSI
          认证的许可证都需要单独过法务。
        </li>
        <li>
          它的活跃度和它的重要性不匹配——一个你要依赖五年的组件，不应该由一个贡献者
          维护，也不应该只由星标决定。
        </li>
        <li>
          最近 12 周的周增量一直是平的（不是涨也不是跌）。平不是问题，「一直没人关心
          也没人放弃」才是。
        </li>
      </ul>

      <h2>这份数据不覆盖什么</h2>
      <ul>
        <li>
          <strong>质量与安全。</strong>榜单不含 CVE 扫描、依赖风险或维护者身份集中度。
        </li>
        <li>
          <strong>私有仓库与闭源项目。</strong>
          公开数据只覆盖 GitHub 上能被匿名采集的仓库。
        </li>
        <li>
          <strong>你的上下文。</strong>语言、社区生态、与其他系统的兼容性，都不在采集
          范围内。
        </li>
        <li>
          <strong>未来。</strong>所有读数都是过去若干周的回看，没有预测。
        </li>
      </ul>

      <p>
        要接数据看{" "}
        <LocaleLink href="/docs" className="underline underline-offset-2">
          API 文档
        </LocaleLink>
        ，要问人看{" "}
        <LocaleLink href="/contact" className="underline underline-offset-2">
          联系我们
        </LocaleLink>
        。
      </p>
    </LongFormPage>
  )
}
