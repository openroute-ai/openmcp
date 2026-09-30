# Provider Onboarding Redesign

> Scope: `apps/openmcp` provider onboarding flow (`/provider/onboarding`, `/provider/onboarding/individual`, `/provider/onboarding/company`).  
> Branch: `develop-mcp`. Goal: unified wizard + read-only pending + entity-aware success page.

## Goals

1. **Unified entry**: `/provider/onboarding` acts as wizard hub with step indicator.
2. **Entity-aware flow**: individual (Skills only) vs company (Skills + MCP + A2A).
3. **Read-only pending**: lock UI when `verificationStatus === 'pending'`; mask sensitive data.
4. **Success branching**: show entity-appropriate CTAs after `verified`.
5. **No premature freeze**: personal→company upgrade pending should **not** freeze existing Skills.
6. **No forced payout**: success page offers secondary payout CTA; paid assets later require `payChannelStatus === ready`.

## Locked product decisions (do not reopen)

| Decision | Status |
|----------|--------|
| Skills eligibility | `verificationStatus === verified` (individual **or** company) |
| MCP/A2A eligibility | **Company entity only** (Batch D server-side gate) |
| Main path | `/provider/onboarding` |
| Sidebar link | Dashboard **发布** group → `入驻与收款` |
| Personal→company upgrade | Do **not** freeze existing Skills during pending |
| Success payout | Secondary CTA; do **not** force bind before leaving |
| Enterprise + org history | Batches B/C (out of A scope) |
| Better-auth Organization | Batches B/C (out of A scope) |
| Payout P0 vs P1 | Batches E/F (doc only) |
| Active org switch | Batch C switches `activeOrganizationId` to company after verified |

## Onboarding states

| State | `verificationStatus` | UI treatment |
|-------|---------------------|--------------|
| **Unverified / no profile** | `null` or `'unverified'` | Step 1: choose entity type; Step 2: fill forms |
| **Pending** | `'pending'` | **Read-only** view: amber banner, locked, submitted summary, doc thumbnails, hide subject cards/edit/payout bind/publish links |
| **Verified** | `'verified'` | Success panel: entity-branched CTAs (individual: Skills+payout secondary+upgrade; company: full publish) |
| **Rejected** | `'rejected'` | Error banner + note + CTA to edit/resubmit form |

## Step indicator

Show on `/provider/onboarding` main page:

```
选主体 → 填资料 → 审核中 → 完成
```

- **Unverified**: highlight 选主体
- **Pending**: highlight 审核中
- **Verified**: highlight 完成
- **Rejected**: back to 填资料 with error

## Pending read-only requirements

### What to show

- **Status banner**: amber 审核中, locked icon, "1–3 business days"
- **Entity meta**: entityType (个人 / 企业), submitted timestamp if available
- **Submitted materials summary**:
  - Contact name (full)
  - ID number (**masked**: show first 3 + last 2 chars, `***` middle)
  - Pay channel type (微信 / 支付宝)
  - Documentation URL (if present)
- **Document thumbnails**: preview-only grid (no upload/delete actions)
- **Footer note**: "资料已提交，审核期间无法编辑"

### What to hide

- Subject choice cards (个人 / 企业)
- 「继续完善」link
- Payout bind card (收款账户绑定)
- `KycPublishLinks` (三大货架发布入口)
- Editable form fields
- Switch individual↔company links
- Submit button (show locked button instead)

### Routing

If user hits `/provider/onboarding/individual` or `/company` while `pending`:

**Option A (preferred)**: Redirect to `/provider/onboarding` and show unified read-only view.  
**Option B**: Show same read-only view on each route.

## Verified success page

### Individual entity

```
✅ 个人实名认证已通过

【上传 Skill】 (primary CTA) → /skills/submit
【绑定收款账户】 (secondary) → /provider/payout
【查看我的 Skills】 → /dashboard/assets/skills

💡 升级企业主体
想发布 MCP Server 或 A2A Agent？完成企业实名认证即可。
【去企业认证】 → /provider/onboarding/company
```

