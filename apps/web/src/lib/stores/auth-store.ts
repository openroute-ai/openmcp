import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * Which credential the sign-in page is currently presenting.
 *
 * Persisted so a visitor who prefers phone login is not pushed back onto the
 * email form on every navigation. Transient form state deliberately stays out
 * of `partialize` — a stale "code sent" flag from a previous visit would
 * enable the submit button on a fresh page.
 */
export type AuthMode = 'phone' | 'email'

interface AuthState {
  authMode: AuthMode
  setAuthMode: (mode: AuthMode) => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      authMode: 'phone',
      setAuthMode: (mode) => set({ authMode: mode }),
    }),
    {
      name: 'openmcp-auth-store',
      partialize: (state) => ({ authMode: state.authMode }),
    }
  )
)
