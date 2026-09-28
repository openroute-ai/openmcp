import { Text } from '@react-email/components'
import EmailLayout from '../components/email-layout'
import type { BaseEmailProps } from '../types'
import { createMailTranslator } from '../translator'

interface ContactMessageProps extends BaseEmailProps {
  name: string
  email: string
  message: string
}

export function ContactMessage({ name, email, message, locale, messages }: ContactMessageProps) {
  const t = createMailTranslator(locale, messages, 'Mail.contactMessage')

  return (
    <EmailLayout locale={locale} messages={messages}>
      <Text>{t('name', { name })}</Text>
      <Text>{t('email', { email })}</Text>
      <Text>{t('message', { message })}</Text>
    </EmailLayout>
  )
}

export default ContactMessage
