"use client"

/**
 * Account settings: avatar, name, email, phone number, password.
 *
 * Five things that need five different mechanisms, which is why this is a form
 * with sections rather than one submit: `name` and `image` are a field update on
 * the session user, the email goes through better-auth's change-email handshake,
 * the phone number through a two-route SMS code, and the password through a
 * server route that picks between `changePassword` and `setPassword`.
 *
 * Each section owns its own state and reports its own result. A reader changing
 * their name should not have their password form cleared, and a failed phone
 * binding should not look like a failed name change.
 */
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import {
  IconCamera,
  IconCheck,
  IconDeviceMobile,
  IconKey,
  IconLoader2,
  IconMail,
  IconSend,
  IconTrash,
  IconUser,
} from "@tabler/icons-react"

import { EmailVerificationForm } from "@/components/auth/email-verification-form"
import { authClient } from "@/lib/auth-client"
import { authErrorMessage } from "@/lib/auth/auth-error"
import { SmsSliderCaptcha } from "@workspace/sms-captcha/client"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import { Spinner } from "@workspace/ui/components/spinner"
import { Avatar, AvatarFallback, AvatarImage } from "@workspace/ui/components/avatar"

const PHONE_REGEX = /^1[3-9]\d{9}$/
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_AVATAR_BYTES = 2 * 1024 * 1024

const ACCEPTED_AVATAR_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]

export interface SettingsUser {
  id: string
  name: string
  email: string
  emailVerified: boolean
  image: string | null
  phoneNumber: string | null
  phoneNumberVerified: boolean
}

/** Reads a `{ error }` body, falling back to a generic message. */
async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string }
    return body.error ?? fallback
  } catch {
    return fallback
  }
}

