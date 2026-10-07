import { Code, Crown, Headphones, PenTool, Puzzle, Settings, TrendingUp } from 'lucide-react'

const roles = [
  {
    name: 'Your Own Felix',
    subtitle: 'AI 首席幕僚',
    description: '你的私人 AI 首席幕僚，掌控日程、邮件、项目进度，主动提供决策建议和行动计划。',
    icon: <Crown className='h-6 w-6' />,
    highlight: true,
  },
  {
    name: 'Content Claw',
    subtitle: '内容营销',
    description: '自动创建、排版和发布多平台内容，维护品牌一致性，追踪内容表现并优化策略。',
    icon: <PenTool className='h-6 w-6' />,
    highlight: false,
  },
  {
    name: 'Support Claw',
    subtitle: '客户支持',
    description: '7x24 智能客服，理解上下文的多轮对话，自动分级工单，复杂问题无缝转接人工。',
    icon: <Headphones className='h-6 w-6' />,
    highlight: false,
  },
  {
    name: 'Sales Claw',
    subtitle: '销售开发代表',
    description: '自动线索筛选和培育，个性化跟进邮件，CRM 数据同步，销售漏斗全程追踪。',
    icon: <TrendingUp className='h-6 w-6' />,
    highlight: false,
  },
  {
    name: 'Dev Claw',
    subtitle: '开发运维',
    description: '代码审查自动化、CI/CD 监控、部署自动化、故障自动响应和诊断，7x24 值守。',
    icon: <Code className='h-6 w-6' />,
    highlight: false,
  },
  {
    name: 'Ops Claw',
    subtitle: '运营管理',
    description: '财务报表自动化、供应链监控、运营数据分析、流程异常预警和自动修复。',
    icon: <Settings className='h-6 w-6' />,
    highlight: false,
  },
  {
    name: 'Custom Claw',
    subtitle: '完全定制',
    description: '根据你的独特业务需求，从零打造专属 AI 员工。无模板限制，一切按需设计。',
    icon: <Puzzle className='h-6 w-6' />,
    highlight: false,
  },
]

export function ClawsourcingRoles() {
  return (
    <section id='roles' className='border-border border-b px-6 py-18'>
      <div className='mx-auto max-w-7xl'>
        <div className='mb-12 text-center'>
          <h2 className='mb-4 text-balance font-bold text-3xl text-foreground md:text-4xl'>{'预置 AI 角色'}</h2>
          <p className='mx-auto max-w-2xl text-pretty text-xl text-muted-foreground'>
            {'基于 OpenClaw 开源框架构建，每个角色都经过生产环境验证，可直接部署或深度定制。'}
          </p>
        </div>

        <div className='grid gap-6 sm:grid-cols-2 lg:grid-cols-3'>
          {roles.map((role) => (
            <div
              key={role.name}
              className={`flex flex-col rounded-xl border p-6 transition-all ${
                role.highlight
                  ? 'border-primary/40 bg-primary/5'
                  : 'border-border bg-card hover:border-primary/30 hover:bg-accent/50'
              }`}
            >
              <div className='mb-4 flex items-center gap-3'>
                <div
                  className={`flex h-12 w-12 items-center justify-center rounded-xl ${
                    role.highlight ? 'bg-primary text-primary-foreground' : 'bg-primary/10 text-primary'
                  }`}
                >
                  {role.icon}
                </div>
                <div>
                  <h3 className='font-semibold text-foreground'>{role.name}</h3>
                  <span className='text-muted-foreground text-xs'>{role.subtitle}</span>
                </div>
              </div>
              <p className='flex-1 text-muted-foreground text-sm leading-relaxed'>{role.description}</p>
              {role.highlight && (
                <div className='mt-4 rounded-lg bg-primary/10 px-3 py-2 text-center font-medium text-primary text-xs'>
                  {'最受欢迎'}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
