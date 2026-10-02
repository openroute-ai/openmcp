import { Heading, Link, Text } from '@react-email/components'
import EmailButton from '../components/email-button'
import EmailLayout from '../components/email-layout'
import type { BaseEmailProps } from '../types'
import { createMailTranslator } from '../translator'

interface SubscribeNewsletterProps extends BaseEmailProps {
  /**
   * Where the confirmation button points, when the signup offered something to
   * look at. Optional because the same template serves a bare "you're on the
   * list" confirmation; a caller with a resource to hand over passes it, and the
   * button only appears then.
   */
  url?: string
  /**
   * A signed opt-out link, when the host can mint one. Optional for the same
   * reason `url` is: `apps/web` signs its links provider-side, so it sends this
   * template with neither field and the footer stays as it was.
   */
  unsubscribeUrl?: string
}

export function SubscribeNewsletter({
  url,
  unsubscribeUrl,
  locale,
  messages,
}: SubscribeNewsletterProps) {
  const t = createMailTranslator(locale, messages, 'Mail.subscribeNewsletter')

  return (
    <EmailLayout locale={locale} messages={messages}>
      <Heading className='text-xl'>{t('subject')}</Heading>
      <Text>{t('body')}</Text>
      {url ? <EmailButton href={url}>{t('button')}</EmailButton> : null}
      {unsubscribeUrl ? (
        <Text className='text-sm text-muted-foreground'>
          <Link href={unsubscribeUrl} className='text-muted-foreground underline'>
            {t('unsubscribe')}
          </Link>
        </Text>
      ) : null}
    </EmailLayout>
  )
}

export default SubscribeNewsletter
