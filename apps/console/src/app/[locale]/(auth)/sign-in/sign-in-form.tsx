"use client"

import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import {
  IconAt,
  IconDeviceMobile,
  IconLoader2,
  IconPhone,
  IconSend,
} from "@tabler/icons-react"
import { LocaleLink, useLocaleRouter } from "@/i18n/navigation"
import { authClient } from "@/lib/auth-client"
import { SmsSliderCaptcha } from "@workspace/sms-captcha/client"
import { AuthDivider, GitHubButton } from "@/components/github-button"
import { EmailVerificationForm } from "@/components/auth/email-verification-form"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  Field,
  FieldLabel,
  FieldError,
  FieldGroup,
} from "@workspace/ui/components/field"
import { Spinner } from "@workspace/ui/components/spinner"
import { cn } from "@workspace/ui/lib/utils"
import { authErrorMessage } from "@/lib/auth/auth-error"
import { landingPathFor } from "@/lib/auth/role"
import { withCallback } from "@/lib/auth/callback"

const PHONE_REGEX = /^1[3-9]\d{9}$/

/**
 * `callbackURL` 来自 URL，页面已经用 `safeCallbackPath` 过滤过（见 `page.tsx`），
 * 所以这里可以放心地把它喂给 `router.push` / GitHub 的 OAuth 回跳 / 注册页链接。
 * 不带它时行为与原来一致：落点由角色决定（`landingPathFor`）或回到根路径。
 */
