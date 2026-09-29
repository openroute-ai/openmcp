import { createImageHandler } from "@workspace/sms-captcha/server"
import { smsCaptchaConfig } from "@/lib/sms-captcha"

export const GET = createImageHandler(smsCaptchaConfig)