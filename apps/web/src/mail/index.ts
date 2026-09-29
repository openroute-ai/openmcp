import {
  createMailProvider,
  createTemplateRenderer,
  sendEmail as sendWithProvider,
  smtpConfigFromEnv,
  type EmailTemplate,
  type MailOptions,
  type SendRawEmailParams,
  type SendTemplateParams,
} from "@workspace/mail"
import { getMessagesForLocale } from "@/i18n/messages"
import { routing, type Locale } from "@/i18n/routing"
import { websiteConfig } from "@/lib/config/website"

/**
 * Renders templates with this app's message catalogue.
 *
 * Message loading and the default locale are app decisions, so they are bound
 * here rather than assumed by the package.
 */
const renderTemplate = createTemplateRenderer({
  defaultLocale: routing.defaultLocale as Locale,
  resolveMessages: async (locale) =>
    (await getMessagesForLocale(locale as Locale)) as never,
})

/**
 * Builds the transport from env. Called lazily so a missing API key or SMTP
 * setting only fails when mail is actually sent, not during a build.
 */
const buildOptions = (): MailOptions => {
  if (websiteConfig.mail.provider === "resend") {
    return {
      provider: "resend",
      from: websiteConfig.mail.fromEmail,
      resend: { apiKey: process.env.RESEND_API_KEY ?? "" },
      renderTemplate,
    }
  }

  return {
    provider: "nodemailer",
    from: websiteConfig.mail.fromEmail,
    smtp: smtpConfigFromEnv(),
    renderTemplate,
  }
}

let cachedOptions: MailOptions | null = null

export const getMailProvider = () => {
  cachedOptions ??= buildOptions()
  return createMailProvider(cachedOptions)
}

/**
 * Sends an email, either a named template or raw content.
 */
export async function sendEmail(
  params: SendTemplateParams | SendRawEmailParams
): Promise<boolean> {
  return sendWithProvider(getMailProvider(), params)
}

/**
 * Renders a template without sending, for preview endpoints.
 */
export async function getTemplate<T extends EmailTemplate>({
  template,
  context,
  locale = routing.defaultLocale,
}: {
  template: T
  context: Record<string, unknown>
  locale?: Locale
}) {
  return renderTemplate({ template, context, locale })
}
