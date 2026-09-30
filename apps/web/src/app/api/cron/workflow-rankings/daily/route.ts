import { runRankingCron } from '@/lib/cron/run-ranking'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  return runRankingCron(request, 'daily', '日排行')
}

export async function POST(request: Request) {
  return runRankingCron(request, 'daily', '日排行')
}
