import { type NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import {
  hasUnsafeArchive,
  parseSkillMeta,
  unsafeRejections,
  unzipTextFilesWithReport,
} from "@/lib/zip/unzip-text"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const MAX_ZIP_BYTES = 50 * 1024 * 1024

/**
 * Parses a ZIP archive and returns its `skill.yaml` metadata without persisting
 * anything. The "Connect a new Skill" wizard calls this from its source step to
 * prefill the listing form; the record itself is created only after the operator
 * has filled in the remaining fields and the package has been scanned.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers })
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: "未登录" },
        { status: 401 }
      )
    }

    const form = await request.formData()
    const file = form.get("file")
    if (!(file instanceof File)) {
      return NextResponse.json(
        { success: false, error: "请上传 ZIP 文件" },
        { status: 400 }
      )
    }
    if (file.size > MAX_ZIP_BYTES) {
      return NextResponse.json(
        { success: false, error: "ZIP 不能超过 50MB" },
        { status: 400 }
      )
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const { files, rejections } = unzipTextFilesWithReport(buffer)
    // 与 `upload-zip` 同样的判断：穿越/符号链接/重复路径/目录不一致直接拒绝整包。
    // 少一层解析就少一处有人会顺手加逻辑的地方，所以两处共用同一个判定。
    if (hasUnsafeArchive(rejections)) {
      const unsafe = unsafeRejections(rejections)
      console.warn(
        "[skills/parse-zip] rejected archive with unsafe entry names",
        {
          userId: session.user.id,
          count: unsafe.length,
          samples: unsafe.slice(0, 5).map((r) => r.detail),
        }
      )
      return NextResponse.json(
        {
          success: false,
          error: "ZIP 含有不安全的内容（路径穿越、符号链接、重复路径或损坏的目录结构），已拒绝",
        },
        { status: 400 }
      )
    }
    if (files.length === 0) {
      return NextResponse.json(
        { success: false, error: "ZIP 中未找到可读的 Skill 文本文件" },
        { status: 400 }
      )
    }

    const meta = parseSkillMeta(files)
    return NextResponse.json({
      success: true,
      data: {
        name: meta.name || file.name.replace(/\.zip$/i, ""),
        description: meta.description,
        version: meta.version,
        license: meta.license,
        fileCount: files.length,
        fileName: file.name,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "ZIP 解析失败"
    console.error("[skills/parse-zip]", error)
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    )
  }
}