export function SignInForm({
  githubEnabled,
  callbackURL,
}: {
  githubEnabled: boolean
  callbackURL?: string
}) {
  const t = useTranslations("Auth")
  const router = useLocaleRouter()
  const [mode, setMode] = useState<"email" | "phone">("email")
  const [error, setError] = useState<string | null>(null)

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)

  const [phone, setPhone] = useState("")
  const [code, setCode] = useState("")
  const [sending, setSending] = useState(false)
  const [countdown, setCountdown] = useState(0)
  const [codeSent, setCodeSent] = useState(false)
  const [captchaOpen, setCaptchaOpen] = useState(false)
  const [phoneError, setPhoneError] = useState<string | null>(null)
  const [codeError, setCodeError] = useState<string | null>(null)

  // An address that has an account but was never proven: better-auth refuses the
  // sign-in, and the fix is a code rather than a different password.
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null)

  const validPhone = PHONE_REGEX.test(phone)

  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown((c) => c - 1), 1000)
      return () => clearTimeout(timer)
    }
  }, [countdown])

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    await authClient.signIn.email(
      { email, password },
      {
        onSuccess: ({ data }) => {
          toast.success(t("signInSuccess"))
          // Where an account belongs is a function of its role, and the role
          // comes back on the sign-in response — so the right console is one
          // navigation away rather than a bounce through the root redirect.
              router.push(callbackURL ?? landingPathFor(data?.user))
          router.refresh()
        },
        onError: (ctx) => {
          if (ctx.error?.code === "EMAIL_NOT_VERIFIED") {
            setUnverifiedEmail(email)
            return
          }
          setError(authErrorMessage(ctx.error, t, t("signInFailed")))
        },
      }
    )

    setLoading(false)
  }

  const handleCaptchaVerified = useCallback(
    async (captchaToken: string) => {
      setError(null)
      setPhoneError(null)
      setSending(true)
      try {
        const { error: err } = await authClient.phoneNumber.sendOtp(
          { phoneNumber: phone },
          {
            headers: { "x-temp-captcha-token": captchaToken },
          }
        )
        if (err) {
          setError(authErrorMessage(err, t, t("codeSendFailed")))
        } else {
          setCodeSent(true)
          setCountdown(60)
          toast.success(t("codeSent"))
        }
      } catch {
        setError(t("codeSendFailed"))
      } finally {
        setSending(false)
      }
    },
    [phone, t]
  )

  async function handlePhoneSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setPhoneError(null)
    setCodeError(null)
    setLoading(true)

    try {
      const { error: err } = await authClient.phoneNumber.verify({
        phoneNumber: phone,
        code,
      })
      if (err) {
        setCodeError(authErrorMessage(err, t, t("codeWrong")))
      } else {
        toast.success(t("signInSuccess"))
        // The root rather than a console: with `signUpOnVerification` this call
        // may have created the account, and it does not hand back the user it
        // signed in, so the role is only knowable from the session. The root
        // resolves it and redirects on, which is the same answer one hop later.
        router.push(callbackURL ?? "/")
        router.refresh()
      }
    } catch {
      setCodeError(t("signInFailed"))
    } finally {
      setLoading(false)
    }
  }

  // Resend is held down by the countdown alone: `codeSent` only opens the code
  // field. Gating on it too left the button disabled forever after the first
  // send, which made the countdown above pointless.
  const canSendCode = countdown === 0 && !sending && validPhone

  if (unverifiedEmail) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("verifyEmailTitle")}</CardTitle>
          <CardDescription>
            {t("verifyEmailDescription", { email: unverifiedEmail })}
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4 pb-6">
          <EmailVerificationForm
            email={unverifiedEmail}
            onBack={() => {
              setUnverifiedEmail(null)
              setError(null)
            }}
            onVerified={async () => {
              // The reason sign-in failed is now gone, so the same credentials
              // are retried rather than asked for again.
              const { data, error: retryError } = await authClient.signIn.email({
                email: unverifiedEmail,
                password,
              })

              if (retryError) {
                setUnverifiedEmail(null)
                setError(authErrorMessage(retryError, t, t("signInFailed")))
                return
              }

              toast.success(t("verifyEmailSuccess"))
          router.push(callbackURL ?? landingPathFor(data?.user))
              router.refresh()
            }}
          />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("signInTitle")}</CardTitle>
        <CardDescription>{t("signInDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 pb-0">
        {githubEnabled && (
          <>
            <GitHubButton callbackURL={callbackURL} />
            <AuthDivider />
          </>
        )}

        <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1 text-sm">
          <button
            type="button"
            onClick={() => {
              setMode("email")
              setError(null)
            }}
            className={cn(
              "flex cursor-pointer items-center justify-center gap-1.5 rounded-md px-3 py-1.5 transition-colors",
              mode === "email"
                ? "bg-background font-medium text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <IconAt className="size-4" />
            {t("emailTab")}
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("phone")
              setError(null)
            }}
            className={cn(
              "flex cursor-pointer items-center justify-center gap-1.5 rounded-md px-3 py-1.5 transition-colors",
              mode === "phone"
                ? "bg-background font-medium text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <IconPhone className="size-4" />
            {t("phoneTab")}
          </button>
        </div>
      </CardContent>

      {mode === "email" ? (
        <form onSubmit={handleEmailSubmit}>
          <CardContent className="pt-4 pb-6">
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="email">{t("email")}</FieldLabel>
                <Input
                  id="email"
                  type="email"
                  placeholder={t("emailPlaceholder")}
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={loading}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="password">{t("password")}</FieldLabel>
                <Input
                  id="password"
                  type="password"
                  placeholder={t("passwordPlaceholder")}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  disabled={loading}
                />
              </Field>
              {error && <FieldError>{error}</FieldError>}
            </FieldGroup>
          </CardContent>
          <CardFooter className="flex flex-col gap-3">
            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Spinner />}
              {t("signIn")}
            </Button>
          </CardFooter>
        </form>
      ) : (
        <form onSubmit={handlePhoneSubmit}>
          <CardContent className="flex flex-col gap-4 pt-4 pb-6">
            <Field>
              <FieldLabel htmlFor="phone">{t("phone")}</FieldLabel>
              <div className="relative">
                <IconDeviceMobile className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="phone"
                  type="tel"
                  inputMode="numeric"
                  placeholder={t("phonePlaceholder")}
                  autoComplete="tel-national"
                  value={phone}
                  onChange={(e) => {
                    setPhone(e.target.value.replace(/\D/g, ""))
                    setCodeSent(false)
                    // A new number is a new request; the previous number's
                    // cooldown must not hold its resend button down.
                    setCountdown(0)
                    setPhoneError(null)
                  }}
                  disabled={sending || loading}
                  className="pl-10"
                />
              </div>
              {phoneError && <FieldError>{phoneError}</FieldError>}
            </Field>
            <Field>
              <FieldLabel htmlFor="code">{t("code")}</FieldLabel>
              <div className="flex items-center gap-4">
                <Input
                  id="code"
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder={t("codePlaceholder")}
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(e) => {
                    setCode(e.target.value.replace(/\D/g, ""))
                    setCodeError(null)
                  }}
                  disabled={sending || loading || !codeSent}
                  className="min-w-0 flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={!canSendCode}
                  onClick={() => {
                    if (!validPhone) {
                      setPhoneError(t("phoneInvalid"))
                      return
                    }
                    setCaptchaOpen(true)
                  }}
                  className="h-10 shrink-0 px-3"
                >
                  {sending ? (
                    <IconLoader2 className="size-4 animate-spin" />
                  ) : countdown > 0 ? (
                    t("countdown", { count: countdown })
                  ) : (
                    <>
                      <IconSend className="size-4" />
                      {t("sendCode")}
                    </>
                  )}
                </Button>
              </div>
              {codeError && <FieldError>{codeError}</FieldError>}
              {error && <FieldError>{error}</FieldError>}
            </Field>
          </CardContent>
          <CardFooter className="flex flex-col gap-3">
            <Button
              type="submit"
              className="w-full"
              disabled={loading || !codeSent || !code}
            >
              {loading && <Spinner />}
              {t("signIn")}
            </Button>
          </CardFooter>
        </form>
      )}

      <CardFooter className="flex flex-col gap-1">
        <p className="text-center text-sm text-muted-foreground">
          {t("noAccount")}{" "}
          <LocaleLink
            href={withCallback("/sign-up", callbackURL)}
            className="text-primary underline underline-offset-4 hover:text-primary/80"
          >
            {t("signUp")}
          </LocaleLink>
        </p>
      </CardFooter>

      {mode === "phone" && (
        <SmsSliderCaptcha
          open={captchaOpen}
          onOpenChange={setCaptchaOpen}
          i18n={{
            title: t("captchaTitle"),
            hint: t("captchaHint"),
            codeSent: t("codeVerified"),
          }}
          onVerified={handleCaptchaVerified}
        />
      )}
    </Card>
  )
}
