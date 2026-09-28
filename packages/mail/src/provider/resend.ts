import { Resend } from 'resend'
import type {
  MailProvider,
  SendEmailResult,
  SendRawEmailParams,
  SendTemplateParams,
  TemplateRenderer,
} from '../types'

export interface ResendProviderOptions {
  apiKey: string
  /** Default sender address, e.g. "OpenRoute <noreply@openroute.cn>". */
  from: string
  /**
   * Renders a template id into subject/html/text. Supplied by the host app so
   * this package never needs to know how message catalogues are loaded.
   */
  renderTemplate: TemplateRenderer
}

/**
 * Resend mail provider implementation.
 *
 * docs:
 * https://openroute.cn/docs/email
 */
export class ResendProvider implements MailProvider {
  private resend: Resend
  private from: string
  private renderTemplate: TemplateRenderer

  constructor(options: ResendProviderOptions) {
    if (!options.apiKey) {
      throw new Error('ResendProvider requires an API key')
    }
    if (!options.from) {
      throw new Error('ResendProvider requires a default from address')
    }

    this.resend = new Resend(options.apiKey)
    this.from = options.from
    this.renderTemplate = options.renderTemplate
  }

  public getProviderName(): string {
    return 'resend'
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
      const { data, error } = await this.resend.emails.send({
        from: sender,
        to,
        subject,
        html,
        text,
      })

      if (error) {
        console.error('Error sending email', error)
        return { success: false, error }
      }

      return { success: true, messageId: data?.id }
    } catch (error) {
      console.error('Error sending email:', error)
      return { success: false, error }
    }
  }
}
