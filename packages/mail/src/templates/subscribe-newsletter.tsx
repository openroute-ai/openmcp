import { Heading, Text } from '@react-email/components'
import EmailLayout from '../components/email-layout'
import type { BaseEmailProps } from '../types'
import { createMailTranslator } from '../translator'

interface SubscribeNewsletterProps extends BaseEmailProps {}

export function SubscribeNewsletter({ locale, messages }: SubscribeNewsletterProps) {
  const t = createMailTranslator(locale, messages, 'Mail.subscribeNewsletter')

  return (
    <EmailLayout locale={locale} messages={messages}>
      <Heading className='text-xl'>{t('subject')}</Heading>
      <Text>{t('body')}</Text>
    </EmailLayout>
  )
}

export default SubscribeNewsletter
