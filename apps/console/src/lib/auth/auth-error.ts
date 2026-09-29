/**
 * Errors the auth client reports, mapped to the reader's language.
 *
 * `better-auth` answers in English prose and the console shows that prose, so a
 * wrong password in the Chinese interface would be reported in English. The
 * error's `code` is the part that is not written for a reader in any language,
 * so the code is what this file keys on.
 *
 * The codes below are the ones the flows this app actually calls can return —
 * `signIn.email`, `signUp.email`, and the phone-number OTP pair — read out of
 * the installed `better-auth` rather than guessed. A code from an unwatched
 * path falls through to the library's own message, which is in English but is
 * the only specific thing there is; a better message to guess wrong is to say
 * nothing.
 *
 * Two of the mappings are deliberately lossy. `USER_EMAIL_NOT_FOUND` and
 * `PHONE_NUMBER_NOT_EXIST` say the same thing as a wrong password, and
 * reporting them differently would turn a sign-in form into a way to test
 * whether an account exists.
 */

/**
 * The catalog keys this module can ask for.
 *
 * Bare names, because the component's translator is already scoped to the
 * `Auth` namespace; a prefix here would be a second place to keep in step.
 * `codeWrong` is not listed because the forms already had one and reuse it.
 */
export type AuthErrorKey =
  | "invalidCredentials"
  | "emailNotVerified"
  | "emailInUse"
  | "invalidEmail"
  | "invalidPhoneNumber"
  | "codeWrong"
  | "codeExpired"
  | "tooManyAttempts"
  | "captchaFailed"

/** better-auth's code -> the message to show for it. */
const AUTH_ERROR_CODES = {
  // Sign-in. `USER_EMAIL_NOT_FOUND` shares a key on purpose: telling it apart
  // from a wrong password would confirm which addresses have accounts.
  INVALID_EMAIL_OR_PASSWORD: "invalidCredentials",
  INVALID_PHONE_NUMBER_OR_PASSWORD: "invalidCredentials",
  USER_EMAIL_NOT_FOUND: "invalidCredentials",
  PHONE_NUMBER_NOT_EXIST: "invalidCredentials",
  EMAIL_NOT_VERIFIED: "emailNotVerified",
  PHONE_NUMBER_NOT_VERIFIED: "emailNotVerified",
  INVALID_EMAIL: "invalidEmail",
  INVALID_PHONE_NUMBER: "invalidPhoneNumber",

  // Sign-up.
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "emailInUse",
  PHONE_NUMBER_EXIST: "emailInUse",

  // The one-time code, sent and verified.
  INVALID_OTP: "codeWrong",
  OTP_NOT_FOUND: "codeWrong",
  OTP_EXPIRED: "codeExpired",
  TOO_MANY_ATTEMPTS: "tooManyAttempts",

  // The slider captcha in front of sending a code.
  VERIFICATION_FAILED: "captchaFailed",
} as const satisfies Record<string, AuthErrorKey>

export type AuthErrorCode = keyof typeof AUTH_ERROR_CODES

const isAuthErrorCode = (value: unknown): value is AuthErrorCode =>
  typeof value === "string" && value in AUTH_ERROR_CODES

/**
 * What `authClient` hands to `onError`, and to the destructured `error` of a
 * call that returns one.
 *
 * `better-fetch` spreads the JSON response body onto the error and adds
 * `status`, so `code` sits beside `message` rather than inside `cause`.
 */
export interface AuthClientError {
  code?: string | null
  message?: string | null
}

/** Resolves a catalog key to text; the component's translator does this. */
export type TranslateAuthError = (key: AuthErrorKey) => string

/**
 * The message to show for an auth error.
 *
 * `fallback` is the generic line for the action, used when the library sent
 * neither a code this file knows nor a message.
 */
export function authErrorMessage(
  error: AuthClientError | null | undefined,
  t: TranslateAuthError,
  fallback: string
): string {
  if (isAuthErrorCode(error?.code)) {
    return t(AUTH_ERROR_CODES[error.code])
  }

  // English, but specific: "Invalid email or password" beats a generic
  // "sign-in failed" that hides what actually went wrong.
  return error?.message || fallback
}
