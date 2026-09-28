import {
  createChallengeHandler,
  createChallengeGetHandler,
} from "@workspace/sms-captcha/server"
import { smsCaptchaConfig } from "@/lib/sms-captcha"

const POST = createChallengeHandler(smsCaptchaConfig)
const GET = createChallengeGetHandler(smsCaptchaConfig)

export { POST, GET }