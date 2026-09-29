export type Locale = 'zh' | 'en'

export const MCP_TRANSPORT_VALUES = ['http', 'sse', 'stdio'] as const
export type McpTransport = (typeof MCP_TRANSPORT_VALUES)[number]

export const ASSET_AUTH_VALUES = ['none', 'bearer', 'api_key', 'basic', 'oauth2', 'platform_oauth', 'custom'] as const
export type AssetAuthType = (typeof ASSET_AUTH_VALUES)[number]

export const ASSET_VISIBILITY_VALUES = ['public', 'private', 'team'] as const
export type AssetVisibility = (typeof ASSET_VISIBILITY_VALUES)[number]

export const ASSET_STATUS_VALUES = ['draft', 'submitted', 'published', 'archived', 'rejected'] as const
export type AssetStatus = (typeof ASSET_STATUS_VALUES)[number]

export const ASSET_CONNECTION_VALUES = ['online', 'error', 'disabled'] as const
export type AssetConnectionStatus = (typeof ASSET_CONNECTION_VALUES)[number]

export const ASSET_SECURITY_VALUES = ['safe', 'pending', 'unsafe'] as const
export type AssetSecurityLevel = (typeof ASSET_SECURITY_VALUES)[number]

export const ASSET_BILLING_VALUES = ['one_time', 'subscription', 'pay_per_call'] as const
export type AssetBillingModel = (typeof ASSET_BILLING_VALUES)[number]

export const ASSET_PRICE_VALUES = ['free', 'paid'] as const
export type AssetPriceType = (typeof ASSET_PRICE_VALUES)[number]

export const ASSET_HOSTING_VALUES = ['platform_managed', 'self_hosted'] as const
export type AssetHosting = (typeof ASSET_HOSTING_VALUES)[number]

export const A2A_PROTOCOL_VALUES = ['0.3', '1.0'] as const
export type A2aProtocolVersion = (typeof A2A_PROTOCOL_VALUES)[number]

type Bilingual = { zh: string; en: string }

const bilingual = (zh: string, en: string): Bilingual => ({ zh, en })

const pick = (entry: Bilingual | undefined, locale: Locale): string => (entry ? entry[locale] : '')

export const MCP_TRANSPORT_LABEL: Record<McpTransport, Bilingual> = {
  http: bilingual('HTTP', 'HTTP'),
  sse: bilingual('SSE', 'SSE'),
  stdio: bilingual('Stdio', 'Stdio'),
}

export const ASSET_AUTH_LABEL: Record<AssetAuthType, Bilingual> = {
  none: bilingual('无认证', 'No auth'),
  bearer: bilingual('Bearer', 'Bearer'),
  api_key: bilingual('API Key', 'API Key'),
  basic: bilingual('Basic', 'Basic'),
  oauth2: bilingual('OAuth 2.0', 'OAuth 2.0'),
  platform_oauth: bilingual('平台 OAuth', 'Platform OAuth'),
  custom: bilingual('自定义', 'Custom'),
}

export const ASSET_VISIBILITY_LABEL: Record<AssetVisibility, Bilingual> = {
  public: bilingual('公开', 'Public'),
  private: bilingual('私有', 'Private'),
  team: bilingual('团队', 'Team'),
}

export const ASSET_STATUS_LABEL: Record<AssetStatus, Bilingual> = {
  draft: bilingual('草稿', 'Draft'),
  submitted: bilingual('待审核', 'In review'),
  published: bilingual('已上架', 'Published'),
  archived: bilingual('已归档', 'Archived'),
  rejected: bilingual('已驳回', 'Rejected'),
}

export const ASSET_CONNECTION_LABEL: Record<AssetConnectionStatus, Bilingual> = {
  online: bilingual('在线', 'Online'),
  error: bilingual('异常', 'Error'),
  disabled: bilingual('已停用', 'Disabled'),
}

export const ASSET_SECURITY_LABEL: Record<AssetSecurityLevel, Bilingual> = {
  safe: bilingual('安全', 'Safe'),
  pending: bilingual('待扫描', 'Pending'),
  unsafe: bilingual('存在风险', 'Unsafe'),
}

export const ASSET_BILLING_LABEL: Record<AssetBillingModel, Bilingual> = {
  one_time: bilingual('一次性', 'One-time'),
  subscription: bilingual('订阅', 'Subscription'),
  pay_per_call: bilingual('按调用付费', 'Pay per call'),
}

export const ASSET_PRICE_LABEL: Record<AssetPriceType, Bilingual> = {
  free: bilingual('免费', 'Free'),
  paid: bilingual('付费', 'Paid'),
}

export const ASSET_HOSTING_LABEL: Record<AssetHosting, Bilingual> = {
  platform_managed: bilingual('平台托管', 'Platform managed'),
  self_hosted: bilingual('自托管', 'Self hosted'),
}

type LabelInput = string | null | undefined

const label = (input: LabelInput, table: Record<string, Bilingual>, locale: Locale): string => {
  if (!input) return ''
  return pick(table[input], locale) || input
}

export const transportLabel = (value: LabelInput, locale: Locale): string => label(value, MCP_TRANSPORT_LABEL, locale)

export const authLabel = (value: LabelInput, locale: Locale): string => label(value, ASSET_AUTH_LABEL, locale)

export const visibilityLabel = (value: LabelInput, locale: Locale): string =>
  label(value, ASSET_VISIBILITY_LABEL, locale)

export const statusLabel = (value: LabelInput, locale: Locale): string => label(value, ASSET_STATUS_LABEL, locale)

export const connectionLabel = (value: LabelInput, locale: Locale): string =>
  label(value, ASSET_CONNECTION_LABEL, locale)

export const securityLabel = (value: LabelInput, locale: Locale): string => label(value, ASSET_SECURITY_LABEL, locale)

export const billingLabel = (value: LabelInput, locale: Locale): string => label(value, ASSET_BILLING_LABEL, locale)

export const priceTypeLabel = (value: LabelInput, locale: Locale): string => label(value, ASSET_PRICE_LABEL, locale)

export const hostingLabel = (value: LabelInput, locale: Locale): string => label(value, ASSET_HOSTING_LABEL, locale)
