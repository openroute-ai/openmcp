import { render } from '@react-email/render'
import { NodemailerProvider, smtpConfigFromEnv } from './provider/nodemailer'
import { ResendProvider } from './provider/resend'
import {
  type EmailTemplate,
  EmailTemplates,
  type MailLocale,
  type MailMessages,
  type MailProvider,
  type SendRawEmailParams,
  type SendTemplateParams,
  type TemplateRenderer,
} from './types'

export { NodemailerProvider, smtpConfigFromEnv } from './provider/nodemailer'
export type { NodemailerProviderOptions, SmtpConfig } from './provider/nodemailer'
export { ResendProvider } from './provider/resend'
export type { ResendProviderOptions } from './provider/resend'
export type {
  BaseEmailProps,
  EmailTemplate,
  MailLocale,
  MailMessages,
  MailProvider,
  SendEmailResult,
  SendRawEmailParams,
  SendTemplateParams,
  TemplateRenderer,
} from './types'
export { EmailTemplates } from './types'
export type { EmailTemplateComponent } from './types'
export { createMailTranslator } from './translator'
export type { MailTranslationValues, MailTranslator } from './translator'
export { default as EmailButton } from './components/email-button'
export { default as EmailLayout } from './components/email-layout'
export { ContactMessage } from './templates/contact-message'
export { ForgotPassword } from './templates/forgot-password'
export { LiteLLMBudgetUpdateFailed } from './templates/litellm-budget-update-failed'
export { SubscribeNewsletter } from './templates/subscribe-newsletter'
export { SyncErrorNotification } from './templates/sync-error-notification'
export { VerifyEmail } from './templates/verify-email'
export { WechatBudgetUpdateFailed } from './templates/wechat-budget-update-failed'
export { WechatWebhookFailed } from './templates/wechat-webhook-failed'

/* -------------------------------------------------------------------------- */
/* Template rendering                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Fallback subjects for templates whose catalogue has no `Mail.<id>.subject`
 * entry. Keeps operational notifications readable even when a translation is
 * missing.
 */
const defaultSubjects = (
  template: EmailTemplate,
  context: Record<string, unknown>
): string => {
  const errorTypeLabel = (errorType?: string): string => {
    switch (errorType) {
      case 'parse_error':
        return 'XML 解析错误'
      case 'validation_error':
        return '数据验证错误'
      case 'processing_error':
        return '业务处理错误'
      case 'unknown_error':
        return '未知错误'
      default:
        return '错误'
    }
  }

  switch (template) {
    case 'litellmBudgetUpdateFailed':
      return `[充值系统] LiteLLM 账户余额更新失败通知 - 订单 ${context.orderId ?? ''}`
    case 'syncErrorNotification':
      return `[LiteLLM 同步任务] 同步异常通知 - ${context.syncDate ?? ''}`
    case 'wechatBudgetUpdateFailed':
      return `[微信支付] LiteLLM 预算更新失败通知 - 订单 ${context.orderId ?? ''}`
    case 'wechatWebhookFailed':
      return `[微信支付 Webhook] ${errorTypeLabel(
        context.errorType as string | undefined
      )} - ${context.orderId ? `订单 ${context.orderId}` : '未知订单'}`
    default:
      return ''
  }
}

/**
 * Resolves a subject for a template.
 *
 * Order of precedence: the message catalogue's `Mail.<template>.subject`, then a
 * `subject` passed in the template context, then a built-in fallback.
 */
const resolveSubject = (
  template: EmailTemplate,
  messages: MailMessages,
  context: Record<string, unknown>
): string => {
  const mailMessages = (messages as { Mail?: Record<string, unknown> }).Mail
  const entry = mailMessages?.[template]

  if (entry && typeof entry === 'object' && 'subject' in entry) {
    const { subject } = entry as { subject?: unknown }
    if (typeof subject === 'string' && subject.length > 0) {
      return subject
    }
  }

  if (typeof context.subject === 'string' && context.subject.length > 0) {
    return context.subject
  }

  return defaultSubjects(template, context)
}

/**
 * Renders an email template to HTML and plain text.
 *
 * `resolveMessages` is supplied by the host app because message loading,
 * fallback merging and the default locale are application decisions.
 */
export const renderTemplate = async ({
  template,
  context,
  locale,
  messages,
}: {
  template: EmailTemplate
  context: Record<string, unknown>
  locale: MailLocale
  messages: MailMessages
}): Promise<{ html: string; text: string; subject: string }> => {
  const Template = EmailTemplates[template]
  const element = Template({ ...context, locale, messages })

  const [html, text] = await Promise.all([
    render(element),
    render(element, { plainText: true }),
  ])

  return { html, text, subject: resolveSubject(template, messages, context) }
}

/**
 * Builds a `TemplateRenderer` bound to a specific message-loading strategy.
 */
export const createTemplateRenderer =
  (deps: {
    defaultLocale: MailLocale
    resolveMessages: (locale: MailLocale) => Promise<MailMessages>
  }): TemplateRenderer =>
  async ({ template, context, locale }) => {
    const resolvedLocale = locale ?? deps.defaultLocale
    const messages = await deps.resolveMessages(resolvedLocale)
    return renderTemplate({
      template,
      context,
      locale: resolvedLocale,
      messages,
    })
  }

/* -------------------------------------------------------------------------- */
/* Provider construction                                                       */
/* -------------------------------------------------------------------------- */

export type MailProviderName = 'resend' | 'nodemailer'

export interface MailOptions {
  provider: MailProviderName
  /** Default sender address. */
  from: string
  renderTemplate: TemplateRenderer
  resend?: { apiKey: string }
  smtp?: ReturnType<typeof smtpConfigFromEnv>
}

/**
 * Creates a mail provider from explicit options.
 *
 * Throws for an unknown provider so misconfiguration surfaces at startup rather
 * than at the first send.
 */
export const createMailProvider = (options: MailOptions): MailProvider => {
  const { provider, from, renderTemplate: render } = options

  if (provider === 'resend') {
    if (!options.resend?.apiKey) {
      throw new Error('createMailProvider: resend requires an API key')
    }
    return new ResendProvider({ ...options.resend, from, renderTemplate: render })
  }

  if (provider === 'nodemailer') {
    if (!options.smtp) {
      throw new Error('createMailProvider: nodemailer requires SMTP config')
    }
    return new NodemailerProvider({ smtp: options.smtp, from, renderTemplate: render })
  }

  throw new Error(`Unsupported mail provider: ${provider}`)
}

/**
 * Sends an email through the given provider, choosing between the template and
 * raw paths based on the params passed in.
 */
export async function sendEmail(
  provider: MailProvider,
  params: SendTemplateParams | SendRawEmailParams
): Promise<boolean> {
  const result =
    'template' in params
      ? await provider.sendTemplate(params)
      : await provider.sendRawEmail(params)
  return result.success
}