Disable/ghost MCP and A2A cards with "企业主体专享" badge.

### Company entity

```
✅ 企业实名认证已通过

【发布 MCP Server】 → /mcp/submit
【发布 A2A Agent】 → /a2a/submit
【发布 Skill】 → /skills/submit
【绑定收款账户】 (secondary) → /provider/payout

【查看我的资产】
- MCP → /dashboard/assets/mcp
- A2A → /dashboard/assets/a2a
- Skills → /dashboard/assets/skills
```

All publish links enabled.

## Rejected state

Show on `/provider/onboarding`:

```
❌ 实名认证未通过

审核备注：{profile.verificationNote}

【修改资料重新提交】 → /provider/onboarding/individual | /company (based on entityType)
```

Form should be editable again; user can fix issues and resubmit.

## Component architecture

### Before (Batch A−1)

```
OnboardingEntry (page)
├── KycStatusBanner
├── Subject choice cards (个人 / 企业)
├── 「继续完善」link
├── Payout bind card
└── KycPublishLinks

KycIndividualForm (page: /individual)
└── Editable form

KycCompanyForm (page: /company)
└── Editable form
```

### After (Batch A)

```
OnboardingEntry (page)
├── StepIndicator
├── (status branch)
│   ├── UnverifiedView → subject choice cards
│   ├── OnboardingPendingReadonly → masked summary + doc thumbnails
│   ├── OnboardingSuccess → entity-branched CTAs
│   └── RejectedView → note + edit CTA

KycIndividualForm (standalone page: /individual OR embedded Step 2)
└── Editable form (when not pending)

KycCompanyForm (standalone page: /company OR embedded Step 2)
└── Editable form (when not pending)
```

**Batch A decision**: Keep `/individual` and `/company` as standalone routes; embed/navigate TBD in Batch B refinement.

### New components (Batch A)

| Component | File | Responsibility |
|-----------|------|----------------|
| `StepIndicator` | `kyc-shared.tsx` | 4-step visual progress |
| `OnboardingPendingReadonly` | `onboarding-pending-readonly.tsx` | Read-only pending view |
| `OnboardingSuccess` | `onboarding-success.tsx` | Entity-branched success CTAs |
| `MaskedIdNumber` | `kyc-shared.tsx` | Utility: mask ID (e.g. `320***12`) |

### Refactored components (Batch A)

| Component | Changes |
|-----------|---------|
| `OnboardingEntry` | Add step indicator, branch by status, route to new views |
| `KycStatusBanner` | Enhance pending description (1–3 days) |
| `KycPublishLinks` | Hidden during pending (moved to success page) |
| `KycIndividualForm` / `KycCompanyForm` | No change (already locked when pending) |

## Permissions matrix (all batches)

| Asset type | Individual verified | Company verified | Enforced where |
|------------|-------------------|------------------|----------------|
| **Skills** | ✅ | ✅ | Submit form + API (`verificationStatus === 'verified'`) |
| **MCP Server** | ❌ | ✅ | Batch D server-side gate (`entityType === 'company' && verified`) |
| **A2A Agent** | ❌ | ✅ | Batch D server-side gate (same as MCP) |
| **Paid assets** | ✅ (if `payChannelStatus === 'ready'`) | ✅ (if `payChannelStatus === 'ready'`) | Submit form checks payout binding |

## Payout flow (P0 vs P1)

### Batch A (P0 — current)

- User picks `payChannelType` (wechat / alipay) in onboarding form.
- User goes to `/provider/payout` to bind actual account (QR, account name).
- `payChannelStatus` → `'ready'` when bound.
- Paid assets blocked until `payChannelStatus === 'ready'`.

### Batch E/F (P1 — future)

