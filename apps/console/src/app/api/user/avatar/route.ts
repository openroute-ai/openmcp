/**
 * Uploads an avatar and returns its public URL.
 *
 * The URL, not the bytes, is what leaves this route. Everything else about the
 * account — `name`, `image` — is written through better-auth's own
 * `/update-user`, so the client sets `image` to whatever comes back; if this
 * upload succeeded and that write did not, the worst case is an orphaned object
 * in the bucket, which the versioning policy in `generateOSSPath` already
 * tolerates.
 *
 * Session required: this is an authenticated write to the bucket.
 */
import { NextResponse } from "next/server"

import { getFullSessionUser } from "@/lib/auth/session"
import { hasAliyunOss } from "@/lib/env"
import { ossClient } from "@/lib/oss/client"

/** 2 MB. An avatar is displayed at 32–40 px; past this it is someone's camera roll. */
const MAX_BYTES = 2 * 1024 * 1024

const CONTENT_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
}

/**
 * An account's own avatar, keyed by user id.
 *
 * Not under `generateOSSPath`, which files assets under a repository name: an
 * avatar belongs to an account, and reusing the repository path builder for it
 * would invent a repository to file it under.
 */
function avatarPath(userId: string, extension: string): string {
  return `mcp/authors/${userId}/avatar/${Date.now()}.${extension}`
}

export async function POST(request: Request) {
  const session = await getFullSessionUser()
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  if (!hasAliyunOss()) {
    return NextResponse.json({ error: "oss_not_configured" }, { status: 503 })
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 })
  }

  const file = form.get("file")
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file_required" }, { status: 400 })
  }

  // The declared type is checked rather than sniffed from the bytes: an avatar
  // is rendered as an `<img>`, and the type decides what the browser will try to
  // decode. Anything outside this list is not an image we are willing to store.
  const extension = CONTENT_TYPES[file.type]
  if (!extension) {
    return NextResponse.json({ error: "unsupported_type" }, { status: 415 })
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "too_large" }, { status: 413 })
  }

  try {
    const url = await ossClient.uploadBuffer(
      Buffer.from(await file.arrayBuffer()),
      avatarPath(session.id, extension),
      { "Content-Type": file.type }
    )
    return NextResponse.json({ url })
  } catch (error) {
    console.error("[console] avatar upload failed:", error)
    return NextResponse.json({ error: "upload_failed" }, { status: 502 })
  }
}
