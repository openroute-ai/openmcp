export type {
  CreateJigsawChallengeResult,
  VerifyJigsawResult,
  SmsCaptchaConfig,
  RateLimitType,
  RateLimitResult,
  RequestLike,
} from "./types"

export {
  createJigsawChallenge,
  getChallengeImage,
  verifyJigsawChallenge,
  consumeAndValidateToken,
} from "./server/sms-captcha-server"

export { createPuzzle } from "./server/puzzle-generator"

export {
  checkRateLimit,
  consumeRateLimit,
  checkAndConsumeSmsRateLimit,
} from "./server/rate-limiter"

export { getClientIp } from "./server/ip"

export {
  createChallengeHandler,
  createChallengeGetHandler,
  createVerifyHandler,
  createImageHandler,
} from "./server/handlers"

export { SmsSliderCaptcha } from "./client/sms-slider-captcha"
export type { SmsSliderCaptchaProps } from "./client/sms-slider-captcha"