- Auto-generate payout QR from submitted `payChannelType` + contact info.
- Show QR on success page; user can edit via `/provider/payout`.
- Server validates QR scan before marking `payChannelStatus === 'ready'`.
- Out of scope for Batch A.

## Organization & history (Batches B/C)

### Current state (Batch A−)

- No better-auth Organization support.
- No team member management.
- No entity upgrade history tracking.
- Single-user provider profile per `userId`.

### Batch B/C (future)

- Integrate better-auth `Organization` for company entities.
- Switch `activeOrganizationId` to company after company verified (Batch C).
- Track entity upgrade history (`personalEntityId` → `companyEntityId`).
- Support team member invites under company org.
- Out of scope for Batch A; mention in doc only.

## Dashboard linkage

### Sidebar (already done in Console Dashboard UED)

**发布** group → `入驻与收款` → `/provider/onboarding`

Hidden when user not verified provider.

### Entry points to onboarding

| From | When | CTA text |
|------|------|----------|
| Dashboard sidebar | Always (if logged in) | 入驻与收款 |
| MCP submit page | Not company verified | 完成企业认证 |
| A2A submit page | Not company verified | 完成企业认证 |
| Skills submit page | Not verified (any entity) | 完成提供者认证 |

## i18n

Chinese primary UI; update `messages/en.json` if new keys added.

## Testing checklist

- [ ] Unverified user sees subject choice cards
- [ ] Pending user sees read-only view with masked ID
- [ ] Pending view hides subject cards, payout bind, publish links, 「继续完善」
- [ ] Verified individual sees Skills CTA (primary) + upgrade CTA
- [ ] Verified company sees all three publish CTAs
- [ ] Rejected user sees note + edit CTA
- [ ] Direct `/individual` or `/company` route during pending redirects to `/provider/onboarding`
- [ ] Step indicator highlights correct step
- [ ] Document thumbnails display in pending view (preview only)

## Batches summary

