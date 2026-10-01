import type { PropsWithChildren } from 'react'
import Container from '@/components/layout/container'

export default function LegalLayout({ children }: PropsWithChildren) {
  return (
    <Container className="px-4 py-16">
      <div className="mx-auto">{children}</div>
    </Container>
  )
}
