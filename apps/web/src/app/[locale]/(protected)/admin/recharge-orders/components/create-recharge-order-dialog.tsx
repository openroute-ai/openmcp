'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@workspace/ui/components/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@workspace/ui/components/dialog'
import { Input } from '@workspace/ui/components/input'
import { Label } from '@workspace/ui/components/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@workspace/ui/components/select'
import { Textarea } from '@workspace/ui/components/textarea'
import { trpc } from '@/lib/trpc/client'

/** Mirrors the enums enforced by `admin.rechargeOrders.createRechargeOrder`. */
type PaymentMethod = 'alipay' | 'wechat' | 'bank_transfer' | 'recharge'
type OrderStatus = 'pending' | 'pending_transfer' | 'paid' | 'expired' | 'closed' | 'failed'

interface CreateRechargeOrderDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

export function CreateRechargeOrderDialog({ open, onOpenChange, onSuccess }: CreateRechargeOrderDialogProps) {
  const [formData, setFormData] = useState({
    orderId: '',
    userId: '',
    amount: '',
    credits: '',
    currency: 'CNY',
    paymentMethod: 'alipay' as PaymentMethod,
    status: 'pending' as OrderStatus,
    thirdPartyOrderId: '',
    expiresAt: '',
    paidAt: '',
    remark: '',
    ip: '',
    userAgent: '',
  })

  const createRechargeOrderMutation = trpc.admin.rechargeOrders.createRechargeOrder.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        toast.success('创建成功')
        onSuccess()
        setFormData({
          orderId: '',
          userId: '',
          amount: '',
          credits: '',
          currency: 'CNY',
          paymentMethod: 'alipay' as PaymentMethod,
          status: 'pending' as OrderStatus,
          thirdPartyOrderId: '',
          expiresAt: '',
          paidAt: '',
          remark: '',
          ip: '',
          userAgent: '',
        })
      } else {
        toast.error(data.error || '创建失败')
      }
    },
    onError: (error) => {
      toast.error(error.message || '创建失败')
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    const submitData = {
      ...formData,
      // Empty means "1:1 with amount", which the server resolves.
      credits: formData.credits || undefined,
      expiresAt: formData.expiresAt
        ? new Date(formData.expiresAt)
        : new Date(Date.now() + 30 * 60 * 1000), // 默认30分钟后过期
      paidAt: formData.paidAt ? new Date(formData.paidAt) : undefined,
      // Empty text should clear the column, not insert an empty string.
      thirdPartyOrderId: formData.thirdPartyOrderId || undefined,
      remark: formData.remark || undefined,
      ip: formData.ip || undefined,
      userAgent: formData.userAgent || undefined,
    }

    createRechargeOrderMutation.mutate(submitData)
  }

  const handleInputChange = <K extends keyof typeof formData>(field: K, value: (typeof formData)[K]) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='no-scrollbar max-h-[85vh] min-w-4xl overflow-y-auto'>
        <DialogHeader>
          <DialogTitle>创建充值订单</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className='space-y-4'>
          <div className='grid grid-cols-2 gap-4'>
            <div className='space-y-2'>
              <Label htmlFor='orderId'>订单号 *</Label>
              <Input
                id='orderId'
                value={formData.orderId}
                onChange={(e) => handleInputChange('orderId', e.target.value)}
                required
              />
            </div>

            <div className='space-y-2'>
              <Label htmlFor='userId'>用户ID *</Label>
              <Input
                id='userId'
                value={formData.userId}
                onChange={(e) => handleInputChange('userId', e.target.value)}
                required
              />
            </div>
          </div>

          <div className='grid grid-cols-2 gap-4'>
            <div className='space-y-2'>
              <Label htmlFor='amount'>金额 *</Label>
              <Input
                id='amount'
                type='number'
                step='0.01'
                min='0'
                value={formData.amount}
                onChange={(e) => handleInputChange('amount', e.target.value)}
                required
              />
            </div>

            <div className='space-y-2'>
              <Label htmlFor='credits'>到账积分</Label>
              <Input
                id='credits'
                type='number'
                step='0.01'
                min='0'
                placeholder='默认与金额 1:1'
                value={formData.credits}
                onChange={(e) => handleInputChange('credits', e.target.value)}
              />
            </div>
          </div>

          <div className='grid grid-cols-2 gap-4'>
            <div className='space-y-2'>
              <Label htmlFor='currency'>货币</Label>
              <Select value={formData.currency} onValueChange={(value) => handleInputChange('currency', value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='CNY'>人民币 (CNY)</SelectItem>
                  <SelectItem value='USD'>美元 (USD)</SelectItem>
                  <SelectItem value='EUR'>欧元 (EUR)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className='space-y-2'>
              <Label htmlFor='paymentMethod'>支付方式 *</Label>
              <Select
                value={formData.paymentMethod}
                onValueChange={(value) => handleInputChange('paymentMethod', value as PaymentMethod)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='alipay'>支付宝</SelectItem>
                  <SelectItem value='wechat'>微信支付</SelectItem>
                  <SelectItem value='bank_transfer'>银行转账</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className='space-y-2'>
              <Label htmlFor='status'>状态 *</Label>
              <Select
                value={formData.status}
                onValueChange={(value) => handleInputChange('status', value as OrderStatus)}
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
            </div>
          </div>

          <div className='space-y-2'>
            <Label htmlFor='thirdPartyOrderId'>第三方订单ID</Label>
            <Input
              id='thirdPartyOrderId'
              value={formData.thirdPartyOrderId}
              onChange={(e) => handleInputChange('thirdPartyOrderId', e.target.value)}
            />
          </div>

          <div className='grid grid-cols-2 gap-4'>
            <div className='space-y-2'>
              <Label htmlFor='expiresAt'>过期时间 *</Label>
              <Input
                id='expiresAt'
                type='datetime-local'
                value={formData.expiresAt}
                onChange={(e) => handleInputChange('expiresAt', e.target.value)}
                required
              />
            </div>

            <div className='space-y-2'>
              <Label htmlFor='paidAt'>支付完成时间</Label>
              <Input
                id='paidAt'
                type='datetime-local'
                value={formData.paidAt}
                onChange={(e) => handleInputChange('paidAt', e.target.value)}
              />
            </div>
          </div>

          <div className='space-y-2'>
            <Label htmlFor='remark'>备注</Label>
            <Textarea
              id='remark'
              value={formData.remark}
              onChange={(e) => handleInputChange('remark', e.target.value)}
              rows={2}
            />
          </div>

          <div className='grid grid-cols-2 gap-4'>
            <div className='space-y-2'>
              <Label htmlFor='ip'>IP地址</Label>
              <Input id='ip' value={formData.ip} onChange={(e) => handleInputChange('ip', e.target.value)} />
            </div>

            <div className='space-y-2'>
              <Label htmlFor='userAgent'>用户代理</Label>
              <Input
                id='userAgent'
                value={formData.userAgent}
                onChange={(e) => handleInputChange('userAgent', e.target.value)}
              />
            </div>
          </div>

          <div className='flex justify-end space-x-2'>
            <Button type='button' variant='outline' onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type='submit' disabled={createRechargeOrderMutation.isPending}>
              {createRechargeOrderMutation.isPending ? '创建中...' : '创建'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
