import { notFound } from 'next/navigation'
import type { MyAssetType } from '@/components/assets/assets-data'
import { MyAssetsPage } from '@/components/assets/assets-list'

interface MyAssetsRouteProps {
  params: Promise<{
    type: string
  }>
}

const VALID_TYPES: MyAssetType[] = ['mcp', 'a2a', 'skills']

export default async function MyAssetsRoute({ params }: MyAssetsRouteProps) {
  const { type } = await params

  if (!VALID_TYPES.includes(type as MyAssetType)) {
    notFound()
  }

  return <MyAssetsPage type={type as MyAssetType} />
}
