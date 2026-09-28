import type { Transporter } from 'nodemailer'
import nodemailer from 'nodemailer'
import type {
  MailProvider,
  SendEmailResult,
  SendRawEmailParams,
  SendTemplateParams,
  TemplateRenderer,
} from '../types'

export interface SmtpConfig {
  host: string
  port: number
  secure: boolean
  auth?: {
    user: string
    pass: string
  }
}

export interface NodemailerProviderOptions {
  smtp: SmtpConfig
  /** Default sender address. */
  from: string
  /**
   * Renders a template id into subject/html/text. Supplied by the host app so
   * this package never needs to know how message catalogues are loaded.
   */
  renderTemplate: TemplateRenderer
}

/**
 * Builds an SMTP config from environment variables.
 *
 * When no credentials are present it returns the MailHog config used for local
 * development, matching the original behaviour.
 */
export function smtpConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env
): SmtpConfig {
  const user = env.SMTP_USER
  const pass = env.SMTP_PASS

  if (!user || !pass) {
    return { host: 'localhost', port: 1025, secure: false }
  }

  return {
    host: env.SMTP_HOST || 'smtp.gmail.com',
    port: Number.parseInt(env.SMTP_PORT || '587', 10),
    secure: env.SMTP_SECURE === 'true',
    auth: { user, pass },
  }
}

/**
 * Nodemailer mail provider implementation.
 *
 * docs:
 * https://www.openroute.cn/docs/email
 */
export class NodemailerProvider implements MailProvider {
  private transporter: Transporter
  private from: string
  private renderTemplate: TemplateRenderer

  constructor(options: NodemailerProviderOptions) {
    if (!options.from) {
      throw new Error('NodemailerProvider requires a default from address')
    }

    const { smtp } = options
    this.transporter = nodemailer.createTransport(
      smtp.auth
        ? smtp
        : { ...smtp, ignoreTLS: true }
    )
    this.from = options.from
    this.renderTemplate = options.renderTemplate
  }

  public getProviderName(): string {
    return 'nodemailer'
  }

  public async sendTemplate(
    params: SendTemplateParams
  ): Promise<SendEmailResult> {
    const { to, template, context, locale } = params

    try {
      const rendered = await this.renderTemplate({ template, context, locale })

      return this.sendRawEmail({
        to,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      })
    } catch (error) {
      console.error('Error sending template email:', error)
      return { success: false, error }
    }
  }

  public async sendRawEmail(
    params: SendRawEmailParams
  ): Promise<SendEmailResult> {
    const { to, subject, html, text, from } = params
    const sender = from ?? this.from

    if (!sender || !to || !subject || !html) {
      console.warn('Missing required fields for email send', {
        from: sender,
        to,
        subject,
        html,
      })
      return { success: false, error: 'Missing required fields' }
    }

    try {
      const info = await this.transporter.sendMail({
        from: sender,
        to,
        subject,
        html,
        text,
      })

      return { success: true, messageId: info.messageId }
    } catch (error) {
      console.error('Error sending email:', error)
      return { success: false, error }
    }
  }

  /**
   * Verify the SMTP connection.
   */
  public async verifyConnection(): Promise<boolean> {
    try {
      await this.transporter.verify()
      return true
    } catch (error) {
      console.error('SMTP connection verification failed:', error)
      return false
    }
  }
}
