import type { ReactNode } from 'react'
import { Footer } from '@/components/layout/footer'
import { Navbar } from '@/components/layout/navbar'

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className='flex min-h-screen flex-col'>
      <Navbar scroll={true} />
      <main className='flex-1'>{children}</main>
      <Footer />
    </div>
  )
}
