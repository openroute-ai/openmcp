import { NewsletterFormCard } from '@/components/settings/notification/newsletter-form-card'

export default function NotificationPage() {
  return (
    <div className='flex-1 px-5 py-8 sm:px-6 lg:px-10'>
      <div className='mx-auto w-full max-w-7xl space-y-7'>
        <div className='grid gap-8 md:grid-cols-2'>
          <NewsletterFormCard />
        </div>
      </div>
    </div>
  )
}
