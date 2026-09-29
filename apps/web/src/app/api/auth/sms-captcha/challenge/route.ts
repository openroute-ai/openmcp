import type { NextRequest } from 'next/server'
import {
  createChallengeHandler,
  createChallengeGetHandler,
} from '@workspace/sms-captcha/server'

// The handlers are annotated as plain `NextRequest -> Response` functions: their
// inferred return types reference package-internal types, which cannot be named
// here for declaration emit.
const POST: (request: NextRequest) => Promise<Response> = createChallengeHandler()
const GET: (request: NextRequest) => Promise<Response> = createChallengeGetHandler()

export { POST, GET }
