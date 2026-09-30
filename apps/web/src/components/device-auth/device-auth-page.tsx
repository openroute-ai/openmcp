'use client'

import { Alert, AlertDescription } from '@workspace/ui/components/alert'
import { Button } from '@workspace/ui/components/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { Input } from '@workspace/ui/components/input'
import { CheckCircle2, Loader2, Shield, XCircle } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

interface DeviceAuthPageProps {
  initialUserCode?: string
}

export function DeviceAuthPage({ initialUserCode }: DeviceAuthPageProps) {
  const router = useRouter()
  const [userCode, setUserCode] = useState(initialUserCode || '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [step, setStep] = useState<'input' | 'confirm' | 'success' | 'denied'>('input')

  useEffect(() => {
    if (initialUserCode) {
      setUserCode(initialUserCode.toUpperCase())
    }
  }, [initialUserCode])

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '')
    setUserCode(value)
    setError('')
  }

  const handleContinue = () => {
    if (!userCode || userCode.length < 8) {
      setError('请输入有效的授权码')
      return
    }
    setStep('confirm')
  }

  const handleAuthorize = async () => {
    setLoading(true)
    setError('')

    try {
      const response = await fetch('/api/mcp/store/oauth/authorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_code: userCode, action: 'authorize' }),
      })

      const data = await response.json()

      if (!response.ok) {
        if (response.status === 401) {
          // Not logged in - redirect to sign in
          router.push(`/sign-in?redirect=/device?user_code=${userCode}`)
          return
        }
        throw new Error(data.error || '授权失败')
      }

      setStep('success')
    } catch (err: any) {
      setError(err.message || '授权失败，请重试')
      setStep('confirm')
    } finally {
      setLoading(false)
    }
  }

  const handleDeny = async () => {
    setLoading(true)
    setError('')

    try {
      const response = await fetch('/api/mcp/store/oauth/authorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_code: userCode, action: 'deny' }),
      })

      if (!response.ok) {
        throw new Error('操作失败')
      }

      setStep('denied')
    } catch (err: any) {
      setError(err.message || '操作失败，请重试')
    } finally {
      setLoading(false)
    }
  }

  const handleReset = () => {
    setUserCode('')
    setError('')
    setStep('input')
    setLoading(false)
  }

  if (step === 'success') {
    return (
      <div className='mx-auto w-full max-w-md px-gutter py-12 sm:px-gutter-sm lg:px-gutter-lg'>
        <Card>
          <CardHeader className='text-center'>
            <div className='mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100'>
              <CheckCircle2 className='h-10 w-10 text-green-600' />
            </div>
            <CardTitle className='text-2xl'>授权成功</CardTitle>
            <CardDescription>您已成功授权 OpenMCP Store MCP 访问您的账户</CardDescription>
          </CardHeader>
          <CardContent className='text-center text-muted-foreground text-sm'>
            <p className='mb-4'>现在可以关闭此页面，返回您的 Agent 继续操作。</p>
            <p className='text-xs'>Agent 将自动获取访问令牌并完成安装流程。</p>
          </CardContent>
          <CardFooter>
            <Button variant='outline' onClick={handleReset} className='w-full'>
              授权其他设备
            </Button>
          </CardFooter>
        </Card>
      </div>
    )
  }

  if (step === 'denied') {
    return (
      <div className='mx-auto w-full max-w-md px-gutter py-12 sm:px-gutter-sm lg:px-gutter-lg'>
        <Card>
          <CardHeader className='text-center'>
            <div className='mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-100'>
              <XCircle className='h-10 w-10 text-red-600' />
            </div>
            <CardTitle className='text-2xl'>授权已拒绝</CardTitle>
            <CardDescription>您已拒绝此设备的授权请求</CardDescription>
          </CardHeader>
          <CardContent className='text-center text-muted-foreground text-sm'>
            <p>该设备将无法访问您的 OpenMCP 账户。</p>
          </CardContent>
          <CardFooter>
            <Button variant='outline' onClick={handleReset} className='w-full'>
              重新授权
            </Button>
          </CardFooter>
        </Card>
      </div>
    )
  }

  if (step === 'confirm') {
    return (
      <div className='mx-auto w-full max-w-md px-gutter py-12 sm:px-gutter-sm lg:px-gutter-lg'>
        <Card>
          <CardHeader className='text-center'>
            <div className='mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-blue-100'>
              <Shield className='h-10 w-10 text-blue-600' />
            </div>
            <CardTitle className='text-2xl'>授权请求</CardTitle>
            <CardDescription>确认授权此设备访问您的 OpenMCP 账户</CardDescription>
          </CardHeader>
          <CardContent className='space-y-4'>
            {error && (
              <Alert variant='destructive'>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className='space-y-2'>
              <div className='font-medium text-sm'>应用</div>
              <div className='text-muted-foreground text-sm'>OpenMCP Store MCP</div>
            </div>

            <div className='space-y-2'>
              <div className='font-medium text-sm'>授权码</div>
              <div className='font-bold font-mono text-lg'>{userCode}</div>
            </div>

            <div className='space-y-2'>
              <div className='font-medium text-sm'>请求的权限</div>
              <ul className='space-y-1 text-muted-foreground text-sm'>
                <li>✓ 查看和搜索 Skills</li>
                <li>✓ 安装 Skills 到您的设备</li>
                <li>✓ 访问您的下载和安装列表</li>
              </ul>
            </div>
          </CardContent>
          <CardFooter className='flex gap-2'>
            <Button variant='outline' onClick={handleDeny} disabled={loading} className='flex-1'>
              拒绝
            </Button>
            <Button onClick={handleAuthorize} disabled={loading} className='flex-1'>
              {loading && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
              授权
            </Button>
          </CardFooter>
        </Card>
      </div>
    )
  }

  return (
    <div className='mx-auto w-full max-w-md px-gutter py-12 sm:px-gutter-sm lg:px-gutter-lg'>
      <Card>
        <CardHeader className='text-center'>
          <CardTitle className='text-2xl'>设备授权</CardTitle>
          <CardDescription>请输入显示在您设备上的授权码</CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          {error && (
            <Alert variant='destructive'>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className='space-y-2'>
            <label htmlFor='user-code' className='font-medium text-sm'>
              授权码
            </label>
            <Input
              id='user-code'
              type='text'
              placeholder='ABCD-1234'
              value={userCode}
              onChange={handleInputChange}
              maxLength={9}
              className='text-center font-mono text-lg uppercase'
              autoComplete='off'
              autoFocus
            />
            <p className='text-muted-foreground text-xs'>格式：XXXX-XXXX（不区分大小写）</p>
          </div>
        </CardContent>
        <CardFooter>
          <Button onClick={handleContinue} disabled={!userCode || userCode.length < 8} className='w-full'>
            继续
          </Button>
        </CardFooter>
      </Card>

      <div className='mt-6 text-center text-muted-foreground text-sm'>
        <p>没有授权码？</p>
        <p className='mt-1'>请在您的 Agent 中运行安装命令，系统会生成授权码。</p>
      </div>
    </div>
  )
}
