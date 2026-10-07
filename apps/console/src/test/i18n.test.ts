/**
 * Tests for the message catalogs and the locale-aware formatters.
 *
 * The catalogs are plain JSON that no compiler reads, so the usual failure is
 * a key that exists in one language and not the other: it renders as English
 * at runtime with nothing to indicate a mistake. These tests make that a
 * failure here instead.
 */
import { describe, expect, it } from "vitest"

import { i18n } from "@/lib/config/i18n"
import {
  getDefaultMessages,
  getMessagesForLocale,
  mergeMessages,
} from "@/i18n/messages"
import { routing } from "@/i18n/routing"
import {
  formatDateTime,
  formatDuration,
  formatRelative,
} from "@/lib/i18n/format"
import type { Locale } from "@/lib/config/i18n"
import {
  ERROR_CODES,
  isErrorCode,
  isSkipCode,
  SKIP_CODES,
} from "@/lib/trpc/error-codes"
import { authErrorMessage } from "@/lib/auth/auth-error"

type Messages = Record<string, unknown>

/** Flattens a catalog to `a.b.c -> value`, so nesting is not a special case. */
function flatten(source: Messages, prefix = ""): Map<string, string> {
  const flat = new Map<string, string>()

  for (const [key, value] of Object.entries(source)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (value && typeof value === "object") {
      for (const [nested, text] of flatten(value as Messages, path)) {
        flat.set(nested, text)
      }
    } else {
      flat.set(path, String(value))
    }
  }

  return flat
}

/** The `{name}` placeholders a message expects. */
function placeholders(message: string): Set<string> {
  return new Set(
    [...message.matchAll(/\{\s*([A-Za-z0-9_]+)\s*[,}]/g)].map(
      (match) => match[1]!
    )
  )
}

const NOW = new Date("2026-06-15T12:00:00Z")

function context(locale: Locale) {
  return { locale, empty: "—", now: NOW }
}

describe("message catalogs", () => {
  it("declares a label and a catalog for every configured locale", async () => {
    for (const locale of routing.locales) {
      expect(i18n.locales[locale].label).toBeTruthy()
      const messages = await getMessagesForLocale(locale as Locale)
      expect(Object.keys(messages).length).toBeGreaterThan(0)
    }
  })

  it("gives every locale the same keys as the default", async () => {
    const defaultMessages = flatten(
      (await getDefaultMessages()) as unknown as Messages
    )

    for (const locale of routing.locales) {
      const translated = flatten(
        (await getMessagesForLocale(locale as Locale)) as unknown as Messages
      )
      const missing = [...defaultMessages.keys()].filter(
        (key) => !translated.has(key)
      )

      expect(
        missing,
        `${locale} is missing keys that the default locale has`
      ).toEqual([])
    }
  })

  it("keeps the placeholders of a translation the same as the source", async () => {
    const source = flatten((await getDefaultMessages()) as unknown as Messages)

    for (const locale of routing.locales) {
      const translated = flatten(
        (await getMessagesForLocale(locale as Locale)) as unknown as Messages
      )

      for (const [key, text] of translated) {
        const original = source.get(key)
        if (original === undefined) continue

        // A dropped placeholder renders nothing where the number should be,
        // and an invented one is an error, so both are checked here.
        expect([...placeholders(text)].sort(), `${key} in ${locale}`).toEqual(
          [...placeholders(original)].sort()
        )
      }
    }
  })

  it("uses no angle brackets, which next-intl reads as rich-text tags", async () => {
    // `t()` returns a string, so a message containing `<timestamp>` does not
    // render — it throws `INVALID_TAG` on every paint of the component that
    // asks for it, which is how a hand-written "<timestamp>.<raw body>"
    // inside a signing-key note took the dialog down. No message in this repo
    // is consumed with `t.rich`, so a literal angle bracket is always a
    // mistake rather than markup: write 「」 or plain quotes instead. Rich
    // text, if it is ever needed, should arrive as a deliberate change to
    // this assertion rather than as an accident that slips past it.
    const offenders: string[] = []

    for (const locale of routing.locales) {
      for (const [key, text] of flatten(
        (await getMessagesForLocale(locale)) as unknown as Messages
      )) {
        if (/[<>]/.test(text)) offenders.push(`${locale} ${key}: ${text}`)
      }
    }

    expect(offenders).toEqual([])
  })

  it("keeps a default-locale key the translation omits", () => {
    const merged = mergeMessages(
      { Common: { cancel: "Cancel", retry: "Retry" } },
      { Common: { cancel: "取消" } }
    )

    // A half-finished translation should read as English where it is missing,
    // not render the key or an empty string.
    expect(merged.Common).toEqual({ cancel: "取消", retry: "Retry" })
  })

  it("translates at least as much as the default locale does", async () => {
    // Which locale is the default is configuration, so this is written against
    // whatever it currently is rather than against a name. Hard-coding "en"
    // here made the test compare the default catalog with itself the moment
    // the default became "zh", and pass for having found nothing.
    const base = flatten((await getDefaultMessages()) as unknown as Messages)
    const others = routing.locales.filter(
      (locale) => locale !== routing.defaultLocale
    )

    expect(others.length).toBeGreaterThan(0)

    for (const locale of others) {
      const other = flatten(
        (await getMessagesForLocale(locale)) as unknown as Messages
      )

      // Guards against a catalog that was copied and never edited: identical
      // everywhere means the second language shipped as the first one.
      const translated = [...base.keys()].filter(
        (key) => other.get(key) !== base.get(key)
      )

      expect(
        translated.length,
        `${locale} is barely translated relative to the default locale`
      ).toBeGreaterThan(base.size / 2)
    }
  })
})

