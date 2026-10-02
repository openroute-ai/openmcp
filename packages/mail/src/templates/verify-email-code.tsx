import { Text } from '@react-email/components'
import EmailLayout from '../components/email-layout'
import type { BaseEmailProps } from '../types'
import { createMailTranslator } from '../translator'

interface VerifyEmailCodeProps extends BaseEmailProps {
  code: string
  name: string
  expiresInMinutes: number
}

/**
 * The numeric code, rather than the link `VerifyEmail` sends.
 *
 * Both exist on purpose. A link is the better default — it proves the address
 * with one click and cannot be mistyped — but a code is what a reader can enter
 * on the device they are already holding, which is the whole point when the
 * account was created on a phone. Where the flow accepts both, the code is
 * rendered as the primary action and the link is not repeated: two ways to do
 * one thing in one email is a support ticket waiting to happen.
 */
export function VerifyEmailCode({
  code,
  name,
  expiresInMinutes,
  locale,
  messages,
}: VerifyEmailCodeProps) {
  const t = createMailTranslator(locale, messages, 'Mail.verifyEmailCode')

  return (
    <EmailLayout locale={locale} messages={messages}>
      <Text>{t('title', { name })}</Text>
      <Text>{t('body')}</Text>
      <Text
        style={{
          fontSize: '32px',
          fontWeight: 700,
          letterSpacing: '8px',
          margin: '24px 0',
        }}
      >
        {code}
      </Text>
      <Text>{t('expiresIn', { minutes: expiresInMinutes })}</Text>
    </EmailLayout>
  )
}

export default VerifyEmailCode
