/**
 * Errors the acquisition layer raises, distinguished because the route maps
 * them to different status codes.
 *
 * "Could not fetch the repository" and "you asked for a directory outside the
 * repository" both arrive as exceptions, and collapsing them into one `500`
 * loses the only information the caller can act on. They are separate types so
 * they can be separate status codes.
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