"use client"

/**
 * The "enter the code from your inbox" step.
 *
 * Shared by sign-up and sign-in because both arrive at it the same way: an
 * address that has an account but has never been proven. Sign-up sends the first
 * code itself; sign-in gets here from better-auth's `EMAIL_NOT_VERIFIED`. Two
 * copies of this form would drift, and the second copy is the one that stops
 * matching the endpoint.
 */
import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { IconLoader2, IconSend } from "@tabler/icons-react"

import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field"
import { Spinner } from "@workspace/ui/components/spinner"

const RESEND_COOLDOWN_SECONDS = 60

export function EmailVerificationForm({
  email,
  onVerified,
  onBack,
}: {
  email: string
  /** Called once the address is verified — the parent signs the reader in. */
  onVerified: () => void | Promise<void>
  /** Shown when there is a way back, i.e. sign-in rather than sign-up. */
  onBack?: () => void
}) {
  const t = useTranslations("Auth")
  const [code, setCode] = useState("")
  const [verifying, setVerifying] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [countdown, setCountdown] = useState(0)

  useEffect(() => {
    if (countdown <= 0) return
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000)
    return () => clearTimeout(timer)
  }, [countdown])

  const resend = useCallback(async () => {
    setSending(true)
    setError(null)
    try {
      const response = await fetch("/api/auth/email-code/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      })

      if (response.status === 429) {
        setCountdown(RESEND_COOLDOWN_SECONDS)
        return
      }

      if (!response.ok) {
        setError(t("codeSendFailed"))
        return
      }

      setCountdown(RESEND_COOLDOWN_SECONDS)
      toast.success(t("codeSent"))
    } catch {
      setError(t("codeSendFailed"))
    } finally {
      setSending(false)
    }
  }, [email, t])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setVerifying(true)

    try {
      const response = await fetch("/api/auth/email-code/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code }),
      })

      if (response.status === 429) {
        setError(t("verifyTooManyAttempts"))
        setCode("")
        return
      }

      // 404 means the code was right but no account carries that address: the
      // reader registered under a different one, or never finished signing up.
      if (response.status === 404) {
        setError(t("verifyAccountNotFound"))
        return
      }

      if (!response.ok) {
        setError(t("verifyCodeWrong"))
        setCode("")
        return
      }

      await onVerified()
    } catch {
      setError(t("verifyCodeWrong"))
    } finally {
      setVerifying(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="verify-email">{t("verifyEmail")}</FieldLabel>
          <Input
            id="verify-email"
            type="email"
            value={email}
            disabled
            readOnly
            className="bg-muted"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="verify-code">{t("code")}</FieldLabel>
          <div className="flex items-center gap-4">
            <Input
              id="verify-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder={t("codePlaceholder")}
              value={code}
              onChange={(e) => {
                setCode(e.target.value.replace(/\D/g, ""))
                setError(null)
              }}
              disabled={verifying}
              className="min-w-0 flex-1"
            />
            <Button
              type="button"
              variant="outline"
              disabled={countdown > 0 || sending}
              onClick={resend}
              className="h-10 shrink-0 px-3"
            >
              {sending ? (
                <IconLoader2 className="size-4 animate-spin" />
              ) : countdown > 0 ? (
                t("countdown", { count: countdown })
              ) : (
                <>
                  <IconSend className="size-4" />
                  {t("resendCode")}
                </>
              )}
            </Button>
          </div>
          {error && <FieldError>{error}</FieldError>}
        </Field>
      </FieldGroup>
      <div className="flex flex-col gap-2">
        <Button
          type="submit"
          className="w-full"
          disabled={verifying || code.length !== 6}
        >
          {verifying && <Spinner />}
          {t("verifyEmailSubmit")}
        </Button>
        {onBack && (
          <Button type="button" variant="ghost" onClick={onBack}>
            {t("verifyBack")}
          </Button>
        )}
      </div>
    </form>
  )
}
