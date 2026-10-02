/**
 * The console's outbound mail.
 *
 * The same provider shape `apps/web` builds, against this app's message
 * catalogue: `createTemplateRenderer` binds message loading, which is an app
 * decision, and only the transport is shared.
 *
 * Built lazily from env, so a build without mail credentials succeeds and the
 * first send is where a missing key surfaces. That distinction matters more
 * here than in `web`: this module is imported by the email-verification path,
 * and a provider that threw at import time would take the auth route down with
 * it rather than just failing to send.
 */
import {
  createMailProvider,
  createTemplateRenderer,
  sendEmail as sendWithProvider,
  smtpConfigFromEnv,
  type MailOptions,
  type SendRawEmailParams,
  type SendTemplateParams,
} from "@workspace/mail"

import { getMessagesForLocale } from "@/i18n/messages"
import { LOCALE_COOKIE_NAME, LOCALES, routing } from "@/i18n/routing"
import type { Locale } from "@/lib/config/i18n"

const DEFAULT_FROM = "OpenMCP <service@openmcp.cn>"

/**
 * True when a real transport is configured, i.e. mail can actually leave.
 *
 * `smtpConfigFromEnv` falls back to MailHog on `localhost:1025` when there are
 * no credentials, so "an SMTP config exists" would always be true and would
 * report a development mailbox as a working mail service. Credentials are the
 * honest test.
 */
export function isMailConfigured(): boolean {
  if ((process.env.MAIL_PROVIDER ?? "nodemailer") === "resend") {
    return Boolean(process.env.RESEND_API_KEY)
  }
  return Boolean(process.env.SMTP_USER && process.env.SMTP_PASS)
}

export function mailFromAddress(): string {
  // `SMTP_FROM` is what the console's own env file carries; `MAIL_FROM` is the
  // repo-wide name `apps/web` documents. Accept both so a filled-in local file
  // does not silently fall back to the service address as the sender.
  return process.env.MAIL_FROM ?? process.env.SMTP_FROM ?? DEFAULT_FROM
}

/**
 * Which language a server-triggered email is written in.
 *
 * `next-intl` remembers the reader's choice in a cookie, which is the only
 * signal available when a mail is sent from a request that rendered no page.
 * An absent or unrecognised cookie falls back to the default locale, the same
 * fallback `getMessagesForLocale` applies.
 */
export function mailLocaleFrom(request?: Request): string {
  const cookie = request?.headers.get("cookie") ?? ""
  const name = LOCALE_COOKIE_NAME
  const match = new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(cookie)
  const value = match?.[1]
  return LOCALES.includes(value as (typeof LOCALES)[number])
    ? (value as string)
    : routing.defaultLocale
}

const renderTemplate = createTemplateRenderer({
  defaultLocale: routing.defaultLocale as Locale,
  resolveMessages: async (locale) =>
    (await getMessagesForLocale(locale as Locale)) as never,
})

let cachedOptions: MailOptions | null = null

const buildOptions = (): MailOptions => {
  const from = mailFromAddress()

  if ((process.env.MAIL_PROVIDER ?? "nodemailer") === "resend") {
    return {
      provider: "resend",
      from,
      resend: { apiKey: process.env.RESEND_API_KEY ?? "" },
      renderTemplate,
    }
  }

  return { provider: "nodemailer", from, smtp: smtpConfigFromEnv(), renderTemplate }
}

export const getMailProvider = () => {
  cachedOptions ??= buildOptions()
  return createMailProvider(cachedOptions)
}

/** Sends a named template or raw content. Resolves false when delivery failed. */
export async function sendEmail(
  params: SendTemplateParams | SendRawEmailParams
): Promise<boolean> {
  return sendWithProvider(getMailProvider(), params)
}
