"use client"

import { useState } from "react"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { LocaleLink } from "@/i18n/navigation"
import { useLocaleRouter } from "@/i18n/navigation"
import { authClient } from "@/lib/auth-client"
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
import { authErrorMessage } from "@/lib/auth/auth-error"
import { landingPathFor } from "@/lib/auth/role"
import { withCallback } from "@/lib/auth/callback"

/**
 * 与 `SignInForm` 同一套 `callbackURL` 语义：登录 ↔ 注册互跳时带着它，注册完成后
 * 回到发起这次认证的那一页（结账弹窗会带 `?callbackURL=/?plan=pro`）。
 */
export function SignUpForm({
  githubEnabled,
  callbackURL,
}: {
  githubEnabled: boolean
  callbackURL?: string
}) {
  const t = useTranslations("Auth")
  const router = useLocaleRouter()
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Set once the account exists but its address is unproven: with
  // `requireEmailVerification` the sign-up call creates the user and returns no
  // session, so the form becomes the code step rather than redirecting.
  const [pendingEmail, setPendingEmail] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    await authClient.signUp.email(
      { name, email, password },
      {
        onSuccess: ({ data }) => {
          // `token === null` is the shape of an account awaiting verification,
          // not a failure — `requireEmailVerification` withholds the session on
          // purpose. The code is already in the reader's inbox by now, sent by
          // `emailVerification.sendVerificationEmail` during this very call.
          if (!data?.token) {
            setPendingEmail(data?.user?.email ?? email)
            return
          }
          toast.success(t("accountCreated"))
          // Read from the response rather than hard-coded: the account this
          // creates is an ordinary one, so it belongs on `/console` — unless the
          // reader arrived with a `callbackURL`, in which case that one wins and
          // asking the shared helper means a second sign-up surface cannot
          // disagree.
          router.push(callbackURL ?? landingPathFor(data?.user))
          router.refresh()
        },
        onError: (ctx) => {
          setError(authErrorMessage(ctx.error, t, t("signUpFailed")))
        },
      }
    )

    setLoading(false)
  }

  async function handleVerified() {
    const email = pendingEmail
    if (!email) return

    // The address is proven; the account was created a moment ago with this same
    // password, so signing in here saves the reader retyping it.
    const { data, error: signInError } = await authClient.signIn.email({
      email,
      password,
    })

    if (signInError) {
      setPendingEmail(null)
      setError(authErrorMessage(signInError, t, t("signInFailed")))
      return
    }

    toast.success(t("verifyEmailSuccess"))
    router.push(callbackURL ?? landingPathFor(data?.user))
    router.refresh()
  }

  if (pendingEmail) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("verifyEmailTitle")}</CardTitle>
          <CardDescription>
            {t("verifyEmailDescription", { email: pendingEmail })}
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4 pb-6">
          <EmailVerificationForm
            email={pendingEmail}
            onVerified={handleVerified}
          />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("signUpTitle")}</CardTitle>
        <CardDescription>{t("signUpDescription")}</CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-4 pb-6">
          {githubEnabled && (
            <>
              <GitHubButton callbackURL={callbackURL} />
              <AuthDivider />
            </>
          )}
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="name">{t("name")}</FieldLabel>
              <Input
                id="name"
                placeholder={t("namePlaceholder")}
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                disabled={loading}
              />
            </Field>
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
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                disabled={loading}
              />
            </Field>
            {error && <FieldError>{error}</FieldError>}
          </FieldGroup>
        </CardContent>
        <CardFooter className="flex flex-col gap-3">
          <Button type="submit" className="w-full" disabled={loading}>
            {loading && <Spinner />}
            {t("createAccount")}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            {t("haveAccount")}{" "}
            <LocaleLink
              href={withCallback("/sign-in", callbackURL)}
              className="text-primary underline underline-offset-4 hover:text-primary/80"
            >
              {t("signIn")}
            </LocaleLink>
          </p>
        </CardFooter>
      </form>
    </Card>
  )
}
