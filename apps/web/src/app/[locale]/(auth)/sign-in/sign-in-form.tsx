"use client"

import { useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { signIn } from "@/lib/auth-client"
import { useLocaleRouter } from "@/i18n/navigation"
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

/**
 * Only same-site absolute paths may be used as a post-sign-in destination.
 * Anything protocol-relative (`//evil.com`) or absolute (`https://evil.com`)
 * would turn the sign-in page into an open redirect, so those fall back to "/".
 */
function safeCallbackUrl(value: string | null): string {
  if (!value) return "/"
  if (!value.startsWith("/")) return "/"
  if (value.startsWith("//") || value.startsWith("/\\")) return "/"
  return value
}

export function SignInForm() {
  // Locale-aware router: a plain next/navigation push of a locale-less
  // callbackUrl would bounce a zh user back to the default locale.
  const router = useLocaleRouter()
  const searchParams = useSearchParams()
  const callbackUrl = safeCallbackUrl(searchParams.get("callbackUrl"))
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    await signIn.email(
      { email, password },
      {
        onSuccess: () => {
          toast.success("Signed in successfully")
          router.push(callbackUrl)
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
        <CardTitle>Sign In</CardTitle>
        <CardDescription>
          Enter your credentials to access your account.
        </CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="pb-6">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="email">Email</FieldLabel>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={loading}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="password">Password</FieldLabel>
              <Input
                id="password"
                type="password"
                placeholder="Your password"
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
            Sign In
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            Don&apos;t have an account?{" "}
            <Link
              href="/sign-up"
              className="text-primary underline underline-offset-4 hover:text-primary/80"
            >
              Sign up
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  )
}
