import { eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { authors, providerProfiles, providerKycSubmissions, user, organization, member } from "@workspace/db"
import type { OrganizationMetadata } from "@workspace/db"
import { createId } from "@workspace/db"

export type ProviderProfileInput = {
  entityType?: 'individual' | 'company'
  companyName?: string | null
  contactName?: string | null
  idNumber?: string | null
  documentationUrl?: string | null
  payChannelType?: 'none' | 'wechat' | 'alipay'
  agreedTerms?: boolean
  /** 联系方式（手机号），仅存 metadata，不建独立列 */
  contactPhone?: string | null
  /** 实名认证附件（OSS 地址），按主体类型校验必传项 */
  kycDocuments?: Partial<KycDocuments> | null
  /**
   * 是否本次调用要提交进入审核。
   *
   * 入驻被拆成「填资料 → 收款通道 → 提交审核」三步后，前两步只保存草稿，
   * 必须显式传 `true` 才会校验完整性并把 `verificationStatus` 置为 `pending`。
   * 缺省等价于只保存，避免中途保存被误判成提交。
   */
  submitForReview?: boolean
}

/**
 * 实名认证附件清单：
 * - 个人：身份证人像面 + 国徽面（必填）
 * - 企业：营业执照（必填）+（法人身份证正反面 或 授权文件 + 授权人身份证正反面），二选一全部必填
 */
export type KycDocuments = {
  idCardFront?: string
  idCardBack?: string
  businessLicense?: string
  legalPersonIdFront?: string
  legalPersonIdBack?: string
  authorizationFile?: string
  authorizerIdFront?: string
  authorizerIdBack?: string
}

export type PayChannelInput = {
  payChannelType: 'wechat' | 'alipay'
  account?: string
  accountName?: string | null
  qrUrl?: string | null
  isDefault?: boolean
}

export type PayoutAccount = {
  account?: string
  accountName?: string | null
  qrUrl?: string | null
  updatedAt?: string
}

export type InvoiceProfile = {
  title: string
  taxId: string
  address?: string
  bank?: string
  phone?: string
}

export type ProviderMetadata = {
  payoutAccounts?: {
    wechat?: PayoutAccount
    alipay?: PayoutAccount
  }
  invoiceProfile?: InvoiceProfile
  kycDocuments?: KycDocuments
  /** 联系方式（手机号），企业入驻时填写 */
  contactPhone?: string | null
  [key: string]: unknown
}

/**
 * 校验实名认证附件完整性。
 * - 个人：身份证正反面必传
 * - 企业：营业执照必传；下面两条路径二选一，且互斥：
 *   1. 法人本人办理：法人身份证正反面
 *   2. 授权经办人办理：授权文件 + 授权人身份证正反面
 *
 * 互斥的原因：两套材料同时出现时无法判断谁是实际签约主体，人工审核只能靠猜，
 * 所以两套齐备直接判为错误。
 */
export function validateKycDocuments(
  entityType: 'individual' | 'company' | null | undefined,
  docs: Partial<KycDocuments> | null | undefined
): string | null {
  const has = (key: keyof KycDocuments) => typeof docs?.[key] === 'string' && (docs[key] as string).trim().length > 0

  if (entityType === 'individual') {
    if (!has('idCardFront') || !has('idCardBack')) {
      return '请上传身份证人像面与国徽面照片'
    }
  } else if (entityType === 'company') {
    if (!has('businessLicense')) {
      return '企业实名必须上传营业执照'
    }
    const legalPersonOk = has('legalPersonIdFront') && has('legalPersonIdBack')
    const authorizedOk = has('authorizationFile') && has('authorizerIdFront') && has('authorizerIdBack')

    // Report an incomplete upload on either path before the exclusivity check,
    // otherwise someone who started one path gets a generic "pick one" message
    // instead of being told which file is missing.
    const legalPersonPartial = (has('legalPersonIdFront') || has('legalPersonIdBack')) && !legalPersonOk
    const authorizerPartial =
      (has('authorizerIdFront') || has('authorizerIdBack')) && !(has('authorizerIdFront') && has('authorizerIdBack'))

    if (legalPersonPartial) {
      return '请补全法人身份证正反面'
    }
    if (authorizerPartial) {
      return '请补全授权人身份证正反面'
    }
    if (has('authorizationFile') && !authorizedOk) {
      return '已上传授权文件，还需补全授权人身份证正反面'
    }

    // 两条路径互斥：两套材料同时出现时无法判断谁是实际签约主体，人工审核只能靠猜。
    if (legalPersonOk && authorizedOk) {
      return '法人身份证与（授权文件 + 授权人身份证）只能选择其中一种，请删除另一套后重新提交'
    }
    if (!legalPersonOk && !authorizedOk) {
      return '请上传法人身份证正反面，或（授权文件 + 授权人身份证正反面）'
    }
  } else {
    return '请先选择认证主体类型'
  }
  return null
}

/**
 * 入驻资料是否完整：同意协议 + 联系人 + 实名 + 已选收款通道 + 实名附件。
 * 完整提交后才将申请状态置为待审核（pending）。
 */
function isCompleteSubmission(input: ProviderProfileInput): boolean {
  return (
    input.agreedTerms === true &&
    !!input.contactName &&
    !!input.idNumber &&
    !!input.payChannelType &&
    input.payChannelType !== 'none' &&
    validateKycDocuments(input.entityType, input.kycDocuments) === null
  )
}

/** 是否携带了会变更认证资料内容的字段 */
function hasKycFields(input: ProviderProfileInput): boolean {
  return (
    input.entityType !== undefined ||
    'companyName' in input ||
    input.contactName !== undefined ||
    input.idNumber !== undefined ||
    input.contactPhone !== undefined ||
    'documentationUrl' in input ||
    input.kycDocuments !== undefined ||
    input.agreedTerms !== undefined
  )
}

function asMetadata(raw: unknown): ProviderMetadata {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as ProviderMetadata
  }
  return {}
}

