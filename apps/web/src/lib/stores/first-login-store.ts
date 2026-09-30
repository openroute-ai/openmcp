import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * Whether to show the first-login welcome banner.
 *
 * `firstLogin.checkFirstLogin` answers "is this a new account?", but not "has
 * this browser already seen the banner?". Only the latter needs to survive a
 * reload, so the dismissal is persisted client-side and keyed by user id —
 * signing in as somebody else on the same browser must not inherit it.
 *
 * The TTL exists so a stale `false` (checked before the account existed, or
 * from an older app version) is re-derived rather than trusted forever.
 */

const CACHE_TTL_MS = 60 * 60 * 1000

interface FirstLoginState {
  /** `null` until the first check resolves, so the banner does not flash. */
  shouldShowPrompt: boolean | null
  userId: string | null
  dismissed: boolean
  lastChecked: number | null

  setFirstLoginStatus: (userId: string, shouldShow: boolean) => void
  dismissPrompt: () => void
  reset: () => void
  /** True when the persisted state can be trusted for `currentUserId`. */
  isCacheValid: (currentUserId: string | null) => boolean
}

export const useFirstLoginStore = create<FirstLoginState>()(
  persist(
    (set, get) => ({
      shouldShowPrompt: null,
      userId: null,
      dismissed: false,
      lastChecked: null,

      setFirstLoginStatus: (userId, shouldShow) => {
        set({
          shouldShowPrompt: shouldShow,
          userId,
          lastChecked: Date.now(),
          // A negative result needs no separate dismissal: it is already hidden.
          dismissed: !shouldShow,
        })
      },

      dismissPrompt: () => set({ dismissed: true, shouldShowPrompt: false }),

      reset: () => set({ shouldShowPrompt: null, userId: null, dismissed: false, lastChecked: null }),

      isCacheValid: (currentUserId) => {
        const state = get()

        if (state.userId !== currentUserId) return false
        if (state.dismissed) return true
        if (state.lastChecked && Date.now() - state.lastChecked > CACHE_TTL_MS) return false

        return true
      },
    }),
    {
      name: 'first-login-store',
      // `shouldShowPrompt` is deliberately not persisted: it is re-derived on
      // every load, and persisting it would let a stale `true` flash.
      partialize: (state) => ({
        dismissed: state.dismissed,
        userId: state.userId,
        lastChecked: state.lastChecked,
      }),
    }
  )
)
