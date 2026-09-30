import { Database, Eye, Key, Lock, Server, Shield } from 'lucide-react'

const securityFeatures = [
  {
    icon: <Server className='h-5 w-5' />,
    title: '独立基础设施',
    description: '每个客户独立服务器，完全物理隔离，杜绝数据交叉风险。',
  },
  {
    icon: <Lock className='h-5 w-5' />,
    title: '端到端加密',
    description: '数据传输和存储全程加密，AES-256 标准，密钥由客户独立管理。',
  },
  {
    icon: <Database className='h-5 w-5' />,
    title: '自动化备份',
    description: '实时增量备份 + 每日全量快照，支持任意时间点恢复。',
  },
  {
    icon: <Key className='h-5 w-5' />,
    title: '最小权限访问',
    description: '严格的 RBAC 权限控制，API 密钥定期轮换，操作全程审计。',
  },
  {
    icon: <Eye className='h-5 w-5' />,
    title: '24/7 监控',
    description: '全天候安全监控和告警，异常行为实时检测和自动响应。',
  },
  {
    icon: <Shield className='h-5 w-5' />,
    title: '零锁定承诺',
    description: '随时可导出所有配置、数据和训练成果，无任何退出壁垒。',
  },
]

export function ClawsourcingSecurity() {
  return (
    <section className='border-border border-b bg-card px-6 py-section'>
      <div className='mx-auto max-w-7xl'>
        <div className='mb-12 text-center'>
          <div className='mb-4 inline-flex items-center gap-2 rounded-full border border-border bg-secondary px-4 py-1.5'>
            <Shield className='h-4 w-4 text-primary' />
            <span className='font-medium text-muted-foreground text-xs'>Enterprise Security</span>
          </div>
          <h2 className='mb-4 text-balance font-bold text-3xl text-foreground md:text-4xl'>{'企业级安全保障'}</h2>
          <p className='mx-auto max-w-2xl text-pretty text-lead text-muted-foreground'>
            {'数据安全是我们的首要承诺。每一层架构都为安全而设计。'}
          </p>
        </div>

        <div className='grid gap-6 sm:grid-cols-2 lg:grid-cols-3'>
          {securityFeatures.map((feature) => (
            <div key={feature.title} className='flex gap-4 rounded-xl border border-border bg-background p-6'>
              <div className='flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary'>
                {feature.icon}
              </div>
              <div>
                <h3 className='mb-1 font-semibold text-foreground'>{feature.title}</h3>
                <p className='text-muted-foreground text-sm leading-relaxed'>{feature.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
