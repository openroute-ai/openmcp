/**
 * Site-wide configuration that is not translated.
 *
 * Translatable copy lives in `messages/<locale>.json`; this file only holds
 * values that must be identical across locales (endpoints, feature switches,
 * provider names, default locale).
 */
export const websiteConfig = {
  metadata: {
    title: 'OpenMCP Hub — MCP / A2A / Skills Asset Marketplace',
    description:
      'A marketplace for AI agents: providers publish MCP servers, A2A agents and skills; users install them free or paid. Review, discovery and settlement included.',
    base_url: process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
    theme: {
      defaultTheme: 'default',
      enableSwitch: false,
    },
    mode: {
      defaultMode: 'system',
      enableSwitch: true,
    },
    /** Empty entries are treated as "not configured" and hidden by the UI. */
    social: {
      github: '',
      twitter: '',
      blueSky: '',
      discord: '',
      mastodon: '',
      linkedin: '',
      youtube: '',
      telegram: '',
      tiktok: '',
      instagram: '',
      facebook: '',
    },
  },
  routes: {
    defaultLoginRedirect: '/dashboard',
    /** Locale prefix strategy: unprefixed for the default locale. */
    localePrefix: 'as-needed',
  },
  /**
   * Optional WeChat donation QR shown on the marketplace filter sidebar.
   * The upstream repo shipped a hardcoded image path; sourcing it from the
   * environment keeps a missing asset from rendering as a broken image.
   */
  donationQrUrl: process.env.NEXT_PUBLIC_DONATION_QR_URL || '',

  i18n: {
    defaultLocale: 'zh',
    locales: {
      en: {
        flag: '🇺🇸',
        name: 'English',
      },
      zh: {
        flag: '🇨🇳',
        name: '中文',
      },
    },
  },
  auth: {
    cookieDomain:
      process.env.NODE_ENV === 'production' ? '.openmcp.cn' : 'localhost',
    trustedOrigins: (process.env.BETTER_AUTH_TRUSTED_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    enableGoogleLogin: false,
    /**
     * GitHub is also a `trustedProvider` for account linking in `lib/auth.ts`,
     * so a verified GitHub identity can claim an existing email/password
     * account instead of colliding with it on the unique `email` column.
     */
    enableGithubLogin: false,
    requireEmailVerification: false,
    autoSignInAfterVerification: true,
  },
  blog: {
    /** Blog list page size. */
    paginationSize: 6,
    /** How many related posts to show at the bottom of an article. */
    relatedPostsSize: 3,
  },
  mail: {
    provider: (process.env.MAIL_PROVIDER ?? 'nodemailer') as
      | 'resend'
      | 'nodemailer',
    fromEmail: process.env.MAIL_FROM ?? 'OpenMCP Hub <service@openmcp.cn>',
    supportEmail: process.env.MAIL_SUPPORT ?? 'OpenMCP Hub <service@openmcp.cn>',
  },
  newsletter: {
    provider: (process.env.NEWSLETTER_PROVIDER ?? 'nodemailer') as
      | 'resend'
      | 'nodemailer',
    autoSubscribeAfterSignUp: true,
  },
  storage: {
    provider: (process.env.STORAGE_PROVIDER ?? 'oss') as 's3' | 'oss',
  },
  payment: {
    provider: (process.env.PAYMENT_PROVIDER ?? 'wechat') as
      | 'stripe'
      | 'alipay'
      | 'wechat',
  },
  /** Folder prefix applied to every object uploaded through @workspace/storage. */
  storageAppName: 'openmcp',
} as const

export type WebsiteConfig = typeof websiteConfig
