"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@workspace/ui/components/dialog"
import SliderCaptcha, { type VerifyParam } from "rc-slider-captcha"

type CachedChallenge = {
  challengeId: string
  bgUrl: string
  puzzleUrl: string
  puzzleY: number
}

export interface SmsSliderCaptchaProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 验证成功后回调，携带 token */
  onVerified: (token: string) => void | Promise<void>
  /** API 基础路径，默认 '/api/auth/sms-captcha' */
  apiBasePath?: string
  /** 国际化文本 */
  i18n?: {
    title?: string
    hint?: string
    loading?: string
    verifying?: string
    codeSent?: string
    failed?: string
    tooManyAttempts?: string
    mismatch?: string
    challengeFailed?: string
    verifyFailed?: string
  }
}

export function SmsSliderCaptcha({
  open,
  onOpenChange,
  onVerified,
  apiBasePath = "/api/auth/sms-captcha",
  i18n,
}: SmsSliderCaptchaProps) {
  const [error, setError] = useState<string | null>(null)
  const [puzzleTop, setPuzzleTop] = useState(10)
  const cachedChallengeRef = useRef<CachedChallenge | null>(null)
  const requestPromiseRef = useRef<Promise<{ bgUrl: string; puzzleUrl: string }> | null>(null)

  const t = {
    title: i18n?.title ?? "安全验证",
    hint: i18n?.hint ?? "请拖动滑块完成验证",
    loading: i18n?.loading ?? "加载中...",
    verifying: i18n?.verifying ?? "验证中...",
    codeSent: i18n?.codeSent ?? "验证码已发送",
    failed: i18n?.failed ?? "验证失败，请重试",
    tooManyAttempts: i18n?.tooManyAttempts ?? "尝试次数过多，请刷新重试",
    mismatch: i18n?.mismatch ?? "未对齐，请重试",
    challengeFailed: i18n?.challengeFailed ?? "加载验证失败，请重试",
    verifyFailed: i18n?.verifyFailed ?? "验证失败，请重试",
  }

  useEffect(() => {
    if (!open) {
      cachedChallengeRef.current = null
      requestPromiseRef.current = null
    }
  }, [open])

  const handleRequest = useCallback(async () => {
    setError(null)
    if (cachedChallengeRef.current) {
      const cached = cachedChallengeRef.current
      setPuzzleTop(cached.puzzleY)
      return { bgUrl: cached.bgUrl, puzzleUrl: cached.puzzleUrl }
    }
    if (requestPromiseRef.current) {
      const result = await requestPromiseRef.current
      const cached = cachedChallengeRef.current as CachedChallenge | null
      if (cached?.puzzleY != null) setPuzzleTop(cached.puzzleY)
      return result
    }
    const promise = (async () => {
      const res = await fetch(`${apiBasePath}/challenge`, { method: "POST" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.challengeId || !data.bgUrl || !data.puzzleUrl) {
        setError(t.challengeFailed)
        throw new Error("CHALLENGE_FAILED")
      }
      const puzzleY = typeof data.puzzleY === "number" ? data.puzzleY : 10
      cachedChallengeRef.current = {
        challengeId: data.challengeId as string,
        bgUrl: data.bgUrl as string,
        puzzleUrl: data.puzzleUrl as string,
        puzzleY,
      }
      setPuzzleTop(puzzleY)
      return {
        bgUrl: data.bgUrl as string,
        puzzleUrl: data.puzzleUrl as string,
      }
    })()
    requestPromiseRef.current = promise
    return promise
  }, [apiBasePath, t.challengeFailed])

  const handleVerify = useCallback(
    async (verifyData: VerifyParam) => {
      const challengeId = cachedChallengeRef.current?.challengeId ?? null
      if (!challengeId) {
        setError(t.challengeFailed)
        throw new Error("NO_CHALLENGE")
      }
      const res = await fetch(`${apiBasePath}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challengeId,
          x: verifyData.x,
          y: verifyData.y,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const err = data?.error
        if (err === "TOO_MANY_ATTEMPTS") setError(t.tooManyAttempts)
        else if (err === "SLIDER_MISMATCH") setError(t.mismatch)
        else setError(t.verifyFailed)
        throw new Error(err ?? "VERIFY_FAILED")
      }
      if (!data.token) {
        setError(t.verifyFailed)
        throw new Error("NO_TOKEN")
      }
      onOpenChange(false)
      await Promise.resolve(onVerified(data.token as string))
    },
    [apiBasePath, t, onOpenChange, onVerified]
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[372px] max-w-[calc(100vw-2rem)]">
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription>{t.hint}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {open && (
            <SliderCaptcha
              mode="embed"
              puzzleSize={{
                width: 60,
                height: 60,
                top: puzzleTop,
              }}
              request={handleRequest}
              onVerify={handleVerify}
              errorHoldDuration={1000}
              tipText={{
                default: t.hint,
                loading: t.loading,
                moving: t.hint,
                verifying: t.verifying,
                success: t.codeSent,
                error: t.verifyFailed,
                errors: t.verifyFailed,
                loadFailed: t.challengeFailed,
              }}
            />
          )}
          {error && <p className="text-destructive text-xs">{error}</p>}
        </div>
      </DialogContent>
    </Dialog>
  )
}