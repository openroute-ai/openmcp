import { Text } from '@react-email/components'
import EmailButton from '../components/email-button'
import EmailLayout from '../components/email-layout'
import type { BaseEmailProps } from '../types'
import { createMailTranslator } from '../translator'

interface VerifyEmailProps extends BaseEmailProps {
  url: string
  name: string
}

export function VerifyEmail({ url, name, locale, messages }: VerifyEmailProps) {
  const t = createMailTranslator(locale, messages, 'Mail.verifyEmail')

  return (
    <EmailLayout locale={locale} messages={messages}>
      <Text>{t('title', { name })}</Text>
      <Text>{t('body')}</Text>
      <EmailButton href={url}>{t('confirmEmail')}</EmailButton>
    </EmailLayout>
  )
}

export default VerifyEmail