/** 手机号入库前归一化：空串存成 null，避免「空字符串」和「没填」两种状态。 */
function normalizeContactPhone(value: string | null | undefined): string | null {
  return value?.trim() || null
}

function hasPayoutAccount(metadata: ProviderMetadata, type: 'wechat' | 'alipay'): boolean {
  const payoutAccount = metadata.payoutAccounts?.[type]
  if (!payoutAccount) return false
  
  const hasAccount = typeof payoutAccount.account === 'string' && payoutAccount.account.trim().length > 0
  const hasQrUrl = typeof payoutAccount.qrUrl === 'string' && payoutAccount.qrUrl.trim().length > 0
  
  // 账号或二维码至少有一个
  return hasAccount || hasQrUrl
}

/**
 * 为用户创建/获取作者身份，并保证存在一条 provider_profiles 记录。
 * 参考 webhook 的作者 upsert 逻辑，这里 username 由 email 前缀派生，冲突时加后缀。
 */
async function ensureAuthorForUser(userId: string, name: string, email: string) {
  const existingProfile = await db
    .select({ authorId: providerProfiles.authorId })
    .from(providerProfiles)
    .where(eq(providerProfiles.userId, userId))
    .limit(1)

  if (existingProfile[0]?.authorId) {
    return existingProfile[0].authorId
  }

  const existingAuthor = await db
    .select({ id: authors.id, username: authors.username })
    .from(authors)
    .innerJoin(providerProfiles, eq(providerProfiles.authorId, authors.id))
    .where(eq(providerProfiles.userId, userId))
    .limit(1)

  if (existingAuthor[0]?.id) {
    return existingAuthor[0].id
  }

  const base =
    email
      .split('@')[0]!
      .replace(/[^a-zA-Z0-9_-]/g, '-')
      .slice(0, 60) || 'provider'
  const [inserted] = await db
    .insert(authors)
    .values({
      name: name || '未命名提供者',
      username: await uniqueUsername(base),
      status: 'active',
    })
    .returning()

  if (!inserted) {
    throw new Error('创建作者失败')
  }

  return inserted.id
}

async function uniqueUsername(base: string): Promise<string> {
  let candidate = base
  let suffix = 0
  for (;;) {
    const [existing] = await db
      .select({ username: authors.username })
      .from(authors)
      .where(eq(authors.username, candidate))
      .limit(1)
    if (!existing) return candidate
    suffix += 1
    candidate = `${base}-${suffix}`
  }
}

/**
 * Batch C: 获取或创建用户的个人组织(kind='personal')
 * 个人组织在用户注册时由 better-auth 自动创建,这里确保存在并设置 kind
 */
