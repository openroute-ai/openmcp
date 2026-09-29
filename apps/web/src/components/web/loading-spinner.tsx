import { cn } from '@/lib/utils'

interface LoadingSpinnerProps {
  className?: string
}

export default function LoadingSpinner({ className }: LoadingSpinnerProps) {
  return (
    <div className={cn('z-10 flex h-full w-full items-center justify-center', className)}>
      <div className='inline-block h-8 w-8 animate-spin rounded-full border-4 border-primary border-r-transparent border-solid align-[-0.125em] motion-reduce:animate-[spin_1.5s_linear_infinite]'>
        <span className='!absolute !-m-px !h-px !w-px !overflow-hidden !whitespace-nowrap !border-0 !p-0 ![clip:rect(0,0,0,0)]'>
          Loading...
        </span>
      </div>
    </div>
  )
}
