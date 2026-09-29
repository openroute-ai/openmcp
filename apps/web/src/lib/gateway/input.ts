import { z } from 'zod'

export const gatewayAuthInput = z.object({
  type: z.enum(['none', 'bearer', 'api_key', 'basic', 'oauth_client', 'platform_oauth', 'custom']).default('none'),
  secret: z.string().max(4000).nullish(),
  headerName: z.string().max(100).nullish(),
  username: z.string().max(200).nullish(),
  clientId: z.string().max(200).nullish(),
  clientSecret: z.string().max(4000).nullish(),
  tokenUrl: z.string().max(2000).nullish(),
  authorizationUrl: z.string().max(2000).nullish(),
  scopes: z.array(z.string()).nullish(),
})

export const listingInput = z.object({
  description: z.string().max(5000).nullish(),
  categoryId: z.string().nullish(),
  scope: z.enum(['public', 'private', 'team']).default('public'),
  priceType: z.enum(['free', 'paid']).default('free'),
  billingModel: z.enum(['one_time', 'subscription', 'pay_per_call']).nullish(),
  priceAmount: z.union([z.string(), z.number()]).nullish(),
  unitPrice: z.union([z.string(), z.number()]).nullish(),
  /** 上架 logo / 封面图（OSS 地址） */
  imageUrl: z.string().max(1000).nullish(),
})

export function failResult(error: unknown, fallback: string) {
  console.error(fallback, error)
  return { success: false as const, error: error instanceof Error ? error.message : fallback }
}

export function resultError(result: { success?: boolean; error?: string }): string | undefined {
  return result.success === false ? result.error : undefined
}
