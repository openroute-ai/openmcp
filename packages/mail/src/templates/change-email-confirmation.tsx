import { Text } from '@react-email/components'
import EmailButton from '../components/email-button'
import EmailLayout from '../components/email-layout'
import type { BaseEmailProps } from '../types'
import { createMailTranslator } from '../translator'

interface ChangeEmailConfirmationProps extends BaseEmailProps {
  url: string
  name: string
  newEmail: string
}

/**
 * Confirms a change to the address an account already controls.
 *
 * This is deliberately not the code email. A code proves the *new* address, but
 * the change it authorises is to the *current* one — the address that can reset
 * the password and take the account over — so the confirmation has to land in
 * the old inbox, not the new one. A session lifted by someone else can request
 * the change; it cannot read this link.
 */
export function ChangeEmailConfirmation({
  url,
  name,
  newEmail,
  locale,
  messages,
}: ChangeEmailConfirmationProps) {
  const t = createMailTranslator(locale, messages, 'Mail.changeEmailConfirmation')

  return (
    <EmailLayout locale={locale} messages={messages}>
      <Text>{t('title', { name })}</Text>
      <Text>{t('body', { newEmail })}</Text>
      <EmailButton href={url}>{t('confirmEmail')}</EmailButton>
    </EmailLayout>
  )
}

export default ChangeEmailConfirmation
