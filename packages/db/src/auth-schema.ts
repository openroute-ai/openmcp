import { createId as createId2 } from "@paralleldrive/cuid2"
import { relations } from "drizzle-orm"
import {
  pgTable,
  text,
  timestamp,
  boolean,
  index,
  decimal,
  integer,
  jsonb,
  varchar,
} from "drizzle-orm/pg-core"

/**
 * 16-char cuid-style id, used as the default primary key for non-auth tables.
 *
 * Truncated from cuid2 rather than hand-rolled from `Math.random()`, which is
 * not collision-safe and is predictable, so ids would be guessable by an
 * attacker probing public resources.
 */
export const createId = (): string => createId2().substring(0, 16)

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  phoneNumber: text("phone_number"),
  phoneNumberVerified: boolean("phone_number_verified").default(false).notNull(),
  /** Platform role: "admin" | "user" | "guest". Checked by the admin tRPC procedure. */
  role: varchar("role", { length: 256 }).default("user"),
  banned: boolean("banned"),
  banReason: text("ban_reason"),
  banExpires: timestamp("ban_expires"),
  customerId: text("customer_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
})

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    activeOrganizationId: text("active_organization_id"),
    impersonatedBy: text("impersonated_by"),
  },
  (table) => [index("session_userId_idx").on(table.userId)]
)

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("account_userId_idx").on(table.userId)]
)

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)]
)

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
}))

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}))

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}))

export type User = typeof user.$inferSelect

/* -------------------------------------------------------------------------- */
/* Organizations (better-auth organization plugin)                            */
/* -------------------------------------------------------------------------- */

export const organization = pgTable("organization", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").unique(),
  logo: text("logo"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  metadata: jsonb("metadata"),
})

export const member = pgTable(
  "member",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").default("member").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("member_organizationId_idx").on(table.organizationId)]
)

