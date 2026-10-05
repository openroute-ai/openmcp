/**
 * The FAQ copy, in one place because it now has two homes.
 *
 * The landing page's `#faq` section and the standalone `/faq` page are the same
 * list, so the answers live here rather than inside the landing component: a
 * second copy of an answer about pricing or data sources is a second thing to
 * forget when one of them changes, and the reader has no way to tell which of the
 * two is the current one.
 *
 * Every answer is a claim about what this product actually does. Each one is
 * checkable against the code: the numbers are recorded stargazer arrivals, the
 * colour convention is `--radar-up`/`--radar-down`, and the JSON endpoints named
 * here are the ones `/api/rankings` serves. Nothing here promises a score,
 * because there is no score to promise.
 */

export interface FaqEntry {
  question: string
  answer: string
}

export const FAQS: FaqEntry[] = [
  {
    question: "数据从哪里来？",
    answer:
      "覆盖 GitHub、GitLab、Gitee、npm、PyPI、Maven，以及 OSV / NVD 漏洞库，每日更新。每条结论都附采集时间和可点开的证据，避免“一条结论全靠 AI 猜”。",
  },
  {
    question: "为什么不给一个综合评分？",
    answer:
      "我们试过，放弃了。star 多的项目在任何维度上都不会差，于是高分只是在复述「它已经很受欢迎」——把你的问题原样还给你。现在改为逐项原始量（周增量、增速加速度、发布间隔、贡献者活跃度、许可证状态），每项独立可查，判断权交给你。",
  },
  {
    question: "结论怎么复现？",
    answer:
      "雷达记录的是每个 stargazer 的到达时间，不是 star 总数。任取一周的增量都可以从时间戳重新算一遍；贡献者名单与时间序列同样公开，Bus Factor 你可以自己数。",
  },
  {
    question: "涨跌用什么颜色？",
    answer:
      "绿涨红跌，和全球 web 一致：绿色是「在加速」，红色是「在衰退或已经预警」，红色在这里只表示这一件事。刻意不用「红涨绿跌」那套中文股市直觉——在那套约定里红色是好事，而这里的红色是警告，每次读榜都要在脑子里翻转一次才安全。至于风险等级，除了颜色还一律带图标和标签文字，不靠颜色单独承担信息。",
  },
  {
    question: "和 SCA 工具（Snyk / Sonatype）有什么区别？",
    answer:
      "SCA 工具在代码层面跑，扫描你已经引入的依赖。雷达面向“引入前”和“引入后仍在维护”的环节：一个项目在你上生产之前就已经在衰退，或者维护者已经散伙——这些信号在 SCA 里看不到，因为代码还在正常跑。",
  },
  {
    question: "榜单为什么只列前 12 个？",
    answer:
      "公开榜单每期只公布 12 个，把「前 12」当成一条能读的结论，而不是把全量数据铺开让人自己找。想取全量数据用 /api/rankings/week.json 和 /api/rankings/month.json，两者的排序与页面上看到的一致。",
  },
  {
    question: "支持私有化部署吗？",
    answer:
      "企业版支持私有化部署与内部代码库集成，包含 SSO 和审计日志，报价与部署方式可以直接联系团队。",
  },
]
