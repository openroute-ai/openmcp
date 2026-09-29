import type { User } from 'better-auth'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * Payment state interface
 */
interface PaymentState {
  // 用户余额信息
  accountBalance: number
  creditsBalance: number
  // // Current plan
  // currentPlan: PricePlan | null;
  // // Active subscription
  // subscription: Subscription | null;
  // Loading state
  isLoading: boolean
  // Error state
  error: string | null

  // Actions
  fetchPayment: (user: User | null | undefined) => Promise<void>
  resetState: () => void

  // Actions
  setAccountBalance: (balance: number) => void
  setCreditsBalance: (balance: number) => void
}

/**
 * Payment store using Zustand
 * Manages the user's payment and subscription data globally
 */
export const usePaymentStore = create<PaymentState>()(
  persist(
    (set, get) => ({
      // 初始状态
      accountBalance: 0,
      creditsBalance: 0,
      currentPlan: null,
      subscription: null,
      isLoading: false,
      error: null,

      /**
       * Fetch payment and subscription data for the current user
       * @param user Current user from auth session
       */
      fetchPayment: async (user) => {
        // Skip if already loading
        if (get().isLoading) return
      },

      /**
       * Reset payment state
       */
      resetState: () => {
        set({
          // currentPlan: null,
          // subscription: null,
          isLoading: false,
          error: null,
        })
      },

      // Actions
      setAccountBalance: (balance) => set({ accountBalance: balance }),

      setCreditsBalance: (balance) => set({ creditsBalance: balance }),
    }),
    {
      name: 'payment-store',
      // 只持久化用户余额信息，不持久化订单状态
      partialize: (state) => ({
        accountBalance: state.accountBalance,
        creditsBalance: state.creditsBalance,
      }),
    }
  )
)

// 选择器 hooks
export const useAccountBalance = () => usePaymentStore((state) => state.accountBalance)
export const useCreditsBalance = () => usePaymentStore((state) => state.creditsBalance)
// export const useCurrentPlan = () =>
//   usePaymentStore((state) => state.currentPlan);
// export const useSubscription = () =>
//   usePaymentStore((state) => state.subscription);
export const usePaymentLoading = () => usePaymentStore((state) => state.isLoading)
export const usePaymentError = () => usePaymentStore((state) => state.error)

// Action hooks - return individual functions to avoid object recreation
export const useFetchPayment = () => usePaymentStore((state) => state.fetchPayment)
export const useResetState = () => usePaymentStore((state) => state.resetState)
