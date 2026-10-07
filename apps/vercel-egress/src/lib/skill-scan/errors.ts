/**
 * Errors Route B raises, distinguished because the console maps them to
 * different status codes: `InvalidSkillDirError` is a 400, 
 * `SkillSourceUnavailableError` is a 502 `source_unavailable`, and an
 * in-sandbox script failure falls back to serverless rather than surfacing.
 */

/** The repository could not be fetched: private, missing, renamed, or unreachable. */
export class SkillSourceUnavailableError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown
  ) {
    super(message)
    this.name = "SkillSourceUnavailableError"
  }
}

/** The request names something that is not a position inside the repository. */
export class InvalidSkillDirError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "InvalidSkillDirError"
  }
}