describe("formatRelative", () => {
  it("uses the reader's language", () => {
    const past = new Date("2026-06-13T12:00:00Z")

    expect(formatRelative(past, context("en"))).toBe("2 days ago")
    expect(formatRelative(past, context("zh"))).toBe("2天前")
  })

  it("reads a future timestamp as time remaining", () => {
    const soon = new Date("2026-06-15T14:00:00Z")

    expect(formatRelative(soon, context("en"))).toBe("in 2 hours")
    expect(formatRelative(soon, context("zh"))).toBe("2小时后")
  })

  it("picks the largest unit the gap reaches", () => {
    const cases: Array<[string, string]> = [
      ["2025-06-15T12:00:00Z", "1 year ago"],
      ["2026-04-15T12:00:00Z", "2 months ago"],
      ["2026-06-08T12:00:00Z", "1 week ago"],
      ["2026-06-15T11:30:00Z", "30 minutes ago"],
    ]

    for (const [iso, expected] of cases) {
      expect(formatRelative(new Date(iso), context("en"))).toBe(expected)
    }
  })

  it("stays numeric where a locale would otherwise say yesterday", () => {
    // "yesterday" is not a measurement, and these cells sit in a column of
    // durations next to one another.
    expect(
      formatRelative(new Date("2026-06-14T12:00:00Z"), context("zh"))
    ).toBe("1天前")
  })

  it("falls back to seconds below a minute", () => {
    expect(
      formatRelative(new Date("2026-06-15T11:59:30Z"), context("en"))
    ).toBe("30 seconds ago")
  })

  it("renders a missing value as the empty marker", () => {
    expect(formatRelative(null, context("en"))).toBe("—")
    expect(formatRelative(undefined, context("en"))).toBe("—")
  })
})

describe("formatDateTime", () => {
  const value = new Date("2026-01-05T14:30:00Z")

  it("uses the reader's month and ordering", () => {
    const en = formatDateTime(value, context("en"))
    const zh = formatDateTime(value, context("zh"))

    expect(en).toContain("Jan")
    expect(en).toMatch(/^Jan/)
    // Chinese puts the year first, which is the point of asking Intl rather
    // than hardcoding a "MMM d" pattern.
    expect(zh).toMatch(/^2026/)
  })

  it("renders a missing value as the empty marker", () => {
    expect(formatDateTime(null, context("en"))).toBe("—")
  })
})

describe("formatDuration", () => {
  it("uses the reader's units", () => {
    expect(formatDuration(3_600_000, context("en"))).toBe("1h")
    expect(formatDuration(3_600_000, context("zh"))).toBe("1小时")
  })

  it("shows at most two units and drops the rest", () => {
    const ms = ((2 * 60 + 30) * 60 + 45) * 1000

    // The separator is `Intl.ListFormat`'s answer, which puts a comma in
    // English and nothing between the units in Chinese.
    expect(formatDuration(ms, context("en"))).toBe("2h, 30m")
    expect(formatDuration(ms, context("zh"))).toBe("2小时30分钟")
  })

  it("keeps sub-second precision rather than rounding to zero", () => {
    expect(formatDuration(250, context("en"))).toBe("250ms")
  })

  it("reports a zero-length duration instead of an empty cell", () => {
    expect(formatDuration(0, context("en"))).toBe("0ms")
  })

  it("renders a missing value as the empty marker", () => {
    expect(formatDuration(null, context("en"))).toBe("—")
  })
})

