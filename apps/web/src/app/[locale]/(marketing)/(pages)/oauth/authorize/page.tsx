'use client'

import { Alert, AlertDescription } from '@workspace/ui/components/alert'
import { Button } from '@workspace/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { AlertCircle, CheckCircle, Shield } from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import { useState } from 'react'

export default function OAuthAuthorizePage() {
  const searchParams = useSearchParams()

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  const clientId = searchParams.get('client_id')
  const clientName = searchParams.get('client_name') || '未知应用'
  const redirectUri = searchParams.get('redirect_uri')
  const scope = searchParams.get('scope') || 'skills:read skills:install'
  const state = searchParams.get('state')
  const codeChallenge = searchParams.get('code_challenge')
  const codeChallengeMethod = searchParams.get('code_challenge_method')

  if (!clientId || !redirectUri) {
    return (
      <div className='mx-auto w-full max-w-md px-gutter py-12 sm:px-gutter-sm lg:px-gutter-lg'>
        <Alert variant='destructive'>
          <AlertCircle className='h-4 w-4' />
          <AlertDescription>缺少必需参数，请检查授权链接是否正确。</AlertDescription>
        </Alert>
      </div>
    )
  }

  const scopes = scope.split(' ')
  const scopeDescriptions: Record<string, string> = {
    'skills:read': '查看和搜索 Skills',
    'skills:install': '安装 Skills 到您的设备',
  }

  const handleAuthorize = async (action: 'allow' | 'deny') => {
    try {
      setLoading(true)
      setError('')

      const response = await fetch('/api/mcp/store/oauth/authorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          redirect_uri: redirectUri,
          scope,
          state,
          code_challenge: codeChallenge,
          code_challenge_method: codeChallengeMethod,
          action,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error_description || '授权失败')
      }

      if (data.redirect) {
        if (action === 'allow') {
          setSuccess(true)
          // 等待 2 秒后重定向，让用户看到成功消息
          setTimeout(() => {
            window.location.href = data.redirect
          }, 2000)
        } else {
          window.location.href = data.redirect
        }
      }
    } catch (err: any) {
      setError(err.message || '操作失败')
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <div className='mx-auto w-full max-w-md px-gutter py-12 sm:px-gutter-sm lg:px-gutter-lg'>
        <Card>
          <CardContent className='py-12 text-center'>
            <CheckCircle className='mx-auto mb-4 h-12 w-12 text-green-600' />
            <p className='font-medium text-lg'>授权成功！</p>
            <p className='mt-2 text-muted-foreground text-sm'>正在返回应用...</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className='mx-auto w-full max-w-md px-gutter py-12 sm:px-gutter-sm lg:px-gutter-lg'>
      <Card>
        <CardHeader>
          <div className='flex items-center gap-3'>
            <Shield className='h-8 w-8 text-primary' />
            <div>
              <CardTitle>授权请求</CardTitle>
              <CardDescription className='mt-1'>{clientName} 请求访问您的 OpenMCP 账户</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className='space-y-6'>
          {error && (
            <Alert variant='destructive'>
              <AlertCircle className='h-4 w-4' />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div>
            <h3 className='mb-3 font-medium'>该应用请求以下权限：</h3>
            <ul className='space-y-2'>
              {scopes.map((s) => (
                <li key={s} className='flex items-start gap-2'>
                  <CheckCircle className='mt-0.5 h-4 w-4 text-green-600' />
                  <span className='text-sm'>{scopeDescriptions[s] || s}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className='rounded-lg bg-muted p-4 text-sm'>
            <p className='font-medium'>应用信息</p>
            <div className='mt-2 space-y-1 text-muted-foreground'>
              <p>应用名称：{clientName}</p>
              <p>客户端 ID：{clientId}</p>
            </div>
          </div>

          <div className='flex gap-3'>
            <Button variant='outline' className='flex-1' onClick={() => handleAuthorize('deny')} disabled={loading}>
              拒绝
            </Button>
            <Button className='flex-1' onClick={() => handleAuthorize('allow')} disabled={loading}>
              {loading ? '授权中...' : '授权'}
            </Button>
          </div>

          <p className='text-center text-muted-foreground text-xs'>授权后，您可以随时在「账户设置」中撤销此授权</p>
        </CardContent>
      </Card>
    </div>
  )
}