| Batch | Theme | Key deliverables | Status |
|-------|-------|------------------|--------|
| **A** (this PR) | Wizard + pending read-only + success branching | Design doc, `StepIndicator`, `OnboardingPendingReadonly`, `OnboardingSuccess`, refactor `OnboardingEntry` | ✅ Done (commit ~363e8521) |
| **B** | Better-auth org + KYC history | `organizationId` on `provider_profiles`; `provider_kyc_submissions` table with immutable audit trail; `listMyKycSubmissions` tRPC endpoint; admin review updates submission status | ✅ Done (migration `0009_provider_kyc_history.sql`, schema/logic/router updated ~431afe35) |
| **C** | Active org switch + upgrade path | `organization.metadata.kind` (personal/company); auto-bind personal org on individual submit; create/use company org on company submit; upgrade flow with supersede; switch `activeOrganizationId` on company verified | ✅ Done (migration `0010_provider_org_kind.sql`, schema types, `ensurePersonalOrganization`, `ensureCompanyOrganization`, admin review hooks) |
| **D** | Server-side MCP/A2A gate | Enforce `entityType === 'company'` for MCP/A2A submit APIs | ✅ Done (PR #2, commit ~57c4de92) |
| **E** | Payout P0 convenience | Dual channels (wechat+alipay save both), prefill accountName from KYC, QR upload, account+QR XOR-or-either validation, UX guides, default channel selection | ✅ Done (types/logic/UI/router updated) |
| **F** | Payout OAuth bind (P1) | WeChat/Alipay merchant OAuth authorize bind | Pending (out of scope for P0) |

## Batch B implementation details

### Schema changes (migration `0009_provider_kyc_history.sql`)

1. **`provider_profiles.organization_id`**
   - Type: `text` (nullable FK → `organization.id`)
   - Index: `provider_profiles_org_idx`
   - Purpose: 关联 better-auth Organization（企业主体用）

2. **`provider_kyc_submissions`** table
   - `id` (text PK)
   - `user_id` (FK → user.id, NOT NULL)
   - `organization_id` (FK → organization.id, nullable)
   - `entity_type` (varchar(20), enum: 'individual'|'company')
   - `status` (varchar(20), default 'pending', enum: 'pending'|'verified'|'rejected'|'superseded')
   - `payload` (jsonb, NOT NULL) — snapshot of submitted fields + doc URLs
   - `verification_note` (text)
   - `reviewed_by` (FK → user.id, nullable)
   - `reviewed_at` (timestamp)
   - `supersedes_id` (FK → provider_kyc_submissions.id, nullable)
   - `created_at`, `updated_at`
   - Indexes: `user_idx`, `org_idx`, `status_idx`, `created_at_idx`

### Write path

- **On KYC submit** (`providers.upsertProfile`):
  - When `isCompleteSubmission()` returns true, INSERT new submission row with `status='pending'`
  - `payload` contains full snapshot: `entityType`, `companyName`, `contactName`, `idNumber`, `documentationUrl`, `payChannelType`, `kycDocuments`, `submittedAt`
  - Update `provider_profiles` current fields + `verificationStatus='pending'`
  - Never overwrite prior submission rows (immutable audit trail)

- **On admin review** (`adminProviders.reviewApplication`):
  - Find latest `pending` submission for the userId
  - Update submission: `status` → 'verified'|'rejected', `verificationNote`, `reviewedBy`, `reviewedAt`
  - Sync `provider_profiles.verificationStatus` to match
  - **Superseding logic**: When personal→company upgrade lands (Batch C), mark old individual submission `superseded` only when new company becomes verified

### Read path

- **`providers.listMyKycSubmissions`** tRPC query:
  - Returns user's own submission history ordered by `createdAt`
  - Payload fields exposed as `summary` with masked `idNumber` (first 3 + last 2 chars, `***` middle)
  - Returns: `id`, `entityType`, `status`, `verificationNote`, `reviewedAt`, `createdAt`, `summary` (redacted)

- Pending/success UI continues reading `provider_profiles` current fields
- Optional: future Dashboard can call `listMyKycSubmissions` to show history timeline

## Batch E implementation details

### Payout P0 convenience enhancements

**Goal**: Improve payout binding UX without merchant OAuth (P1 deferred).

**Key changes**:

1. **Dual channel support** (`metadata.payoutAccounts`):
   - Structure: `{ wechat?: PayoutAccount, alipay?: PayoutAccount }`
   - `PayoutAccount = { account?: string, accountName?: string, qrUrl?: string, updatedAt?: string }`
   - User can save both WeChat and Alipay
   - `payChannelType` on `provider_profiles` indicates default settlement channel

2. **Account name prefill** (`updatePayChannel` logic):
   - If `accountName` not provided in input, auto-prefill from KYC:
     - Company entity: `companyName`
     - Individual entity: `contactName`
   - User can override if needed

3. **QR upload**:
   - Use existing `KycDocUpload` component (reuse `uploadFileFromBrowser` from `@/storage`)
   - Upload folder: `openmcp/payout-qr`
   - Supported formats: JPG, PNG, WEBP
   - Store `qrUrl` in `metadata.payoutAccounts[channel]`

4. **Validation** (`hasPayoutAccount` function):
   - **XOR-or-either rule**: `account` OR `qrUrl` must be present (at least one)
   - Front-end: Zod refine to check `account || qrUrl`
   - Back-end: throw error if neither present

5. **Default channel selection** (`isDefault` input):
   - When saving a channel, user can choose to set it as default
   - If `isDefault=true`, set `payChannelType = input.payChannelType`
   - If `isDefault=false`, keep existing `payChannelType`
   - `payChannelStatus = 'ready'` only if default channel has valid payout account

6. **UX guides** (`ProviderPayoutForm` UI):
   - **WeChat**: "可填写微信号或绑定的手机号"
   - **Alipay**: "可填写支付宝手机号、邮箱或账号 ID"
   - Show masked account + QR upload status for bound channels
   - Tab UI to switch between WeChat and Alipay
   - Display default channel badge

### Updated files

- `web/providers/index.ts`:
  - `PayChannelInput`: add `qrUrl?: string`, `isDefault?: boolean`; make `account` optional
  - `PayoutAccount`: add `qrUrl?: string`; make `account` optional
  - `hasPayoutAccount`: check `account || qrUrl`
  - `updatePayChannel`: XOR validation, prefill accountName, default channel logic

- `web/providers/router.ts`:
  - `updatePayChannel` input schema: `account` optional, add `qrUrl`, `isDefault`

- `components/provider/provider-payout-form.tsx`:
  - Tabs UI for dual channel switching
  - QR upload via `KycDocUpload`
  - Prefill accountName from KYC
  - Default channel radio buttons
  - Show bound status for each channel
  - UX guides per channel

### Testing checklist

- [ ] Save WeChat account only → `payChannelStatus = 'ready'` if default
- [ ] Save Alipay account only → `payChannelStatus = 'ready'` if default
- [ ] Save both channels → default channel shows badge
- [ ] Upload QR without account → validates & saves
- [ ] Upload account without QR → validates & saves
- [ ] Submit neither account nor QR → validation error
- [ ] AccountName auto-prefills from KYC (individual: contactName, company: companyName)
- [ ] Switch default channel → `payChannelType` updates
- [ ] Bound channels display masked account + QR status
- [ ] UX guides show correct instructions per channel

## Batch C implementation details

### Schema changes (migration `0010_provider_org_kind.sql`)

Uses **`organization.metadata`** (jsonb, already present in better-auth schema) to store:

```typescript
type OrganizationMetadata = {
  kind?: 'personal' | 'company'
  kycSummary?: {
    contactName?: string
    companyName?: string
    verifiedAt?: string
  }
  langfuse?: { ... }
  [key: string]: unknown
}
```

- **No new columns added** to avoid invasive better-auth table changes
- `kind='personal'`: user's default personal organization (auto-created by better-auth on signup)
- `kind='company'`: company organization created during company KYC submission
- `kycSummary`: optional snapshot of verified KYC details for display

### Organization binding logic

**`ensurePersonalOrganization(userId, userName, userEmail)`** (in `web/providers/index.ts`):
- Finds user's first member organization
- Sets `metadata.kind = 'personal'` if not yet set
- Creates new personal org if none exists (fallback for edge cases)
- Returns personal org ID

**`ensureCompanyOrganization(userId, companyName, contactName)`**:
- Searches for existing company organization (kind='company') among user's memberships
- If found, reuses it (supports re-submit)
- If not found, creates new organization:
  - `name`: companyName
  - `slug`: `{companyName-sanitized}-{userId-prefix}`
  - `metadata.kind = 'company'`
  - `metadata.kycSummary.contactName`, `metadata.kycSummary.companyName`
- Adds user as owner member
- Returns company org ID

### Write path (KYC submission)

**`providersDataAccess.upsertProfile`** (modified):
1. On complete submission (`isCompleteSubmission() === true`):
   - If `entityType === 'individual'`: call `ensurePersonalOrganization`, set `provider_profiles.organizationId`
   - If `entityType === 'company'`: call `ensureCompanyOrganization`, set `provider_profiles.organizationId`
2. Insert `provider_kyc_submissions` row with bound `organizationId`
3. Update `provider_profiles` with `organizationId`

**Upgrade path** (individual → company):
- User submits company KYC while already having verified individual profile
- Personal organization **remains intact** (no deletion, no freeze)
- New company organization created/bound
- During pending, profile stays `entityType='individual'`, `verificationStatus='verified'` for current work (Skills remain accessible)
- Once company submission is also verified, profile flips to `entityType='company'`, `organizationId=companyOrg`

### Admin review hooks (company verified)

**`adminProvidersRouter.reviewApplication`** (modified):
When admin verifies a **company** submission:

1. **Mark prior individual submission as superseded**:
   - Find latest `verified` submission where `entityType='individual'` for this userId
   - Update its `status` to `'superseded'`
   - Set new company submission's `supersedesId` to point back

2. **Update company organization metadata**:
   - Fetch company org by `application.organizationId`
   - Merge `metadata.kycSummary` with verified details:
     ```typescript
     {
       contactName: application.contactName,
       companyName: application.companyName,
       verifiedAt: new Date().toISOString()
     }
     ```

3. **Switch session activeOrganizationId**:
   - Update `session.activeOrganizationId = application.organizationId` for `session.userId = application.userId`
   - User's next page load/session refresh will see company as active org
   - Personal org remains accessible via org switcher (if implemented in Dashboard)

### Settings page integration

**`/settings/organization`** (already present):
- **Personal profile** (`entityType='individual'`):
  - Shows hint: "个人主体,如需企业资质请完成企业入驻"
  - CTA button: "去企业认证" → `/provider/onboarding/company`
- **Company profile** (`entityType='company'`):
  - Shows company name, contact name, documentation URL (editable via `providers.updateOrganizationContact`)
  - Shows verification status

### UI upgrade flow

**Success page** (`OnboardingSuccess.tsx`, line 162-179, already present):
- When `entityType='individual'` and `verificationStatus='verified'`:
  - Displays blue info box: "升级企业主体"
  - Explains: "想发布 MCP Server 或 A2A Agent？完成企业实名认证即可解锁全部发布能力。"
  - CTA: "去企业认证" → `/provider/onboarding/company?upgrade=company`

**Company form** (`KycCompanyForm.tsx`):
- Standard submission flow (no special upgrade parameter handling needed)
- On submit: calls `upsertProfile({ entityType: 'company', ... })`
- Backend detects existing individual profile and handles upgrade automatically

### Key constraints satisfied

✅ **Personal KYC binds to personal org**: `ensurePersonalOrganization` called on individual submit  
✅ **Company KYC creates/uses company org**: `ensureCompanyOrganization` called on company submit  
✅ **Upgrade does NOT freeze Skills**: personal org + profile remain verified during company pending; only after company verified does switch occur  
✅ **Company verified switches activeOrganizationId**: admin review hook updates session  
✅ **History supersede wired**: admin review marks old individual submission `superseded`, sets `supersedesId`  
✅ **Settings shows upgrade CTA**: personal users see "去企业认证" button

## Open questions (resolved)

None. All product decisions locked per brief.

## Non-goals (Batch A)

- ❌ DB history tracking (Batch C)
- ❌ `organizationId` field (Batch B)
- ❌ Server-side MCP/A2A company gate (Batch D)
- ❌ Payout QR auto-gen (Batch E)
- ❌ Team member management (Batch B)
- ❌ Better-auth Organization integration (Batch B)
- ❌ Freeze personal Skills during upgrade (confirmed: do not freeze)
- ❌ Force payout bind before leaving success page (confirmed: secondary CTA only)

---

**Commit message template** (Batch A):

```
feat(provider): redesign onboarding wizard with pending read-only & success branching

- Add full design doc (PROVIDER_ONBOARDING_UED.md) covering Batches A–F
- Implement step indicator (选主体 → 填资料 → 审核中 → 完成)
- Add read-only pending view: amber banner, masked ID, doc thumbnails, hide edit/publish
- Add success view: branch by entityType (individual: Skills+upgrade; company: full publish)
- Refactor OnboardingEntry to route by verificationStatus
- Keep individual/company form routes functional; redirect to /provider/onboarding when pending
- Do not freeze personal Skills during company upgrade (per product decision)
- Do not force payout bind on success page (secondary CTA only)
- Chinese primary UI, en.json updated

Batch A scope; Batches B–F: org integration, history, server gates, payout QR.
```
