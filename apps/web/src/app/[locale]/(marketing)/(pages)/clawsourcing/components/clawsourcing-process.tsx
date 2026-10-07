import { MessageSquare, RefreshCw, Rocket, Wrench } from 'lucide-react'

const steps = [
  {
    step: '01',
    icon: <MessageSquare className='h-5 w-5' />,
    title: '需求对接',
    description: '深入了解你的业务流程和痛点，明确 AI 员工的职责边界和预期产出。',
  },
  {
    step: '02',
    icon: <Wrench className='h-5 w-5' />,
    title: '定制开发',
    description: '基于 OpenClaw 框架构建专属系统，包含记忆系统、决策框架和工具集成。',
  },
  {
    step: '03',
    icon: <Rocket className='h-5 w-5' />,
    title: '部署上线',
    description: '独立基础设施部署，完成全面测试后正式上线，确保平稳运行。',
  },
  {
    step: '04',
    icon: <RefreshCw className='h-5 w-5' />,
    title: '持续优化',
    description: '每月主动改进 AI 性能，共享跨客户学习成果，确保持续进化。',
  },
]

export function ClawsourcingProcess() {
  return (
    <section className='border-border border-b bg-card px-6 py-18'>
      <div className='mx-auto max-w-7xl'>
        <div className='mb-12 text-center'>
          <h2 className='mb-4 text-balance font-bold text-3xl text-foreground md:text-4xl'>{'服务流程'}</h2>
          <p className='mx-auto max-w-2xl text-pretty text-xl text-muted-foreground'>
            {'从需求到上线，4 个阶段完成你的 AI 员工部署。'}
          </p>
        </div>

        <div className='grid gap-6 sm:grid-cols-2 lg:grid-cols-4'>
          {steps.map((s) => (
            <div key={s.step} className='relative flex flex-col rounded-xl border border-border bg-background p-6'>
              <div className='mb-4 flex items-center gap-3'>
                <span className='flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 font-bold font-mono text-primary text-sm'>
                  {s.step}
                </span>
                <div className='text-primary'>{s.icon}</div>
              </div>
              <h3 className='mb-2 font-semibold text-foreground text-lg'>{s.title}</h3>
              <p className='text-muted-foreground text-sm leading-relaxed'>{s.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
