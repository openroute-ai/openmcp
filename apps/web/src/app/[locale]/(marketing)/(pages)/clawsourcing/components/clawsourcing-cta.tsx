import { Button } from '@workspace/ui/components/button'
import { ArrowRight, Send } from 'lucide-react'
import Link from 'next/link'
import { WeChatQRDialog } from '@/components/contact/wechat-qr-dialog'

export function ClawsourcingCta() {
  return (
    <section id='cta' className='px-6 py-section'>
      <div className='mx-auto max-w-4xl'>
        <div className='rounded-2xl border border-primary/30 bg-primary/5 px-8 py-16 text-center'>
          <Send className='mx-auto mb-6 h-12 w-12 text-primary' />
          <h2 className='mb-4 text-balance font-bold text-3xl text-foreground md:text-4xl'>
            {'准备好拥有你的 AI 员工了吗？'}
          </h2>
          <p className='mx-auto mb-8 max-w-2xl text-pretty text-lead text-muted-foreground'>
            {'预约 30 分钟免费咨询，我们将深入了解你的需求并提供定制方案建议。'}
          </p>
          <div className='flex flex-col items-center justify-center gap-4 sm:flex-row'>
            {/* <a
              href="mailto:hello@masinov.com"
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-8 py-3.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
            >
              {'预约免费咨询'}
              <ArrowRight className="h-4 w-4" />
            </a> */}
            <WeChatQRDialog
              qrCodeUrl='/images/pm.jpg'
              wechatId='qijianbin001'
              buttonText='预约免费咨询'
              buttonVariant='default'
              showIcon={true}
            />
            <Button variant='outline' asChild>
              <Link href='/personas'>
                {'浏览 Personas'}
                <ArrowRight className='h-4 w-4' />
              </Link>
            </Button>
          </div>
          <p className='mt-6 text-muted-foreground text-xs'>
            {'OpenMCP. Bridging AI capability and real-world application.'}
          </p>
        </div>
      </div>
    </section>
  )
}
