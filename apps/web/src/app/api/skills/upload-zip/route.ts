import { type NextRequest, NextResponse } from 'next/server'
import { failResult } from '@/lib/gateway/input'
import { parseSkillMeta, unzipTextFiles } from '@/lib/zip/unzip-text'
import { getUploadUserId, unauthorizedUpload } from '@/server/storage/guard'
import { requireVerifiedProviderForPublish } from '@/web/providers/author'
import { skillsGatewayAccess } from '@/web/skills/gateway'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Kept in step with the `skill` upload scope in src/server/storage/policy.ts. */
const MAX_ZIP_BYTES = 50 * 1024 * 1024
const MAX_FILES = 200

/**
 * ZIP import for skills.
 *
 * The archive is expanded on the server and only text entries are kept, so a
 * package cannot smuggle executables or huge binaries into the listing. The
 * browser never sends a parsed file list: doing the extraction here means the
 * path names and the file count are decided by this route, not by the client.
 */
export async function POST(request: NextRequest) {
  const userId = await getUploadUserId()
  if (!userId) return unauthorizedUpload()

  let file: File | null = null
  const form = await request.formData().catch(() => null)
  if (form) {
    const candidate = form.get('file')
    file = candidate instanceof File ? candidate : null
  }
  if (!file) {
    return NextResponse.json({ error: 'No ZIP file provided' }, { status: 400 })
  }
  if (file.size > MAX_ZIP_BYTES) {
    return NextResponse.json({ error: 'ZIP is larger than the 50MB limit' }, { status: 400 })
  }

  const read = (key: string): string => {
    const value = form?.get(key)
    return typeof value === 'string' ? value.trim() : ''
  }

  const priceType = read('priceType') === 'paid' ? 'paid' : 'free'
  const billingModel = read('billingModel') as
    | 'one_time'
    | 'subscription'
    | 'pay_per_call'
    | ''
  const priceAmount = read('priceAmount')
  const unitPrice = read('unitPrice')
  const description = read('description')
  const imageUrl = read('imageUrl')
  const scope = (read('scope') || 'public') as 'public' | 'private' | 'team'
  // An explicit name override is optional; otherwise the metadata file decides.
  const nameOverride = read('name')

  const files = unzipTextFiles(Buffer.from(await file.arrayBuffer()), MAX_FILES)
  if (files.length === 0) {
    return NextResponse.json(
      { error: 'No readable skill text files were found in the ZIP' },
      { status: 400 }
    )
  }

  const meta = parseSkillMeta(files)

  try {
    const { authorId } = await requireVerifiedProviderForPublish(userId, {
      requirePayChannel: priceType === 'paid',
    })

    const data = await skillsGatewayAccess.connectFromParsed({
      authorId,
      name: nameOverride || meta.name,
      description: description || meta.description || null,
      version: meta.version || null,
      license: meta.license || null,
      files,
      imageUrl: imageUrl || null,
      visibility: scope,
      priceType,
      billingModel: priceType === 'paid' && billingModel ? billingModel : null,
      priceAmount: priceType === 'paid' && priceAmount ? priceAmount : null,
      unitPrice: priceType === 'paid' && billingModel === 'pay_per_call' && unitPrice ? unitPrice : null,
    })

    return NextResponse.json({
      success: true,
      data,
      meta: { name: nameOverride || meta.name, fileCount: files.length },
    })
  } catch (error) {
    const failure = failResult(error, 'Could not import the ZIP package')
    return NextResponse.json(failure, { status: 400 })
  }
}
