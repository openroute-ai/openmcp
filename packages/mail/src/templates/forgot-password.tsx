import { Text } from '@react-email/components'
import EmailButton from '../components/email-button'
import EmailLayout from '../components/email-layout'
import type { BaseEmailProps } from '../types'
import { createMailTranslator } from '../translator'

interface ForgotPasswordProps extends BaseEmailProps {
  url: string
  name: string
}

export function ForgotPassword({ url, name, locale, messages }: ForgotPasswordProps) {
  const t = createMailTranslator(locale, messages, 'Mail.forgotPassword')

  return (
    <EmailLayout locale={locale} messages={messages}>
      <Text>{t('title', { name })}</Text>
      <Text>{t('body')}</Text>
      <EmailButton href={url}>{t('resetPassword')}</EmailButton>
    </EmailLayout>
  )
}

export default ForgotPassword
