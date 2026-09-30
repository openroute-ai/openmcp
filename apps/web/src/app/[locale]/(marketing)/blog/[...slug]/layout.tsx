import type { PropsWithChildren } from 'react'
import Container from '@/components/layout/container'

export default async function BlogPostLayout({ children }: PropsWithChildren) {
  return (
    <Container className='py-10'>
      <div className='mx-auto max-w-wide'>{children}</div>
    </Container>
  )
}
