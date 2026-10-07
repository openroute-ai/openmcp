import { ArrowDown, Bot, Sparkles } from 'lucide-react'

export function ClawsourcingHero() {
  return (
    <section className='relative overflow-hidden border-border border-b px-6 py-24 md:py-36'>
      <div className='absolute inset-0 bg-[radial-gradient(ellipse_at_top,var(--color-glow),transparent_70%)] dark:bg-[radial-gradient(ellipse_at_top,var(--color-glow-dark),transparent_70%)]' />

      <div className='relative mx-auto max-w-4xl text-center'>
        <div className='mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-secondary px-4 py-1.5'>
          <Bot className='h-4 w-4 text-primary' />
          <span className='font-medium text-muted-foreground text-xs'>Fully Managed AI Employees</span>
        </div>

        <h1 className='mb-6 text-balance font-bold text-4xl text-foreground leading-tight tracking-tight md:text-6xl'>
          {'Clawsourcing'}
          <br />
          <span className='text-primary'>{'定制 AI 员工服务'}</span>
        </h1>

        <p className='mx-auto mb-6 max-w-2xl text-pretty text-xl text-muted-foreground'>
          {
            '不同于简单的 AI 配置，Clawsourcing 提供全托管的 AI 员工定制服务。从零构建完整的 AI 系统，每月主动优化性能，共享跨客户学习成果。'
          }
        </p>

        <div className='mx-auto mb-10 flex flex-wrap items-center justify-center gap-6'>
          {[
            { label: '端到端定制', icon: <Sparkles className='h-4 w-4' /> },
            { label: '持续优化', icon: <Sparkles className='h-4 w-4' /> },
            { label: '零锁定', icon: <Sparkles className='h-4 w-4' /> },
          ].map((item) => (
            <div key={item.label} className='flex items-center gap-2 text-muted-foreground text-sm'>
              <span className='text-primary'>{item.icon}</span>
              {item.label}
            </div>
          ))}
        </div>

        <div className='flex flex-col items-center justify-center gap-4 sm:flex-row'>
          <a
            href='#pricing'
            className='inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-3 font-semibold text-primary-foreground text-sm transition-colors hover:bg-primary/90'
          >
            {'查看定价方案'}
            <ArrowDown className='h-4 w-4' />
          </a>
          <a
            href='#roles'
            className='inline-flex items-center gap-2 rounded-lg border border-border bg-secondary px-6 py-3 font-semibold text-secondary-foreground text-sm transition-colors hover:bg-accent'
          >
            {'浏览 AI 角色'}
          </a>
        </div>
      </div>
    </section>
  )
}
