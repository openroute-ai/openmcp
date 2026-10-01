import { Text } from '@react-email/components'
import EmailButton from '../components/email-button'
import EmailLayout from '../components/email-layout'
import type { BaseEmailProps } from '../types'
import { createMailTranslator } from '../translator'

interface OrganizationInvitationProps extends BaseEmailProps {
  /** Address the invitation was sent to, shown in the sign-in helper line. */
  email: string
  /** Display name of whoever sent the invitation. */
  inviterName: string
  /** Organization the invitee is being asked to join. */
  organizationName: string
  /**
   * Acceptance link. Points at this app's own callback route rather than
   * Better Auth's verify endpoint, so the accept flow can sign the invitee in.
   */
  inviteLink: string
}

export function OrganizationInvitation({
  email,
  inviterName,
  organizationName,
  inviteLink,
  locale,
  messages,
}: OrganizationInvitationProps) {
  const t = createMailTranslator(locale, messages, 'Mail.organizationInvitation')

  return (
    <EmailLayout locale={locale} messages={messages}>
      <Text>{t('title', { inviterName, organizationName })}</Text>
      <Text>{t('body', { email })}</Text>
      <EmailButton href={inviteLink}>{t('accept')}</EmailButton>
    </EmailLayout>
  )
}

export default OrganizationInvitation
