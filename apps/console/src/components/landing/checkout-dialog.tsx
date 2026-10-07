"use client"

/**
 * 结账弹窗：微信扫码支付。
 *
 * 一个弹窗，七种状态（登录 / 建单中 / 待支付 / 确认中 / 成功 / 已过期 / 失败），
 * 全部在**同一个位置**切换——用户不会因为"二维码过期了"就被弹窗关在外面再点一次
 * 「开始监控」。状态由三样东西决定：建单 mutation 的结果、`checkStatus` 的轮询、
 * 以及本地倒计时（只用来决定什么时候显示「重新获取」，支付结果一律以轮询为准，
 * 因为本机时钟不能证明微信那边发生了什么）。
 *
 * 二维码在**服务端**生成，这里拿到的是 data URL（`lib/billing/qr.ts`），所以弹窗
 * 打开的第一次渲染里就有图，不存在"拿到 code_url 再画"的空白帧。
 *
 * 文案是中文硬编码，与它所在的 `pricing-downloads.tsx` 一致：落地页的定价区本来
 * 就不在 i18n 目录里，把这一个弹窗单独挪出去只会让"改一句话"变成改两个地方。
 */
import { useEffect, useState, type ReactNode } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { useTRPC } from "@/lib/trpc/client"
import { LocaleLink, useLocaleRouter } from "@/i18n/navigation"
import type { PlanPrice, SubscriptionCycle } from "@/lib/billing/plan-types"

/** 登录后回到落地页并自动重新打开这个弹窗。 */
const SIGN_IN_CALLBACK = "/?plan=pro"

export interface CheckoutConfig {
  prices: PlanPrice[]
  simulation: boolean
  gatewayConfigured: boolean
}

interface OrderView {
  orderId: string
  amountFen: number
  /** 续费单（金额已打折）。只用于「原价划线」展示，真值始终是 `amountFen`。 */
  renewal: boolean
  qrDataUrl: string
  qrPayload: string
  expiresAt: Date
  cycle: SubscriptionCycle
}

type Phase =
  | "login"
  | "config"
  | "creating"
  | "pending"
  | "confirming"
  | "success"
  | "expired"
  | "error"

/**
 * 周期的名字与计价后缀。
 *
 * **金额不在这里**：tab 上的价格来自服务端的价目表（`checkout.prices`），因为定价
 * 是服务端白名单里的一项，界面上另写一遍 ¥99 就等于给了它第二个可能漂移的地方。
 */
const CYCLE_META: Record<SubscriptionCycle, { name: string; suffix: string }> = {
  monthly: { name: "月付", suffix: "/月" },
  yearly: { name: "年付", suffix: "/年" },
}

function fenToYuan(amountFen: number): string {
  return `¥${(amountFen / 100).toFixed(2)}`
}

