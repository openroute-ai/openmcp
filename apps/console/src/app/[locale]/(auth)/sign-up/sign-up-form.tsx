"use client"

import { useState } from "react"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { LocaleLink } from "@/i18n/navigation"
import { useLocaleRouter } from "@/i18n/navigation"
import { authClient } from "@/lib/auth-client"
import { AuthDivider, GitHubButton } from "@/components/github-button"
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

export function SignUpForm({ githubEnabled }: { githubEnabled: boolean }) {
  const t = useTranslations("Auth")
  const router = useLocaleRouter()
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    await authClient.signUp.email(
      { name, email, password },
      {
        onSuccess: () => {
          toast.success(t("accountCreated"))
          router.push("/dashboard")
          router.refresh()
        },
        onError: (ctx) => {
          setError(ctx.error.message)
        },
      }
    )

    setLoading(false)
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
              <GitHubButton />
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
              href="/sign-in"
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
