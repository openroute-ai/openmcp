import type { Metadata } from "next"

import { siteTitle, siteUrl } from "@/lib/config/site"
import { LongFormPage } from "@/components/public/long-form-page"
import { LocaleLink } from "@/i18n/navigation"

/**
 * 关于我们 —— 说清楚做什么、不做什么，以及我们凭什么这么排。
 *
 * 一页：这是什么、几条原则、不做什么、数据怎么来的。写成一个人在做的东西，
 * 而不是公司的对外口径——这个站点只有一个人维护，那种腔调撑不住三行。
 */

export const metadata: Metadata = {
  title: siteTitle("关于我们"),
  description: "我在做什么，以及刻意不做的三件事。",
  alternates: { canonical: "/about" },
  openGraph: {
    type: "website",
    title: siteTitle("关于我们"),
    description: "这是什么，不做什么。",
    url: siteUrl("/about"),
  },
}

export default function AboutPage() {
  return (
    <LongFormPage
      title="关于我们"
      description="我在做什么，不做什么。"
    >
      <h2>这是什么</h2>
      <p>
        我每周采集 GitHub 上与 MCP 相关的开源仓库，记录星标、提交、发布和许可证的时间轴，
        然后做三件事：把增量排出榜、把涨幅排在另一个榜、把刚变了的仓库按需要多快处理排序。
      </p>
      <p>
        输出是四个公开 JSON 端点和这批页面，不需要登录。没有评分卡，也没有每周精选邮件。
      </p>

      <h2>几条原则</h2>
      <ul>
        <li>
          <strong>原始量优于分数。</strong>
          「38k 星 +52 / 周」是一个可以被复核的事实，「8.6 分」不是。所以每条异动都带
          触发时的阈值和证据序列，判定逻辑在{" "}
          <LocaleLink href="/method" className="underline underline-offset-2">
            判定规则
          </LocaleLink>{" "}
          页上逐条公开。
        </li>
        <li>
          <strong>百分比必须带分母。</strong>
          4 涨到 8 是 +100%。所以飙升榜要求上周至少 200 星、本周至少 +50 星，并把
          分母和百分比印在同一行上。
        </li>
        <li>
          <strong>空结果也是结果。</strong>
          本周没有异动不是系统坏了，是我们没有编一条出来填版面。
        </li>
        <li>
          <strong>方向要跟着数字走。</strong>{" "}
          <a
            href="https://www.w3.org/TR/WCAG20/"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2"
          >
            WCAG 2.1
          </a>{" "}
          要求颜色不是传达信息的唯一手段，所以涨跌除了颜色还带箭头，方向性旗标除了颜色
          还写中文。
        </li>
      </ul>

      <h2>不做什么</h2>
      <ul>
        <li>
          <strong>不打综合分。</strong>
          加权和衡量的是规模而不是质量，高分只是复述「它已经很受欢迎」。给一个 8.6 分
          会让读者以为有人替他做了判断。
        </li>
        <li>
          <strong>不做付费排名。</strong>
          付费榜唯一的作用是把钱和名次联系起来。四个月没有任何收入的情况下，这个取舍
          没有变过。
        </li>
        <li>
          <strong>不写「精选推荐」。</strong>不做这份榜单的理由见{" "}
          <LocaleLink href="/guide" className="underline underline-offset-2">
            选型指南
          </LocaleLink>
          ：推荐需要我们对许可证合规和长期维护能力表态，公开数据支撑不了那种表态。
        </li>
      </ul>

      <h2>数据是怎么来的</h2>
      <p>
        采集只走公开接口，不需要 token，不读私有仓库。星标与元数据每周一个快照；提交和
        发布数按周聚合，所以周与周之间的比较精度是一周。采不到的读数显示「未测」，不按 0
        计入。
      </p>
      <p>
        发现某条数据明显不对，{" "}
        <LocaleLink href="/contact" className="underline underline-offset-2">
          联系我们
        </LocaleLink>
        {" "}
        有人读。
      </p>
    </LongFormPage>
  )
}
