'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@workspace/ui/components/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@workspace/ui/components/dialog'
import { Label } from '@workspace/ui/components/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@workspace/ui/components/select'
import { Textarea } from '@workspace/ui/components/textarea'
import { trpc } from '@/lib/trpc/client'
import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '@/server/routers'
import { formatCurrency } from '@/lib/utils/formatter'

type RouterOutputs = inferRouterOutputs<AppRouter>
type AdminRechargeOrder = RouterOutputs['admin']['rechargeOrders']['getRechargeOrdersPaginated']['data'][number]

/** Mirrors the enum enforced by `admin.rechargeOrders.updateRechargeOrder`. */
type OrderStatus = 'pending' | 'pending_transfer' | 'paid' | 'expired' | 'closed' | 'failed'

interface UpdateRechargeOrderDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  rechargeOrder: AdminRechargeOrder | null
  onSuccess: () => void
}

/**
 * Status is the only financial field an admin may edit.
 *
 * Amount, currency, payment method and expiry come from the gateway (or from the
 * order-creation record) — rewriting them after the fact would desync the order
 * from what the payer actually sent. Marking an order `paid` is the one
 * transition that moves money, and the router runs it through the same
 * idempotent settle path the webhooks use.
 */
export function UpdateRechargeOrderDialog({
  open,
  onOpenChange,
  rechargeOrder,
  onSuccess,
}: UpdateRechargeOrderDialogProps) {
  // Seeded from the selected order. The page keys this component by order id,
  // so opening a different order remounts it with fresh values rather than
  // syncing props into state through an effect.
  const [status, setStatus] = useState<OrderStatus>((rechargeOrder?.status || 'pending') as OrderStatus)
  const [remark, setRemark] = useState(rechargeOrder?.remark || '')

  const updateRechargeOrderMutation = trpc.admin.rechargeOrders.updateRechargeOrder.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        toast.success('更新成功')
        onSuccess()
      } else {
        toast.error(data.error || '更新失败')
      }
    },
    onError: (error) => {
      toast.error(error.message || '更新失败')
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!rechargeOrder?.id) return
    updateRechargeOrderMutation.mutate({ id: rechargeOrder.id, status, remark })
  }

  if (!rechargeOrder) return null

  const isPaid = rechargeOrder.status === 'paid'
  const isSettling = updateRechargeOrderMutation.isPending && status === 'paid' && !isPaid

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='no-scrollbar max-h-[85vh] min-w-4xl overflow-y-auto'>
        <DialogHeader>
          <DialogTitle>更新充值订单</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className='space-y-4'>
          {/* Read-only detail: shown for context, never submitted. */}
          <div className='grid grid-cols-2 gap-4 rounded-md border p-4 text-sm'>
            <div>
              <div className='text-muted-foreground'>订单号</div>
              <div className='font-mono'>{rechargeOrder.orderId}</div>
            </div>
            <div>
              <div className='text-muted-foreground'>用户</div>
              <div className='truncate'>
                {rechargeOrder.userName || rechargeOrder.userId}
                {rechargeOrder.userEmail ? ` (${rechargeOrder.userEmail})` : ''}
              </div>
            </div>
            <div>
              <div className='text-muted-foreground'>金额</div>
              <div>{formatCurrency(rechargeOrder.amount, rechargeOrder.currency || 'CNY')}</div>
            </div>
            <div>
              <div className='text-muted-foreground'>到账积分</div>
              <div>{rechargeOrder.credits}</div>
            </div>
            <div>
              <div className='text-muted-foreground'>支付方式</div>
              <div>{rechargeOrder.paymentMethod}</div>
            </div>
            <div>
              <div className='text-muted-foreground'>创建时间</div>
              <div>
                {rechargeOrder.createdAt ? new Date(rechargeOrder.createdAt).toLocaleString() : '-'}
              </div>
            </div>
            {rechargeOrder.thirdPartyOrderId && (
              <div className='col-span-2'>
                <div className='text-muted-foreground'>第三方订单ID</div>
                <div className='font-mono'>{rechargeOrder.thirdPartyOrderId}</div>
              </div>
            )}
          </div>

          <div className='grid grid-cols-2 gap-4'>
            <div className='space-y-2'>
              <Label htmlFor='status'>状态 *</Label>
              <Select
                value={status}
                onValueChange={(value) => setStatus(value as OrderStatus)}
                disabled={isPaid}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='pending'>待支付</SelectItem>
                  <SelectItem value='pending_transfer'>待对账</SelectItem>
                  <SelectItem value='paid'>已支付</SelectItem>
                  <SelectItem value='failed'>支付失败</SelectItem>
                  <SelectItem value='expired'>已过期</SelectItem>
                  <SelectItem value='closed'>已关闭</SelectItem>
                </SelectContent>
              </Select>
              {isPaid && (
                <p className='text-muted-foreground text-xs'>订单已结算，状态不可回退。</p>
              )}
              {isSettling && <p className='text-muted-foreground text-xs'>正在结算到账积分…</p>}
            </div>
          </div>

          <div className='space-y-2'>
            <Label htmlFor='remark'>备注</Label>
            <Textarea id='remark' value={remark} onChange={(e) => setRemark(e.target.value)} rows={2} />
          </div>

          <div className='flex justify-end space-x-2'>
            <Button type='button' variant='outline' onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type='submit' disabled={updateRechargeOrderMutation.isPending}>
              {updateRechargeOrderMutation.isPending ? '保存中...' : '保存'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