function initialsOf(name: string, email: string): string {
  const source = name.trim() || email
  return (
    source
      .split(/\s+/)
      .map((part) => part[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?"
  )
}

function Section({
  icon,
  title,
  description,
  children,
}: {
  icon: React.ReactNode
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">{icon}</span>
          <CardTitle className="text-base">{title}</CardTitle>
        </div>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

function VerifiedBadge({ verified }: { verified: boolean }) {
  const t = useTranslations("Settings")
  if (!verified) return <span className="text-xs text-muted-foreground">{t("unverified")}</span>
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <IconCheck className="size-3.5" />
      {t("verified")}
    </span>
  )
}

export function SettingsForm({
  user,
  hasPassword,
}: {
  user: SettingsUser
  hasPassword: boolean
}) {
  const t = useTranslations("Settings")
  const tAuth = useTranslations("Auth")
  const { refetch } = authClient.useSession()

  // --- avatar -------------------------------------------------------------
  const fileInput = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [avatarError, setAvatarError] = useState<string | null>(null)

  async function handleAvatarSelected(file: File | undefined) {
    if (!file) return
    setAvatarError(null)

    if (!ACCEPTED_AVATAR_TYPES.includes(file.type)) {
      setAvatarError(t("avatarTypeError"))
      return
    }
    if (file.size > MAX_AVATAR_BYTES) {
      setAvatarError(t("avatarSizeError"))
      return
    }

    setUploading(true)
    try {
      const form = new FormData()
      form.append("file", file)

      const response = await fetch("/api/user/avatar", {
        method: "POST",
        body: form,
      })

      if (!response.ok) {
        // Known refusals get their own sentence; the endpoint's error key is for
        // a log, not for a reader.
        const reason = await readError(response, "upload_failed")
        setAvatarError(
          reason === "oss_not_configured"
            ? t("avatarNotConfigured")
            : reason === "unsupported_type"
              ? t("avatarTypeError")
              : reason === "too_large"
                ? t("avatarSizeError")
                : t("avatarFailed")
        )
        return
      }

      const { url } = (await response.json()) as { url: string }
      const { error } = await authClient.updateUser({ image: url })
      if (error) {
        setAvatarError(authErrorMessage(error, tAuth, t("avatarFailed")))
        return
      }

      await refetch()
      toast.success(t("avatarUpdated"))
    } catch {
      setAvatarError(t("avatarFailed"))
    } finally {
      setUploading(false)
      if (fileInput.current) fileInput.current.value = ""
    }
  }

  async function removeAvatar() {
    setAvatarError(null)
    const { error } = await authClient.updateUser({ image: null })
    if (error) {
      setAvatarError(authErrorMessage(error, tAuth, t("avatarFailed")))
      return
    }
    await refetch()
    toast.success(t("avatarRemoved"))
  }

  // --- name ---------------------------------------------------------------
  const [name, setName] = useState(user.name)
  const [savingName, setSavingName] = useState(false)
  const [nameError, setNameError] = useState<string | null>(null)

  async function saveName(e: React.FormEvent) {
    e.preventDefault()
    const next = name.trim()
    if (next.length === 0) {
      setNameError(t("nameRequired"))
      return
    }
    if (next === user.name) return

    setNameError(null)
    setSavingName(true)
    try {
      const { error } = await authClient.updateUser({ name: next })
      if (error) {
        setNameError(authErrorMessage(error, tAuth, t("nameFailed")))
        return
      }
      await refetch()
      toast.success(t("nameUpdated"))
    } finally {
      setSavingName(false)
    }
  }

  // --- email --------------------------------------------------------------
  const [emailInput, setEmailInput] = useState("")
  const [emailPending, setEmailPending] = useState(false)
  const [emailError, setEmailError] = useState<string | null>(null)
  /** The address awaiting a code, when better-auth applied the change at once. */
  const [emailToVerify, setEmailToVerify] = useState<string | null>(null)

  async function changeEmail(e: React.FormEvent) {
    e.preventDefault()
    setEmailError(null)

    const next = emailInput.trim().toLowerCase()
    if (!EMAIL_REGEX.test(next)) {
      setEmailError(t("emailInvalid"))
      return
    }
    if (next === user.email) {
      setEmailError(t("emailUnchanged"))
      return
    }

    setEmailPending(true)
    try {
      const { error } = await authClient.changeEmail({ newEmail: next })
      if (error) {
        setEmailError(authErrorMessage(error, tAuth, t("emailFailed")))
        return
      }

      // The handshake differs by what the current address is worth. An
      // unverified one — a phone-only account's synthetic address — is changed
      // immediately and the new address gets the code, so it can be proven from
      // here. A verified one cannot: better-auth mails a confirmation link to the
      // address being replaced, which only its owner can click.
      if (!user.emailVerified) {
        setEmailToVerify(next)
      } else {
        toast.success(t("emailLinkSent"))
      }
      setEmailInput("")
      await refetch()
    } finally {
      setEmailPending(false)
    }
  }

  // --- phone --------------------------------------------------------------
  const [phoneInput, setPhoneInput] = useState("")
  const [phoneCode, setPhoneCode] = useState("")
  const [phoneCodeSent, setPhoneCodeSent] = useState(false)
  const [sendingCode, setSendingCode] = useState(false)
  const [phoneCountdown, setPhoneCountdown] = useState(0)
  const [bindingPhone, setBindingPhone] = useState(false)
  const [captchaOpen, setCaptchaOpen] = useState(false)
  const [phoneError, setPhoneError] = useState<string | null>(null)
  const [phoneCodeError, setPhoneCodeError] = useState<string | null>(null)

  const validPhone = PHONE_REGEX.test(phoneInput)

  useEffect(() => {
    if (phoneCountdown > 0) {
      const timer = setTimeout(() => setPhoneCountdown((c) => c - 1), 1000)
      return () => clearTimeout(timer)
    }
  }, [phoneCountdown])

  // The countdown is the only thing that holds resend down; `phoneCodeSent`
  // just reveals the code field. Gating the button on it too would disable
  // resend for good after the first send.
  const canSendPhoneCode =
    phoneCountdown === 0 && !sendingCode && validPhone

  async function sendPhoneCode(captchaToken: string) {
    setPhoneError(null)
    setPhoneCodeError(null)
    setSendingCode(true)
    try {
      const response = await fetch("/api/user/phone/code", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-temp-captcha-token": captchaToken,
        },
        body: JSON.stringify({ phoneNumber: phoneInput }),
      })

      if (!response.ok) {
        setPhoneError(
          await readError(response, tAuth("codeSendFailed"))
        )
        return
      }

      setPhoneCodeSent(true)
      setPhoneCountdown(60)
      toast.success(tAuth("codeSent"))
    } catch {
      setPhoneError(tAuth("codeSendFailed"))
    } finally {
      setSendingCode(false)
    }
  }

  async function bindPhone(e: React.FormEvent) {
    e.preventDefault()
    setPhoneError(null)
    setPhoneCodeError(null)
    setBindingPhone(true)

    try {
      const response = await fetch("/api/user/phone/bind", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumber: phoneInput, code: phoneCode }),
      })

      if (!response.ok) {
        const reason = await readError(response, "invalid_code")
        setPhoneCodeError(
          reason === "invalid_code"
            ? tAuth("codeWrong")
            : reason === "phone_in_use"
              ? t("phoneInUse")
              : reason === "too_many_attempts"
                ? tAuth("tooManyAttempts")
                : t("phoneBindFailed")
        )
        return
      }

      setPhoneInput("")
      setPhoneCode("")
      setPhoneCodeSent(false)
      await refetch()
      toast.success(t("phoneBound"))
    } catch {
      setPhoneCodeError(t("phoneBindFailed"))
    } finally {
      setBindingPhone(false)
    }
  }

  // --- password -----------------------------------------------------------
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [savingPassword, setSavingPassword] = useState(false)
  const [passwordError, setPasswordError] = useState<string | null>(null)

  async function savePassword(e: React.FormEvent) {
    e.preventDefault()
    setPasswordError(null)

    if (newPassword.length < 8) {
      setPasswordError(t("passwordTooShort"))
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordError(t("passwordMismatch"))
      return
    }

    setSavingPassword(true)
    try {
      const response = await fetch("/api/user/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword, hasPassword }),
      })

      if (!response.ok) {
        const reason = await readError(response, "password_change_failed")
        setPasswordError(
          reason === "wrong_password"
            ? t("passwordWrong")
            : reason === "password_already_set"
              ? t("passwordAlreadySet")
              : t("passwordFailed")
        )
        return
      }

      setCurrentPassword("")
      setNewPassword("")
      setConfirmPassword("")
      toast.success(hasPassword ? t("passwordUpdated") : t("passwordSet"))
    } catch {
      setPasswordError(t("passwordFailed"))
    } finally {
      setSavingPassword(false)
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl font-bold tracking-tight">
          {t("title")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("description")}</p>
      </header>

      <Section
        icon={<IconCamera className="size-4" />}
        title={t("avatarTitle")}
        description={t("avatarDescription")}
      >
        <div className="flex items-center gap-4">
          <Avatar className="size-16 rounded-lg">
            <AvatarImage
              src={user.image ?? undefined}
              alt={user.name}
            />
            <AvatarFallback className="rounded-lg">
              {initialsOf(user.name, user.email)}
            </AvatarFallback>
          </Avatar>
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInput}
              type="file"
              accept={ACCEPTED_AVATAR_TYPES.join(",")}
              className="hidden"
              onChange={(e) => handleAvatarSelected(e.target.files?.[0])}
            />
            <Button
              type="button"
              variant="outline"
              disabled={uploading}
              onClick={() => fileInput.current?.click()}
            >
              {uploading ? <Spinner /> : <IconCamera className="size-4" />}
              {uploading ? t("avatarUploading") : t("avatarUpload")}
            </Button>
            {user.image && (
              <Button
                type="button"
                variant="ghost"
                disabled={uploading}
                onClick={removeAvatar}
              >
                <IconTrash className="size-4" />
                {t("avatarRemove")}
              </Button>
            )}
          </div>
        </div>
        {avatarError && <FieldError className="mt-3">{avatarError}</FieldError>}
      </Section>

      <Section
        icon={<IconUser className="size-4" />}
        title={t("nameTitle")}
        description={t("nameDescription")}
      >
        <form onSubmit={saveName}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="settings-name">{t("nameLabel")}</FieldLabel>
              <Input
                id="settings-name"
                value={name}
                maxLength={60}
                autoComplete="name"
                onChange={(e) => {
                  setName(e.target.value)
                  setNameError(null)
                }}
                disabled={savingName}
              />
              {nameError && <FieldError>{nameError}</FieldError>}
            </Field>
            <Button
              type="submit"
              size="sm"
              className="w-fit"
              disabled={savingName || name.trim() === user.name}
            >
              {savingName && <Spinner />}
              {t("save")}
            </Button>
          </FieldGroup>
        </form>
      </Section>

      <Section
        icon={<IconMail className="size-4" />}
        title={t("emailTitle")}
        description={t("emailDescription")}
      >
        {emailToVerify ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t("emailCodeSent", { email: emailToVerify })}
            </p>
            <EmailVerificationForm
              email={emailToVerify}
              onBack={() => setEmailToVerify(null)}
              onVerified={async () => {
                setEmailToVerify(null)
                await refetch()
                toast.success(t("emailVerified"))
              }}
            />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <span className="text-sm">{user.email}</span>
              <VerifiedBadge verified={user.emailVerified} />
            </div>
            <form onSubmit={changeEmail}>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="settings-email">
                    {t("emailNewLabel")}
                  </FieldLabel>
                  <Input
                    id="settings-email"
                    type="email"
                    placeholder={t("emailPlaceholder")}
                    autoComplete="email"
                    value={emailInput}
                    onChange={(e) => {
                      setEmailInput(e.target.value)
                      setEmailError(null)
                    }}
                    disabled={emailPending}
                  />
                  {emailError && <FieldError>{emailError}</FieldError>}
                </Field>
                <Button
                  type="submit"
                  size="sm"
                  className="w-fit"
                  disabled={emailPending || emailInput.trim() === ""}
                >
                  {emailPending && <Spinner />}
                  {t("emailChange")}
                </Button>
              </FieldGroup>
            </form>
          </div>
        )}
      </Section>

      <Section
        icon={<IconDeviceMobile className="size-4" />}
        title={t("phoneTitle")}
        description={t("phoneDescription")}
      >
        <form onSubmit={bindPhone} className="space-y-4">
          <div className="flex items-center gap-3">
            <span className="text-sm">
              {user.phoneNumber
                ? `${user.phoneNumber.slice(0, 3)}****${user.phoneNumber.slice(-4)}`
                : t("phoneNone")}
            </span>
            {user.phoneNumber && <VerifiedBadge verified={user.phoneNumberVerified} />}
          </div>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="settings-phone">{t("phoneLabel")}</FieldLabel>
              <div className="flex items-center gap-4">
                <Input
                  id="settings-phone"
                  type="tel"
                  inputMode="numeric"
                  placeholder={t("phonePlaceholder")}
                  autoComplete="tel-national"
                  value={phoneInput}
                  onChange={(e) => {
                    setPhoneInput(e.target.value.replace(/\D/g, ""))
                    setPhoneCodeSent(false)
                    // A different number is a different request; the old
                    // number's cooldown must not hold the new send down.
                    setPhoneCountdown(0)
                    setPhoneError(null)
                    setPhoneCodeError(null)
                  }}
                  disabled={sendingCode || bindingPhone}
                  className="min-w-0 flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={!canSendPhoneCode}
                  onClick={() => setCaptchaOpen(true)}
                  className="h-10 shrink-0 px-3"
                >
                  {sendingCode ? (
                    <IconLoader2 className="size-4 animate-spin" />
                  ) : phoneCountdown > 0 ? (
                    tAuth("countdown", { count: phoneCountdown })
                  ) : (
                    <>
                      <IconSend className="size-4" />
                      {t("phoneSendCode")}
                    </>
                  )}
                </Button>
              </div>
              {phoneError && <FieldError>{phoneError}</FieldError>}
            </Field>
            {phoneCodeSent && (
              <Field>
                <FieldLabel htmlFor="settings-phone-code">
                  {tAuth("code")}
                </FieldLabel>
                <Input
                  id="settings-phone-code"
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder={tAuth("codePlaceholder")}
                  autoComplete="one-time-code"
                  value={phoneCode}
                  onChange={(e) => {
                    setPhoneCode(e.target.value.replace(/\D/g, ""))
                    setPhoneCodeError(null)
                  }}
                  disabled={bindingPhone}
                />
                {phoneCodeError && <FieldError>{phoneCodeError}</FieldError>}
              </Field>
            )}
            <Button
              type="submit"
              size="sm"
              className="w-fit"
              disabled={bindingPhone || !phoneCodeSent || phoneCode.length !== 6}
            >
              {bindingPhone && <Spinner />}
              {user.phoneNumber ? t("phoneRebind") : t("phoneBind")}
            </Button>
          </FieldGroup>
        </form>
      </Section>

      <Section
        icon={<IconKey className="size-4" />}
        title={t("passwordTitle")}
        description={
          hasPassword ? t("passwordDescription") : t("passwordSetDescription")
        }
      >
        <form onSubmit={savePassword}>
          <FieldGroup>
            {hasPassword && (
              <Field>
                <FieldLabel htmlFor="settings-current-password">
                  {t("passwordCurrentLabel")}
                </FieldLabel>
                <Input
                  id="settings-current-password"
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(e) => {
                    setCurrentPassword(e.target.value)
                    setPasswordError(null)
                  }}
                  disabled={savingPassword}
                />
              </Field>
            )}
            <Field>
              <FieldLabel htmlFor="settings-new-password">
                {t("passwordNewLabel")}
              </FieldLabel>
              <Input
                id="settings-new-password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                value={newPassword}
                onChange={(e) => {
                  setNewPassword(e.target.value)
                  setPasswordError(null)
                }}
                disabled={savingPassword}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="settings-confirm-password">
                {t("passwordConfirmLabel")}
              </FieldLabel>
              <Input
                id="settings-confirm-password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value)
                  setPasswordError(null)
                }}
                disabled={savingPassword}
              />
              {passwordError && <FieldError>{passwordError}</FieldError>}
            </Field>
            <Button
              type="submit"
              size="sm"
              className="w-fit"
              disabled={savingPassword || newPassword.length < 8}
            >
              {savingPassword && <Spinner />}
              {hasPassword ? t("passwordSave") : t("passwordSet")}
            </Button>
          </FieldGroup>
        </form>
      </Section>

      <SmsSliderCaptcha
        open={captchaOpen}
        onOpenChange={setCaptchaOpen}
        i18n={{
          title: tAuth("captchaTitle"),
          hint: tAuth("captchaHint"),
          codeSent: tAuth("codeVerified"),
        }}
        onVerified={sendPhoneCode}
      />
    </div>
  )
}
