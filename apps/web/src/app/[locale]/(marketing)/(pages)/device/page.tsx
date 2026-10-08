import { Metadata } from 'next'
import { DeviceAuthPage } from '@/components/device-auth/device-auth-page'

export const metadata: Metadata = {
  title: '设备授权 - OpenMCP Hub',
  description: 'OAuth 设备授权流程',
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ user_code?: string }>
}) {
  const params = await searchParams
  return <DeviceAuthPage initialUserCode={params.user_code} />
}
