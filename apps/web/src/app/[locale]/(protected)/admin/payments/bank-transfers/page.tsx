import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { BankTransferAdmin } from '@/components/recharge/bank-transfer-admin'

export const dynamic = 'force-dynamic'

/**
 * Bank-transfer reconciliation console.
 *
 * The page is guarded here for a fast redirect, but the real authorization is
 * `adminProcedure` on every mutation — an unauthenticated caller reaching this
 * URL gets no data and cannot move money.
 */
export default async function AdminBankTransferPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return null
  }
  const role = (session.user as { role?: unknown }).role
  if (role !== 'admin') {
    return null
  }

  return <BankTransferAdmin />
}