export function CheckoutDialog({
  open,
  onOpenChange,
  signedIn,
  checkout,
  returnPath,
  renewal = false,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  signedIn: boolean
  checkout: CheckoutConfig
  /** 支付成功后「进入控制台」去哪。由调用方传一个站内路径常量——落地页回 `/console`，订阅页回 `/console/subscriptions`。 */
  returnPath: string
  /**
   * 这次结账是生效期内续费。
   *
   * 只决定**展示**：tab 与「应付」行显示折后价。真正的续费判定在服务端建单那一刻
   * 发生（`lib/billing/orders.ts`）并随订单返回 `renewal`，两边同库同源，不会歧义——
   * 万一客户端判错，应付行也会以订单金额为准，而不是这张单开的原价。
   */
  renewal?: boolean
}) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const router = useLocaleRouter()

  const [cycle, setCycle] = useState<SubscriptionCycle>("monthly")
  const [order, setOrder] = useState<OrderView | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** 模拟支付已提交、等轮询确认。这一帧就是「支付确认中…」。 */
  const [confirming, setConfirming] = useState(false)
  /**
   * 本机当前时间，每秒跳一次。
   *
   * 是 state 而不是渲染里现取的 `Date.now()`：倒计时随时间变化，而渲染必须是纯的
   * （同一帧重渲染要给出同一个结果）。订单到手时下面那个 effect 会先校一次时，所以
   * 弹窗**重新打开的第一帧**就是准的，不会拿几分钟前的时间算出一个偏大的剩余时长。
   */
  const [now, setNow] = useState(() => Date.now())

  const price = checkout.prices.find(
    (row) => row.plan === "pro" && row.cycle === cycle
  )

  /** 上一张单清干净再要新的：否则「重新获取」期间还会显示那张已过期的二维码。 */
  const resetCheckout = () => {
    setOrder(null)
    setError(null)
    setConfirming(false)
  }

  // 倒计时只在手里有单的时候跑。没有单时每秒一次的重渲染纯属浪费。
  useEffect(() => {
    if (!order) return
    // 第一次校时用 `setTimeout(0)` 而不是在 effect 体里直接调：同步 setState 会
    // 连环触发一次渲染（effect 的大忌），而 0ms 的延时把「订单到手」和「时钟对齐」
    // 压在同一帧之后——否则 `now` 还是弹窗打开时那一帧，前一秒的倒计时会偏大。
    const align = setTimeout(() => setNow(Date.now()), 0)
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => {
      clearTimeout(align)
      clearInterval(timer)
    }
  }, [order])

  const create = useMutation(
    trpc.billing.createOrder.mutationOptions({
      onSuccess: (created) => {
        // `CheckoutOrder`（`lib/billing/orders.ts`）就是这个组件要的形状，
        // 服务端多带的 `plan` / `simulation` 不碍事——直接塞进 `OrderView`。
        setOrder(created)
        setError(null)
        setConfirming(false)
      },
      onError: (cause) => {
        setError(
          cause.message.includes("not configured")
            ? "支付通道尚未开放，请稍后再试或联系我们。"
            : "创建订单失败，请稍后重试。"
        )
      },
    })
  )

  // 打开弹窗 / 切换周期 → 要一张单。服务端会复用还没过期的同档 pending 单，
  // 所以这个 effect 触发两次不会在商户后台多出一张孤儿订单。
  //
  // 清空旧单的三行刻意**不在**这里：渲染期间不能同步 setState（那会连环触发一次
  // 渲染），所以重置放在触发它的两个事件里——`onOpenChange` 与 `handleCycle`。
  useEffect(() => {
    if (!open || !signedIn || !checkout.gatewayConfigured) return
    create.mutate({ plan: "pro", cycle })
    // `create` 是 mutation 对象，每次渲染都是新的；依赖它会变成每次渲染都建单。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, cycle, signedIn, checkout.gatewayConfigured])

  const statusQuery = useQuery({
    ...trpc.billing.checkStatus.queryOptions({ orderId: order?.orderId ?? "" }),
    enabled: Boolean(order),
    refetchInterval: (query) =>
      query.state.data?.status === "paid" ? false : 2000,
  })

  const status = statusQuery.data?.status
  const paid = status === "paid"

  /**
   * 重开一张单。
   *
   * 必须先清掉旧单：不清的话，「重新获取」按下去之后 `order` 还是那张已过期的单，
   * 界面会继续显示灰掉的二维码而不是「正在生成二维码…」，直到新单回来为止。
   */
  const retry = () => {
    resetCheckout()
    create.mutate({ plan: "pro", cycle })
  }

  /** 切周期也是一次「换一张单」，所以与 `retry` 一样先清空。 */
  const handleCycle = (next: SubscriptionCycle) => {
    if (next === cycle) return
    setCycle(next)
    resetCheckout()
  }

  // 支付成功 → 让定价卡与控制台徽标立刻换状态，而不是等下一次整页渲染。
  useEffect(() => {
    if (!paid) return
    void queryClient.invalidateQueries({
      queryKey: trpc.billing.getMySubscription.queryKey(),
    })
  }, [paid, queryClient, trpc])

  const simulate = useMutation({
    mutationFn: async (outcome: "success" | "fail") => {
      if (!order) throw new Error("no order")
      const response = await fetch(`/api/pay/simulate/${order.orderId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outcome }),
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          error?: string
        }
        throw new Error(body.error ?? "模拟支付失败")
      }
      return response.json()
    },
    onSuccess: (_data, outcome) => {
      if (outcome === "success") {
        setConfirming(true)
      }
      void statusQuery.refetch()
    },
    onError: (cause) => setError(cause.message),
  })

  const phase: Phase = !signedIn
    ? "login"
    : !checkout.gatewayConfigured
      ? "config"
      : error
        ? "error"
        : !order
          ? "creating"
          : paid
            ? "success"
            : confirming
              ? "confirming"
              : // `closed` 是服务端已经把这张单作废了（过期被收掉、或建单时网关
                // 失败），它和本地时钟判断的过期是同一个结局：换个码再来一次。
                status === "closed" || order.expiresAt.getTime() <= now
                ? "expired"
                : "pending"

  /**
   * 距二维码失效还有多久。
   *
   * 每秒重算一次（上面的 interval 就是为它跑的）。它**只**决定什么时候把二维码
   * 换成「重新获取」——支付结果一律以 `checkStatus` 轮询为准，本机时钟证明不了
   * 微信那边发生了什么。
   */
  const remainingMs = order ? Math.max(0, order.expiresAt.getTime() - now) : 0
  const countdown = `${String(Math.floor(remainingMs / 60000)).padStart(2, "0")}:${String(
    Math.floor((remainingMs % 60000) / 1000)
  ).padStart(2, "0")}`

  const close = () => {
    onOpenChange(false)
    // 关掉后落地页的 CTA 要反映新状态（已开通 / 仍在等支付）。
    router.refresh()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close()
        else {
          // 打开就是一次新的结账：上一次留下的订单与错误信息不该透出来。
          // 放在事件里而不是 effect 里，是因为渲染期间不能同步 setState。
          resetCheckout()
          onOpenChange(next)
        }
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>开通 Pro 持续监控</DialogTitle>
          <DialogDescription>
            {phase === "success"
              ? "监控列表与邮件告警已生效。"
              : "扫码支付后立即生效，无需刷新页面。"}
          </DialogDescription>
        </DialogHeader>

        {phase === "login" ? (
          <LoginCard />
        ) : phase === "config" ? (
          <Notice title="支付暂未开放">
            微信商户通道正在配置中。榜单、异动与证据时间轴照常免费开放，开通后
            我们会第一时间通知你。
            <div className="mt-4">
              <ContactLink />
            </div>
          </Notice>
        ) : phase === "error" ? (
          <Notice title="没能创建订单">
            {error}
            <div className="mt-4 flex gap-2">
              <RetryButton onClick={retry}>重试</RetryButton>
              <ContactLink />
            </div>
          </Notice>
        ) : phase === "success" ? (
          <SuccessPanel
            activeUntil={statusQuery.data?.activeUntil ?? null}
            onEnter={() => {
              onOpenChange(false)
              router.push(returnPath)
            }}
          />
        ) : (
          <>
            <CycleTabs
              prices={checkout.prices}
              value={cycle}
              onChange={handleCycle}
              renewal={renewal}
            />

            {(phase === "creating" || phase === "confirming" || !order) && (
              <div className="grid place-items-center gap-3 py-10 text-sm text-muted-foreground">
                <Spinner />
                {phase === "confirming" ? "支付确认中…" : "正在生成二维码…"}
              </div>
            )}

            {phase === "expired" && order && (
              <div className="grid place-items-center gap-4 py-8 text-center">
                <QrFrame payload={order.qrDataUrl} muted />
                <p className="text-sm text-muted-foreground">
                  二维码已过期，订单未支付。
                </p>
                <RetryButton onClick={retry}>重新获取二维码</RetryButton>
              </div>
            )}

            {phase === "pending" && order && price && (
              <div className="grid gap-5 sm:grid-cols-[auto_1fr] sm:items-start">
                <div className="mx-auto grid gap-2 justify-items-center">
                  <QrFrame payload={order.qrDataUrl} />
                  <p className="text-xs text-muted-foreground">
                    微信扫一扫 · 手机端可长按识别
                  </p>
                  <CopyButton value={order.qrPayload}>复制支付链接</CopyButton>
                </div>

                <div className="grid gap-4 text-sm">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-muted-foreground">应付</span>
                    <span className="font-display text-2xl font-bold tracking-tight">
                      {fenToYuan(order.amountFen)}
                    </span>
                  </div>
                  {order.renewal && price ? (
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-muted-foreground">原价 · 续费 8 折</span>
                      <span className="font-medium text-muted-foreground line-through">
                        {fenToYuan(price.amountFen)}
                      </span>
                    </div>
                  ) : null}
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-muted-foreground">支付方式</span>
                    <span className="font-medium">微信扫码</span>
                  </div>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-muted-foreground">二维码有效期</span>
                    <span className="font-mono tabular-nums">{countdown}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    付款后自动开通，无需刷新。订单号 {order.orderId}
                  </p>

                  {checkout.simulation && (
                    <div className="grid gap-2 rounded-xl border border-dashed p-3">
                      <RetryButton
                        onClick={() => simulate.mutate("success")}
                        disabled={simulate.isPending}
                      >
                        模拟支付成功
                      </RetryButton>
                      <RetryButton
                        variant="outline"
                        onClick={() => simulate.mutate("fail")}
                        disabled={simulate.isPending}
                      >
                        模拟支付失败
                      </RetryButton>
                      <p className="text-[11px] text-muted-foreground">
                        仅开发环境（PAYMENT_SIMULATE）可见。
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}

        {phase !== "success" && (
          <p className="border-t pt-3 text-[11px] text-muted-foreground">
            {renewal
              ? "续费享 8 折 · 提前续费不丢已付时间，从当前到期日后顺延"
              : "付费计划支持 14 天无理由退款 · 年付享 8 折"}
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** 月付 / 年付的切换。选中态靠底色而不是边框——两个 tab 一直都在，边框会读成按钮。 */
function CycleTabs({
  prices,
  value,
  onChange,
  renewal = false,
}: {
  prices: PlanPrice[]
  value: SubscriptionCycle
  onChange: (next: SubscriptionCycle) => void
  /** 续费态下展示折后价，并给价格加一个「8 折」小标。 */
  renewal?: boolean
}) {
  return (
    <div className="grid grid-cols-2 gap-2 rounded-xl border border-border bg-muted/40 p-1">
      {(Object.keys(CYCLE_META) as SubscriptionCycle[]).map((key) => {
        const price = prices.find((row) => row.plan === "pro" && row.cycle === key)
        const selected = value === key
        return (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            className={`rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors ${
              selected
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <span className="block">{CYCLE_META[key].name}</span>
            <span className="block text-xs font-normal text-muted-foreground">
              {price
                ? `${renewal ? price.renewalDisplay : price.display}${CYCLE_META[key].suffix}`
                : "—"}
              {renewal && price ? (
                <span className="ml-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                  8 折
                </span>
              ) : null}
            </span>
          </button>
        )
      })}
    </div>
  )
}

function QrFrame({ payload, muted = false }: { payload: string; muted?: boolean }) {
  return (
    <div
      className={`grid size-60 place-items-center overflow-hidden rounded-xl border border-border bg-white p-2 ${
        muted ? "opacity-40" : ""
      }`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={payload}
        width={240}
        height={240}
        alt="微信支付二维码"
        className="size-full"
      />
    </div>
  )
}

function LoginCard() {
  return (
    <div className="grid gap-4 py-4 text-sm">
      <p className="text-muted-foreground">
        开通前请先登录。订阅绑定在账号上——换设备、换浏览器都还能恢复，不登录则无处可放。
      </p>
      <LocaleLink
        href={`/sign-in?callbackURL=${encodeURIComponent(SIGN_IN_CALLBACK)}`}
        className="block rounded-xl bg-primary px-4 py-2.5 text-center text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
      >
        登录 / 注册
      </LocaleLink>
    </div>
  )
}

function SuccessPanel({
  activeUntil,
  onEnter,
}: {
  activeUntil: Date | null
  onEnter: () => void
}) {
  return (
    <div className="grid justify-items-center gap-3 py-6 text-center">
      <span className="grid size-12 place-items-center rounded-full bg-primary/15 text-2xl text-primary">
        ✓
      </span>
      <p className="font-display text-lg font-semibold">已开通 Pro</p>
      <p className="text-sm text-muted-foreground">
        监控列表与邮件告警已生效
        {activeUntil ? ` · 有效期至 ${activeUntil.toLocaleDateString("zh-CN")}` : ""}
      </p>
      <button
        type="button"
        onClick={onEnter}
        className="mt-2 rounded-xl bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
      >
        进入控制台 <span aria-hidden>→</span>
      </button>
    </div>
  )
}

function Notice({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <div className="grid gap-2 py-4 text-sm">
      <p className="font-medium">{title}</p>
      <div className="text-muted-foreground">{children}</div>
    </div>
  )
}

function Spinner() {
  return (
    <span className="size-5 animate-spin rounded-full border-2 border-border border-t-primary" />
  )
}

function RetryButton({
  children,
  onClick,
  variant = "solid",
  disabled,
}: {
  children: ReactNode
  onClick: () => void
  variant?: "solid" | "outline"
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-xl px-4 py-2 text-sm font-medium transition-opacity disabled:opacity-60 ${
        variant === "solid"
          ? "bg-primary text-primary-foreground hover:opacity-90"
          : "border border-border bg-card text-foreground hover:bg-accent"
      }`}
    >
      {children}
    </button>
  )
}

function ContactLink() {
  return (
    <LocaleLink
      href="/contact"
      className="inline-block text-sm font-medium text-secondary-foreground transition-colors hover:text-foreground"
    >
      联系团队 →
    </LocaleLink>
  )
}

function CopyButton({
  value,
  children,
}: {
  value: string
  children: ReactNode
}) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard
          ?.writeText(value)
          .then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 1600)
          })
          .catch(() => setCopied(false))
      }}
      className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
    >
      {copied ? "已复制" : children}
    </button>
  )
}
