import { sms } from "tencentcloud-sdk-nodejs"

const CN_PHONE = /^1[3-9]\d{9}$/

function smsEnv(name: string): string | undefined {
  return process.env[name]
}

export function isTencentSmsConfigured(): boolean {
  return Boolean(
    smsEnv("TENCENT_SMS_SECRET_ID") &&
      smsEnv("TENCENT_SMS_SECRET_KEY") &&
      smsEnv("TENCENT_SMS_SDK_APP_ID") &&
      smsEnv("TENCENT_SMS_SIGN_NAME") &&
      smsEnv("TENCENT_SMS_TEMPLATE_ID")
  )
}

/**
 * Send an SMS verification code via Tencent Cloud SMS.
 * Falls back to logging the code when TENCENT_SMS_* is not configured,
 * so the OTP flow stays testable locally.
 */
export async function sendSmsCode(
  phoneNumber: string,
  code: string
): Promise<void> {
  if (!CN_PHONE.test(phoneNumber)) {
    throw new Error("无效的手机号")
  }
  if (isTencentSmsConfigured()) {
    await sendTencentSms(phoneNumber, code)
    return
  }
  console.log(`[sms:test] OTP for ${phoneNumber}: ${code}`)
}

async function sendTencentSms(phoneNumber: string, code: string): Promise<void> {
  const client = new sms.v20210111.Client({
    credential: {
      secretId: smsEnv("TENCENT_SMS_SECRET_ID")!,
      secretKey: smsEnv("TENCENT_SMS_SECRET_KEY")!,
    },
    region: smsEnv("TENCENT_SMS_REGION") ?? "ap-guangzhou",
    profile: {
      httpProfile: { endpoint: "sms.tencentcloudapi.com" },
    },
  })

  const res = await client.SendSms({
    PhoneNumberSet: [`+86${phoneNumber}`],
    SmsSdkAppId: smsEnv("TENCENT_SMS_SDK_APP_ID")!,
    SignName: smsEnv("TENCENT_SMS_SIGN_NAME")!,
    TemplateId: smsEnv("TENCENT_SMS_TEMPLATE_ID")!,
    TemplateParamSet: [code],
  })

  const status = res?.SendStatusSet?.[0]
  if (status?.Code !== "Ok") {
    console.error("[sms] Tencent API error:", status?.Message ?? "unknown")
    throw new Error(status?.Message || "短信发送失败")
  }
}