async function ensurePersonalOrganization(userId: string, userName: string, userEmail: string): Promise<string> {
  const [userMember] = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(eq(member.userId, userId))
    .limit(1)

  if (userMember?.organizationId) {
    const [org] = await db
      .select({ id: organization.id, metadata: organization.metadata })
      .from(organization)
      .where(eq(organization.id, userMember.organizationId))
      .limit(1)

    if (org) {
      const metadata = (org.metadata as OrganizationMetadata) || {}
      if (!metadata.kind) {
        await db
          .update(organization)
          .set({
            metadata: { ...metadata, kind: 'personal' } as any,
          })
          .where(eq(organization.id, org.id))
      }
      return org.id
    }
  }

  const emailLocalPart = userEmail.split('@')[0]!
  const slug = `${emailLocalPart.replace(/[^a-zA-Z0-9_-]/g, '-')}-${userId.slice(0, 8)}`.toLowerCase()
  const orgName = userName || emailLocalPart

  const [newOrg] = await db
    .insert(organization)
    .values({
      id: createId(),
      name: orgName,
      slug,
      createdAt: new Date(),
      metadata: { kind: 'personal' } as any,
    })
    .returning()

  if (!newOrg) {
    throw new Error('创建组织失败')
  }

  await db.insert(member).values({
    id: createId(),
    userId,
    organizationId: newOrg.id,
    role: 'owner',
    createdAt: new Date(),
  })

  return newOrg.id
}

/**
 * Batch C: 获取或创建公司组织(kind='company')
 * 如果已存在公司组织则复用,否则创建新的
 */
async function ensureCompanyOrganization(
  userId: string,
  companyName: string,
  contactName: string
): Promise<string> {
  const existingMembers = await db.select({ organizationId: member.organizationId }).from(member).where(eq(member.userId, userId))

  for (const m of existingMembers) {
    const [org] = await db
      .select({ id: organization.id, metadata: organization.metadata })
      .from(organization)
      .where(eq(organization.id, m.organizationId))
      .limit(1)

    if (org) {
      const metadata = (org.metadata as OrganizationMetadata) || {}
      if (metadata.kind === 'company') {
        return org.id
      }
    }
  }

  const baseSlug = companyName
    .replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
    .toLowerCase()
  const slug = `${baseSlug}-${userId.slice(0, 8)}`

  const [newOrg] = await db
    .insert(organization)
    .values({
      id: createId(),
      name: companyName,
      slug,
      createdAt: new Date(),
      metadata: {
        kind: 'company',
        kycSummary: {
          contactName,
          companyName,
        },
      } as any,
    })
    .returning()

  if (!newOrg) {
    throw new Error('创建组织失败')
  }

  await db.insert(member).values({
    id: createId(),
    userId,
    organizationId: newOrg.id,
    role: 'owner',
    createdAt: new Date(),
  })

  return newOrg.id
}

