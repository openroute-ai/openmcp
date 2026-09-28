import type { ReactElement } from 'react'
import { ContactMessage } from './templates/contact-message'
import { ForgotPassword } from './templates/forgot-password'
import { LiteLLMBudgetUpdateFailed } from './templates/litellm-budget-update-failed'
import { SubscribeNewsletter } from './templates/subscribe-newsletter'
import { SyncErrorNotification } from './templates/sync-error-notification'
import { VerifyEmail } from './templates/verify-email'
import { WechatBudgetUpdateFailed } from './templates/wechat-budget-update-failed'
import { WechatWebhookFailed } from './templates/wechat-webhook-failed'

/**
 * Mail package types.
 *
 * Messages are typed as a plain record rather than next-intl's `Messages`, so
 * this package stays framework-agnostic. The host app passes its own message
 * catalogue; translation happens through `use-intl/core`, which is a plain
 * runtime with no React or Next.js coupling.
 */
export type MailLocale = string

/**
 * A message catalogue. `use-intl/core` accepts any nested record; the app is
 * responsible for supplying the keys each template reads.
 */
export type MailMessages = Record<string, unknown>

/**
 * Every template the package can render, keyed by a stable string id.
 *
 * Add new templates here to make them available to `renderTemplate`.
 */
const templateRegistry = {
  forgotPassword: ForgotPassword,
  verifyEmail: VerifyEmail,
  subscribeNewsletter: SubscribeNewsletter,
  contactMessage: ContactMessage,
  litellmBudgetUpdateFailed: LiteLLMBudgetUpdateFailed,
  syncErrorNotification: SyncErrorNotification,
  wechatBudgetUpdateFailed: WechatBudgetUpdateFailed,
  wechatWebhookFailed: WechatWebhookFailed,
} as const

export type EmailTemplate = keyof typeof templateRegistry

/**
 * Props shared by every email template.
 */
export interface BaseEmailProps {
  locale: MailLocale
  messages: MailMessages
}

/**
 * A registered template component.
 *
 * Each concrete template declares its own context fields on top of
 * `BaseEmailProps`, so the registry widens the signature to keep the union
 * usable for dispatch. Import a template directly when you want its context
 * fields type-checked.
 */
export type EmailTemplateComponent = (
  props: BaseEmailProps & Record<string, unknown>
) => ReactElement

export const EmailTemplates = templateRegistry as unknown as Record<
  EmailTemplate,
  EmailTemplateComponent
>

/**
 * Common email sending parameters.
 */
export interface SendEmailParams {
  to: string
  subject: string
  text?: string
  html: string
  from?: string
}

/**
 * Result of a send attempt. `error` is intentionally `unknown` so callers are
 * forced to narrow before surfacing it.
 */
export interface SendEmailResult {
  success: boolean
  messageId?: string
  error?: unknown
}

/**
 * Parameters for sending an email built from a template.
 */
export interface SendTemplateParams {
  to: string
  template: EmailTemplate
  context: Record<string, unknown>
  locale?: MailLocale
}

/**
 * Parameters for sending a pre-rendered email.
 */
export interface SendRawEmailParams {
  to: string
  subject: string
  html: string
  text?: string
  from?: string
}

/**
 * Transport abstraction. Implementations are responsible only for delivery;
 * rendering lives in `getTemplate`.
 */
export interface MailProvider {
  sendTemplate(params: SendTemplateParams): Promise<SendEmailResult>
  sendRawEmail(params: SendRawEmailParams): Promise<SendEmailResult>
  getProviderName(): string
}

/**
 * Renders a template to HTML and plain text.
 *
 * Injected into providers so a provider can send a template without this
 * package needing to know how the host app loads its message catalogues.
 */
export type TemplateRenderer = (params: {
  template: EmailTemplate
  context: Record<string, unknown>
  locale?: MailLocale
}) => Promise<{ html: string; text: string; subject: string }>
