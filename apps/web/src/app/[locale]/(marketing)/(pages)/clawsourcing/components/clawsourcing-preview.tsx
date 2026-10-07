import { ArrowRight, Bot, Crown, Headphones, PenTool, RefreshCw, Shield, TrendingUp } from 'lucide-react'
import Link from 'next/link'

const highlights = [
  {
    icon: <Crown className='h-4 w-4' />,
    label: 'Felix',
    desc: 'AI 首席幕僚',
  },
  {
    icon: <PenTool className='h-4 w-4' />,
    label: 'Content Claw',
    desc: '内容营销',
  },
  {
    icon: <Headphones className='h-4 w-4' />,
    label: 'Support Claw',
    desc: '客户支持',
  },
  {
    icon: <TrendingUp className='h-4 w-4' />,
    label: 'Sales Claw',
    desc: '销售代表',
  },
]

const features = [
  {
    icon: <Bot className='h-5 w-5' />,
    title: '端到端定制',
    desc: '根据具体工作流程，从零构建完整的 AI 系统',
  },
  {
    icon: <RefreshCw className='h-5 w-5' />,
    title: '持续优化',
    desc: '每月主动改进 AI 性能，共享跨客户学习成果',
  },
  {
    icon: <Shield className='h-5 w-5' />,
    title: '企业安全',
    desc: '独立基础设施、端到端加密、24/7 监控',
  },
]

export function ClawsourcingPreview() {
  return (
    <section className='border-border border-b px-6 py-18'>
      <div className='mx-auto max-w-7xl'>
        <div className='grid gap-12 lg:grid-cols-2 lg:items-center'>
          {/* Left: Content */}
          <div>
            <div className='mb-4 inline-flex items-center gap-2 rounded-full border border-border bg-secondary px-4 py-1.5'>
              <Bot className='h-4 w-4 text-primary' />
              <span className='font-medium text-muted-foreground text-xs'>Clawsourcing</span>
            </div>

            <h2 className='mb-4 text-balance font-bold text-3xl text-foreground md:text-4xl'>
              {'需要更深度的定制？'}
              <br />
              <span className='text-primary'>{'试试 AI 员工托管服务'}</span>
            </h2>

            <p className='mb-8 max-w-lg text-pretty text-lead text-muted-foreground'>
              {'Clawsourcing 提供全托管的 AI 员工定制服务，不同于简单的配置包，我们为你的业务量身打造、持续优化。'}
            </p>

            <div className='mb-8 flex flex-col gap-4'>
              {features.map((f) => (
                <div key={f.title} className='flex items-start gap-3'>
                  <div className='flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary'>
                    {f.icon}
                  </div>
                  <div>
                    <h3 className='font-semibold text-foreground'>{f.title}</h3>
                    <p className='text-muted-foreground text-sm'>{f.desc}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className='flex flex-col gap-3 sm:flex-row'>
              <Link
                href='/clawsourcing'
                className='inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-6 py-3 font-semibold text-primary-foreground text-sm transition-colors hover:bg-primary/90'
              >
                {'了解 Clawsourcing'}
                <ArrowRight className='h-4 w-4' />
              </Link>
              <div className='flex items-center gap-2 px-2 text-muted-foreground text-sm'>
                <span className='font-semibold text-foreground'>$2,000</span>
                {'设置 +'}
                <span className='font-semibold text-foreground'>$500</span>
                {'/月'}
              </div>
            </div>
          </div>

          {/* Right: Role cards preview */}
          <div className='grid grid-cols-2 gap-4'>
            {highlights.map((role) => (
              <div
                key={role.label}
                className='flex flex-col items-center gap-2 rounded-xl border border-border bg-card p-6 text-center transition-all hover:border-primary/30'
              >
                <div className='flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary'>
                  {role.icon}
                </div>
                <h4 className='font-semibold text-foreground text-sm'>{role.label}</h4>
                <p className='text-muted-foreground text-xs'>{role.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
