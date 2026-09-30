import { ArrowRight, Check, Zap } from 'lucide-react'

const features = [
  '基于 OpenClaw 框架端到端定制',
  '独立服务器基础设施',
  '记忆系统 + 决策框架',
  '多工具集成 (飞书、Slack、GitHub 等)',
  '每月主动性能优化',
  '跨客户学习成果共享',
  '24/7 监控与告警',
  '端到端加密与自动化备份',
  '零锁定 - 随时可带走所有配置和数据',
]

export function ClawsourcingPricing() {
  return (
    <section id='pricing' className='border-border border-b px-6 py-section'>
      <div className='mx-auto max-w-7xl'>
        <div className='mb-12 text-center'>
          <h2 className='mb-4 text-balance font-bold text-3xl text-foreground md:text-4xl'>{'透明定价'}</h2>
          <p className='mx-auto max-w-2xl text-pretty text-lead text-muted-foreground'>
            {'简单直接的定价方案，无隐藏费用。零锁定承诺，随时可退。'}
          </p>
        </div>

        <div className='mx-auto grid max-w-5xl gap-8 lg:grid-cols-2'>
          {/* Setup Fee */}
          <div className='flex flex-col rounded-xl border border-border bg-card p-8'>
            <div className='mb-6'>
              <span className='font-medium text-muted-foreground text-sm'>{'一次性设置费'}</span>
              <div className='mt-2 flex items-baseline gap-1'>
                <span className='font-bold text-5xl text-foreground tracking-tight'>￥2,000</span>
              </div>
              <p className='mt-3 text-muted-foreground text-sm leading-relaxed'>
                {'包含需求分析、系统定制开发、测试和部署全流程。'}
              </p>
            </div>
            <ul className='flex flex-1 flex-col gap-3'>
              {features.slice(0, 4).map((f) => (
                <li key={f} className='flex items-start gap-3'>
                  <Check className='mt-0.5 h-4 w-4 shrink-0 text-primary' />
                  <span className='text-muted-foreground text-sm'>{f}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Monthly Fee */}
          <div className='flex flex-col rounded-xl border border-primary/40 bg-primary/5 p-8'>
            <div className='mb-2 inline-flex w-fit items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 font-medium text-primary text-xs'>
              <Zap className='h-3 w-3' />
              {'推荐方案'}
            </div>
            <div className='mb-6'>
              <span className='font-medium text-muted-foreground text-sm'>{'月度维护费'}</span>
              <div className='mt-2 flex items-baseline gap-1'>
                <span className='font-bold text-5xl text-foreground tracking-tight'>￥500</span>
                <span className='text-lg text-muted-foreground'>/月</span>
              </div>
              <p className='mt-3 text-muted-foreground text-sm leading-relaxed'>
                {'持续运维、性能优化和跨客户学习。确保 AI 员工持续进化。'}
              </p>
            </div>
            <ul className='flex flex-1 flex-col gap-3'>
              {features.slice(4).map((f) => (
                <li key={f} className='flex items-start gap-3'>
                  <Check className='mt-0.5 h-4 w-4 shrink-0 text-primary' />
                  <span className='text-muted-foreground text-sm'>{f}</span>
                </li>
              ))}
            </ul>
            <a
              href='#cta'
              className='mt-8 inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-6 py-3 font-semibold text-primary-foreground text-sm transition-colors hover:bg-primary/90'
            >
              {'开始定制'}
              <ArrowRight className='h-4 w-4' />
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}
