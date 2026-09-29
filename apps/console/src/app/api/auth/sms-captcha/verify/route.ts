import { createVerifyHandler } from "@workspace/sms-captcha/server"
import { smsCaptchaConfig } from "@/lib/sms-captcha"

export const POST = createVerifyHandler(smsCaptchaConfig)