export const invitation = pgTable(
  "invitation",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role"),
    status: text("status").default("pending").notNull(),
    teamId: text("team_id"),
    expiresAt: timestamp("expires_at").notNull(),
    inviterId: text("inviter_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("invitation_organizationId_idx").on(table.organizationId)]
)

export const organizationRelations = relations(organization, ({ many }) => ({
  members: many(member),
}))

export const memberRelations = relations(member, ({ one }) => ({
  organization: one(organization, {
    fields: [member.organizationId],
    references: [organization.id],
  }),
  user: one(user, {
    fields: [member.userId],
    references: [user.id],
  }),
}))

export type Organization = typeof organization.$inferSelect

export type OrganizationMetadata = {
  kind?: "personal" | "company"
  kycSummary?: {
    contactName?: string
    companyName?: string
    verifiedAt?: string
  }
  langfuse?: {
    organization?: {
      id?: string
      publicKey?: string
      secretKey?: string
    }
  }
  [key: string]: unknown
}

export type Member = typeof member.$inferSelect & {
  user: typeof user.$inferSelect
}

/* -------------------------------------------------------------------------- */
/* API keys (app-level, hand-rolled: randomBytes(24) + SHA-256, prefix "omk")   */
/* -------------------------------------------------------------------------- */

export const apiKeys = pgTable(
  "api_keys",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    name: varchar("name", { length: 256 }).notNull(),
    start: varchar("start", { length: 256 }),
    prefix: varchar("prefix", { length: 256 }),
    key: varchar("key", { length: 256 }).notNull(),
    userId: varchar("user_id", { length: 256 }).notNull(),
    refillInterval: integer("refill_interval"),
    refillAmount: integer("refill_amount"),
    lastRefillAt: timestamp("last_refill_at"),
    enabled: boolean("enabled").default(true).notNull(),
    rateLimitEnabled: boolean("rate_limit_enabled").default(true).notNull(),
    rateLimitTimeWindow: integer("rate_limit_time_window").notNull(),
    rateLimitMax: integer("rate_limit_max").notNull(),
    requestCount: integer("request_count").notNull(),
    remaining: integer("remaining"),
    lastRequest: timestamp("last_request"),
    expiresAt: timestamp("expires_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    permissions: text("permissions"),
    metadata: jsonb("metadata"),
  },
  (table) => [index("apiKeys_userId_idx").on(table.userId)]
)

/* -------------------------------------------------------------------------- */
/* Payments                                                                   */
/* -------------------------------------------------------------------------- */

export const payment = pgTable(
  "payment",
  {
    id: text("id").primaryKey(),
    priceId: text("price_id").notNull(),
    type: text("type").notNull(),
    interval: text("interval"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    customerId: text("customer_id").notNull(),
    subscriptionId: text("subscription_id"),
    status: text("status").notNull(),
    periodStart: timestamp("period_start"),
    periodEnd: timestamp("period_end"),
    cancelAtPeriodEnd: boolean("cancel_at_period_end"),
    trialStart: timestamp("trial_start"),
    trialEnd: timestamp("trial_end"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [index("payment_userId_idx").on(table.userId)]
)

/**
 * Order lifecycle. Money is only ever moved by `settleRechargeOrder`, which
 * both the provider webhook and admin bank-transfer reconciliation call.
 */
export type RechargeOrderStatus =
  | "pending"
  | "pending_transfer"
  | "paid"
  | "expired"
  | "closed"
  | "failed"

export type RechargeOrderType = "recharge" | "bank_transfer" | "wechat" | "alipay"

export const rechargeOrders = pgTable(
  "recharge_orders",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    orderId: text("order_id").notNull().unique(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
    credits: decimal("credits", { precision: 10, scale: 2 }).default("0").notNull(),
    currency: varchar("currency", { length: 3 }).default("CNY").notNull(),
    paymentMethod: varchar("payment_method", { length: 20 }).notNull(),
    status: varchar("status", { length: 20 })
      .$type<RechargeOrderStatus>()
      .default("pending")
      .notNull(),
    paymentUrl: text("payment_url"),
    qrCode: text("qr_code"),
    thirdPartyOrderId: text("third_party_order_id"),
    expiresAt: timestamp("expires_at").notNull(),
    paidAt: timestamp("paid_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    webhookReceived: boolean("webhook_received").default(false),
    webhookData: jsonb("webhook_data"),
    remark: text("remark"),
    type: varchar("type", { length: 20 })
      .$type<RechargeOrderType>()
      .default("recharge")
      .notNull(),
    ip: text("ip"),
    userAgent: text("user_agent"),
  },
  (table) => [index("rechargeOrders_userId_idx").on(table.userId)]
)


export const bankTransferVouchers = pgTable(
  "bank_transfer_vouchers",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    orderId: text("order_id").notNull().unique(),
    remittanceCode: text("remittance_code").notNull().unique(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
    payerName: text("payer_name"),
    voucherUrl: text("voucher_url"),
    status: varchar("status", { length: 20 }).default("pending").notNull(),
    reviewedBy: text("reviewed_by"),
    reviewedAt: timestamp("reviewed_at"),
    rejectReason: text("reject_reason"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("bankTransferVouchers_userId_idx").on(table.userId),
    index("bankTransferVouchers_status_idx").on(table.status),
    index("bankTransferVouchers_remittanceCode_idx").on(table.remittanceCode),
  ]
)

/* -------------------------------------------------------------------------- */
/* Newsletter                                                                 */
/* -------------------------------------------------------------------------- */

export const newsletterSubscription = pgTable("newsletter_subscription", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
  subscribed: boolean("subscribed").default(true).notNull(),
  utmSource: text("utm_source"),
  utmMedium: text("utm_medium"),
  utmCampaign: text("utm_campaign"),
  utmTerm: text("utm_term"),
  utmContent: text("utm_content"),
  referrer: text("referrer"),
  userAgent: text("user_agent"),
  ipAddress: text("ip_address"),
  source: text("source"),
  lastEmailSentAt: timestamp("last_email_sent_at"),
  emailSentCount: integer("email_sent_count").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  subscribedAt: timestamp("subscribed_at").defaultNow().notNull(),
  unsubscribedAt: timestamp("unsubscribed_at"),
})

/* -------------------------------------------------------------------------- */
/* OAuth device-code / authorization-code flow (MCP + A2A installs)            */
/* -------------------------------------------------------------------------- */

export const oauthDeviceCodes = pgTable(
  "oauth_device_codes",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    deviceCode: text("device_code").notNull().unique(),
    userCode: text("user_code").notNull().unique(),
    clientId: text("client_id").notNull(),
    scope: text("scope"),
    status: varchar("status", {
      length: 20,
      enum: ["pending", "authorized", "denied"],
    })
      .default("pending")
      .notNull(),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("oauthDeviceCodes_userId_idx").on(table.userId)]
)

export type OAuthDeviceCode = typeof oauthDeviceCodes.$inferSelect
export type NewOAuthDeviceCode = typeof oauthDeviceCodes.$inferInsert

export const oauthTokens = pgTable(
  "oauth_tokens",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    tokenHash: text("token_hash").notNull().unique(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    clientId: text("client_id").notNull(),
    scope: text("scope"),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("oauthTokens_userId_idx").on(table.userId)]
)

export type OAuthToken = typeof oauthTokens.$inferSelect
export type NewOAuthToken = typeof oauthTokens.$inferInsert

export const oauthAuthorizationCodes = pgTable(
  "oauth_authorization_codes",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    code: text("code").notNull().unique(),
    clientId: text("client_id").notNull(),
    redirectUri: text("redirect_uri").notNull(),
    scope: text("scope"),
    state: text("state"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    codeChallenge: text("code_challenge"),
    codeChallengeMethod: varchar("code_challenge_method", { length: 10 }),
    expiresAt: timestamp("expires_at").notNull(),
    used: boolean("used").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("oauthAuthorizationCodes_userId_idx").on(table.userId)]
)

export type OAuthAuthorizationCode = typeof oauthAuthorizationCodes.$inferSelect
export type NewOAuthAuthorizationCode =
  typeof oauthAuthorizationCodes.$inferInsert

export const oauthClients = pgTable("oauth_clients", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  clientId: text("client_id").notNull().unique(),
  clientSecret: text("client_secret"),
  clientName: text("client_name").notNull(),
  redirectUris: text("redirect_uris")
    .array()
    .notNull(),
  grantTypes: text("grant_types")
    .array()
    .notNull(),
  scope: text("scope"),
  clientType: varchar("client_type", {
    length: 20,
    enum: ["public", "confidential"],
  })
    .default("public")
    .notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
})

export type OAuthClient = typeof oauthClients.$inferSelect
export type NewOAuthClient = typeof oauthClients.$inferInsert