describe("outcome codes", () => {
  it("recognises only the codes it can translate", () => {
    // The guards stand between a message from the server and a translation
    // lookup, so an unrecognised value has to fall through to the prose
    // instead of being treated as a key.
    expect(isSkipCode(SKIP_CODES.taskDisabled)).toBe(true)
    expect(isSkipCode("task.alreadyRunning")).toBe(true)
    expect(isSkipCode("task.meltedDown")).toBe(false)
    expect(isSkipCode(undefined)).toBe(false)
    expect(isSkipCode(null)).toBe(false)
    expect(isSkipCode(42)).toBe(false)

    expect(isErrorCode(ERROR_CODES.taskNotFound)).toBe(true)
    // A skip code is not an error code: the two live in separate fields and
    // must not be interchangeable.
    expect(isErrorCode(SKIP_CODES.taskDisabled)).toBe(false)
    expect(isErrorCode("task.meltedDown")).toBe(false)
    expect(isErrorCode(undefined)).toBe(false)
  })

  it("keeps each reason and each error code distinct", () => {
    // A collision would silently translate one outcome as the other.
    const all = [...Object.values(SKIP_CODES), ...Object.values(ERROR_CODES)]

    expect(new Set(all).size).toBe(all.length)
  })
})

describe("formatter reuse", () => {
  it("does not let one locale's formatter answer for another", () => {
    // The formatters are cached per locale to keep a table of timestamps off
    // the constructor path. Interleaving the two locales is what would catch
    // a cache keyed on anything but the locale: a formatter is only correct
    // for the language it was built with, and the failure would be text in
    // the wrong language rather than an error.
    const past = new Date("2026-06-13T12:00:00Z")

    for (let round = 0; round < 3; round++) {
      expect(formatRelative(past, context("en"))).toBe("2 days ago")
      expect(formatRelative(past, context("zh"))).toBe("2天前")
      expect(formatDuration(3_600_000, context("en"))).toBe("1h")
      expect(formatDuration(3_600_000, context("zh"))).toBe("1小时")
    }
  })
})

describe("auth error codes", () => {
  const t = (key: string) => `[${key}]`
  const fallback = "fallback"

  it("translates a code it knows", () => {
    // Verified against the running API: a wrong password answers with
    // `INVALID_EMAIL_OR_PASSWORD`, which the interface has to show in the
    // reader's language rather than as the library's English prose.
    expect(
      authErrorMessage(
        {
          code: "INVALID_EMAIL_OR_PASSWORD",
          message: "Invalid email or password",
        },
        t,
        fallback
      )
    ).toBe("[invalidCredentials]")
  })

  it("does not reveal whether an account exists", () => {
    // A sign-in form that answers these two differently is a way to enumerate
    // registered addresses, so they share one message on purpose.
    const unknown = authErrorMessage(
      { code: "USER_EMAIL_NOT_FOUND" },
      t,
      fallback
    )
    const wrongPassword = authErrorMessage(
      { code: "INVALID_EMAIL_OR_PASSWORD" },
      t,
      fallback
    )

    expect(unknown).toBe(wrongPassword)
  })

  it("falls back to the library's message for a code it does not know", () => {
    // English, but specific. Showing the code or nothing would both be worse.
    expect(
      authErrorMessage(
        { code: "SOMETHING_NEW", message: "Provider unreachable" },
        t,
        fallback
      )
    ).toBe("Provider unreachable")
  })

  it("falls back to the action's own message when there is neither", () => {
    expect(authErrorMessage({ code: "SOMETHING_NEW" }, t, fallback)).toBe(
      fallback
    )
    expect(authErrorMessage(null, t, fallback)).toBe(fallback)
    expect(authErrorMessage(undefined, t, fallback)).toBe(fallback)
  })

  it("maps the codes the sign-up and OTP flows return", () => {
    const cases: Array<[string, string]> = [
      ["USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL", "emailInUse"],
      ["INVALID_EMAIL", "invalidEmail"],
      ["INVALID_PHONE_NUMBER", "invalidPhoneNumber"],
      ["INVALID_OTP", "codeWrong"],
      ["OTP_NOT_FOUND", "codeWrong"],
      ["OTP_EXPIRED", "codeExpired"],
      ["TOO_MANY_ATTEMPTS", "tooManyAttempts"],
      ["VERIFICATION_FAILED", "captchaFailed"],
      ["EMAIL_NOT_VERIFIED", "emailNotVerified"],
    ]

    for (const [code, key] of cases) {
      expect(authErrorMessage({ code }, t, fallback), code).toBe(`[${key}]`)
    }
  })
})