export const providersDataAccess = {
  getMyProfile: async (userId: string) => {
    const [row] = await db
      .select({
        id: providerProfiles.id,
        userId: providerProfiles.userId,
        authorId: providerProfiles.authorId,
        organizationId: providerProfiles.organizationId,
        entityType: providerProfiles.entityType,
        companyName: providerProfiles.companyName,
        contactName: providerProfiles.contactName,
        idNumber: providerProfiles.idNumber,
        documentationUrl: providerProfiles.documentationUrl,
        verificationStatus: providerProfiles.verificationStatus,
        verificationNote: providerProfiles.verificationNote,
        verifiedAt: providerProfiles.verifiedAt,
        payChannelType: providerProfiles.payChannelType,
        payChannelStatus: providerProfiles.payChannelStatus,
        payChannelNote: providerProfiles.payChannelNote,
        agreedTerms: providerProfiles.agreedTerms,
        metadata: providerProfiles.metadata,
        createdAt: providerProfiles.createdAt,
        updatedAt: providerProfiles.updatedAt,
      })
      .from(providerProfiles)
      .where(eq(providerProfiles.userId, userId))
      .limit(1)

    return row ?? null
  },

  upsertProfile: async (userId: string, input: ProviderProfileInput) => {
    const [u] = await db
      .select({ id: user.id, name: user.name, email: user.email })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1)

    if (!u) throw new Error('用户不存在')

    const authorId = await ensureAuthorForUser(userId, u.name, u.email)

    const existing = await providersDataAccess.getMyProfile(userId)
    const existingMeta = asMetadata(existing?.metadata)
    // 只有显式要求提交审核的调用才会走完整性校验并进入 pending；
    // 「填资料」「收款通道」两步保存的是草稿，不改变审核状态。
    const wantsReview = input.submitForReview === true
    const nextType = input.payChannelType ?? existing?.payChannelType ?? 'none'
    const nextPayStatus =
      nextType !== 'none' &&
      (nextType === 'wechat' || nextType === 'alipay') &&
      hasPayoutAccount(existingMeta, nextType)
        ? ('ready' as const)
        : nextType !== 'none'
          ? ('unconnected' as const)
          : ('unconnected' as const)

    let targetOrganizationId: string | null = existing?.organizationId ?? null

    if (existing) {
      if (existing.verificationStatus === 'pending' && hasKycFields(input)) {
        throw new Error('实名认证审核中，资料已锁定，请等待审核通过或驳回后再修改')
      }

      const submitted = wantsReview && isCompleteSubmission(input)
      if (wantsReview && input.agreedTerms === true && !submitted) {
        const docError = validateKycDocuments(
          input.entityType ?? existing.entityType,
          input.kycDocuments != null ? input.kycDocuments : existingMeta.kycDocuments
        )
        if (docError) throw new Error(docError)
        throw new Error('请完善实名资料（联系人、证件号、收款通道）后再提交')
      }

      const nextStatus =
        existing.verificationStatus === 'verified'
          ? submitted
            ? ('pending' as const)
            : 'verified'
          : submitted
            ? ('pending' as const)
            : existing.verificationStatus

      const mergedDocs: KycDocuments = {
        ...(existingMeta.kycDocuments ?? {}),
        ...(input.kycDocuments ?? {}),
      }

      // metadata 只在本次真的带了会改动的字段时才写，避免一次资料保存把
      // 其它模块（发票、收款码）写入的键冲掉。
      const writesMetadata = input.kycDocuments != null || input.contactPhone !== undefined
      const nextMetadata: ProviderMetadata = { ...existingMeta }
      if (input.kycDocuments != null) nextMetadata.kycDocuments = mergedDocs
      if (input.contactPhone !== undefined) nextMetadata.contactPhone = normalizeContactPhone(input.contactPhone)

      // Batch C: 确定目标组织ID
      const finalEntityType = (input.entityType ?? existing.entityType) as 'individual' | 'company'
      if (submitted) {
        if (finalEntityType === 'individual') {
          targetOrganizationId = await ensurePersonalOrganization(userId, u.name, u.email)
        } else if (finalEntityType === 'company') {
          const companyNameValue = ('companyName' in input ? input.companyName : existing.companyName) || '未命名公司'
          const contactNameValue = (input.contactName ?? existing.contactName) || '未命名联系人'
          targetOrganizationId = await ensureCompanyOrganization(userId, companyNameValue, contactNameValue)
        }
      }

      // Batch B: 完整提交时创建不可变的 KYC submission 历史记录
      if (submitted && nextStatus === 'pending') {
        const submissionPayload = {
          entityType: finalEntityType,
          companyName: 'companyName' in input ? input.companyName : existing.companyName,
          contactName: input.contactName ?? existing.contactName,
          idNumber: input.idNumber ?? existing.idNumber,
          documentationUrl: 'documentationUrl' in input ? input.documentationUrl : existing.documentationUrl,
          contactPhone: nextMetadata.contactPhone ?? null,
          payChannelType: input.payChannelType ?? existing.payChannelType,
          kycDocuments: mergedDocs,
          submittedAt: new Date().toISOString(),
        }

        await db.insert(providerKycSubmissions).values({
          userId,
          organizationId: targetOrganizationId,
          entityType: finalEntityType,
          status: 'pending',
          payload: submissionPayload,
        })
      }

      await db
        .update(providerProfiles)
        .set({
          organizationId: targetOrganizationId,
          entityType: input.entityType ?? existing.entityType,
          companyName: 'companyName' in input ? input.companyName : existing.companyName,
          contactName: input.contactName ?? existing.contactName,
          idNumber: input.idNumber ?? existing.idNumber,
          documentationUrl: 'documentationUrl' in input ? input.documentationUrl : existing.documentationUrl,
          payChannelType: input.payChannelType ?? existing.payChannelType,
          payChannelStatus:
            existing.payChannelStatus === 'ready' &&
            (!input.payChannelType || input.payChannelType === existing.payChannelType)
              ? 'ready'
              : nextPayStatus,
          agreedTerms: input.agreedTerms ?? existing.agreedTerms,
          verificationStatus: nextStatus,
          metadata: writesMetadata ? nextMetadata : existing.metadata,
          updatedAt: new Date(),
        })
        .where(eq(providerProfiles.userId, userId))
    } else {
      const submitted = wantsReview && isCompleteSubmission(input)
      const nextStatus = submitted ? 'pending' : 'unverified'
      const nextMetadata: ProviderMetadata = {}
      if (input.kycDocuments != null) nextMetadata.kycDocuments = input.kycDocuments
      if (input.contactPhone !== undefined) nextMetadata.contactPhone = normalizeContactPhone(input.contactPhone)

      // Batch C: 确定目标组织ID
      const finalEntityType = (input.entityType ?? 'individual') as 'individual' | 'company'
      if (submitted) {
        if (finalEntityType === 'individual') {
          targetOrganizationId = await ensurePersonalOrganization(userId, u.name, u.email)
        } else if (finalEntityType === 'company') {
          const companyNameValue = input.companyName || '未命名公司'
          const contactNameValue = input.contactName || '未命名联系人'
          targetOrganizationId = await ensureCompanyOrganization(userId, companyNameValue, contactNameValue)
        }
      }

      // Batch B: 首次完整提交时创建 KYC submission 历史记录
      if (submitted) {
        const submissionPayload = {
          entityType: finalEntityType,
          companyName: input.companyName ?? null,
          contactName: input.contactName ?? null,
          idNumber: input.idNumber ?? null,
          documentationUrl: input.documentationUrl ?? null,
          contactPhone: nextMetadata.contactPhone ?? null,
          payChannelType: input.payChannelType ?? 'none',
          kycDocuments: input.kycDocuments ?? {},
          submittedAt: new Date().toISOString(),
        }

        await db.insert(providerKycSubmissions).values({
          userId,
          organizationId: targetOrganizationId,
          entityType: finalEntityType,
          status: 'pending',
          payload: submissionPayload,
        })
      }

      await db.insert(providerProfiles).values({
        userId,
        authorId,
        organizationId: targetOrganizationId,
        entityType: finalEntityType,
        companyName: input.companyName ?? null,
        contactName: input.contactName ?? null,
        idNumber: input.idNumber ?? null,
        documentationUrl: input.documentationUrl ?? null,
        payChannelType: input.payChannelType ?? 'none',
        payChannelStatus: nextPayStatus,
        agreedTerms: input.agreedTerms ?? false,
        verificationStatus: nextStatus,
        metadata: Object.keys(nextMetadata).length > 0 ? nextMetadata : null,
      })
    }

    return providersDataAccess.getMyProfile(userId)
  },

  /**
   * 绑定微信 / 支付宝收款账号（平台打款用，非商户 OAuth）。
   * Batch E: 支持双通道、收款码上传、预填充账户名。
   * - 账号和二维码至少填一个
   * - 可保存多个通道（微信和支付宝）
   * - payChannelType 表示默认通道
   */
  updatePayChannel: async (userId: string, input: PayChannelInput) => {
    const existing = await providersDataAccess.getMyProfile(userId)
    if (!existing) {
      throw new Error('请先完成提供者入驻再绑定收款账户')
    }

    const account = input.account?.trim() || ''
    const qrUrl = input.qrUrl?.trim() || ''
    
    // 账号和二维码至少填一个
    if (!account && !qrUrl) {
      throw new Error('请至少填写收款账号或上传收款二维码')
    }

    const metadata = asMetadata(existing.metadata)
    const existingAccounts = metadata.payoutAccounts ?? {}
    
    // 预填充账户名：优先使用输入，否则从 KYC 数据获取
    let accountName = input.accountName?.trim() || null
    if (!accountName) {
      if (existing.entityType === 'company' && existing.companyName) {
        accountName = existing.companyName
      } else if (existing.contactName) {
        accountName = existing.contactName
      }
    }

    // 更新或添加指定通道的账户信息
    const payoutAccounts = {
      ...existingAccounts,
      [input.payChannelType]: {
        account: account || undefined,
        accountName,
        qrUrl: qrUrl || undefined,
        updatedAt: new Date().toISOString(),
      },
    }

    // 如果明确设置为默认，或者是第一次绑定，则设为默认通道
    const shouldSetDefault = input.isDefault ?? true
    const targetChannelType = shouldSetDefault ? input.payChannelType : existing.payChannelType || input.payChannelType

    // 检查默认通道是否已就绪
    const defaultChannelReady = hasPayoutAccount(
      { payoutAccounts } as ProviderMetadata, 
      targetChannelType as 'wechat' | 'alipay'
    )

    await db
      .update(providerProfiles)
      .set({
        payChannelType: targetChannelType,
        payChannelStatus: defaultChannelReady ? 'ready' : 'unconnected',
        payChannelNote: null,
        metadata: { ...metadata, payoutAccounts },
        updatedAt: new Date(),
      })
      .where(eq(providerProfiles.userId, userId))

    return providersDataAccess.getMyProfile(userId)
  },

  /** 通过公开作者 username 获取提供者信息（仅公开字段），用于详情页展示认证徽标 */
  getProfileByAuthorUsername: async (username: string) => {
    const [row] = await db
      .select({
        id: providerProfiles.id,
        authorId: providerProfiles.authorId,
        entityType: providerProfiles.entityType,
        companyName: providerProfiles.companyName,
        verificationStatus: providerProfiles.verificationStatus,
        verifiedAt: providerProfiles.verifiedAt,
      })
      .from(providerProfiles)
      .innerJoin(authors, eq(providerProfiles.authorId, authors.id))
      .where(eq(authors.username, username))
      .limit(1)

    return row ?? null
  },

  getInvoiceProfile: async (userId: string): Promise<InvoiceProfile | null> => {
    const existing = await providersDataAccess.getMyProfile(userId)
    if (!existing) return null
    const metadata = asMetadata(existing.metadata)
    return metadata.invoiceProfile ?? null
  },

  upsertInvoiceProfile: async (userId: string, profile: InvoiceProfile) => {
    const title = profile.title.trim()
    const taxId = profile.taxId.trim()
    if (!title || !taxId) {
      throw new Error('请填写发票抬头与税号')
    }

    const invoiceProfile: InvoiceProfile = {
      title,
      taxId,
      address: profile.address?.trim() || undefined,
      bank: profile.bank?.trim() || undefined,
      phone: profile.phone?.trim() || undefined,
    }

    let existing = await providersDataAccess.getMyProfile(userId)
    if (!existing) {
      existing = await providersDataAccess.upsertProfile(userId, {
        entityType: 'individual',
        agreedTerms: false,
      })
    }

    const metadata = asMetadata(existing?.metadata)
    await db
      .update(providerProfiles)
      .set({
        metadata: { ...metadata, invoiceProfile },
        updatedAt: new Date(),
      })
      .where(eq(providerProfiles.userId, userId))

    return invoiceProfile
  },

  /**
   * Batch B: 查询用户的 KYC 提交历史（仅返回概要，敏感字段脱敏）
   * 用于 Dashboard 审核历史查看
   */
  listMyKycSubmissions: async (userId: string) => {
    const rows = await db
      .select({
        id: providerKycSubmissions.id,
        entityType: providerKycSubmissions.entityType,
        status: providerKycSubmissions.status,
        verificationNote: providerKycSubmissions.verificationNote,
        reviewedAt: providerKycSubmissions.reviewedAt,
        createdAt: providerKycSubmissions.createdAt,
        payload: providerKycSubmissions.payload,
      })
      .from(providerKycSubmissions)
      .where(eq(providerKycSubmissions.userId, userId))
      .orderBy(providerKycSubmissions.createdAt)

    return rows.map((row) => {
      const payload = row.payload as any
      const idNumber = payload?.idNumber
      const maskedIdNumber =
        typeof idNumber === 'string' && idNumber.length > 5
          ? `${idNumber.slice(0, 3)}***${idNumber.slice(-2)}`
          : '***'

      return {
        id: row.id,
        entityType: row.entityType,
        status: row.status,
        verificationNote: row.verificationNote,
        reviewedAt: row.reviewedAt,
        createdAt: row.createdAt,
        summary: {
          entityType: payload?.entityType,
          contactName: payload?.contactName,
          idNumber: maskedIdNumber,
          companyName: payload?.companyName,
          submittedAt: payload?.submittedAt,
        },
      }
    })
  },
}
