/**
 * `resolveWriteTarget` 的解析规则。
 *
 * 重点是 `callbackUrl`：它是本服务会去 POST 的地址，也就是这条端点上唯一的
 * SSRF 面。测试因此覆盖两件事——能投递的地址必须放行，不能投递的 scheme 必须
 * 在构造请求之前就拒掉。
 *
 * 这里刻意只测 scheme 而不测主机：console 与 web 同机部署是正常形态，把
 * loopback / 内网地址一并拒掉会把这个功能唯一的目标用法挡在门外。
 */
import { describe, expect, it } from "vitest"
import { resolveWriteTarget } from "@/lib/api/write-request"

const SECRET = "callback-secret"

describe("resolveWriteTarget", () => {
  it("accepts either address shape", () => {
    expect(resolveWriteTarget({ url: "https://github.com/acme/pdf" })).toMatchObject({
      ok: true,
      target: { fullName: "acme/pdf" },
    })
    expect(resolveWriteTarget({ repo: "acme/pdf" })).toMatchObject({
      ok: true,
      target: { fullName: "acme/pdf" },
    })
  })

  it("rejects both address shapes at once", () => {
    const result = resolveWriteTarget({ url: "https://github.com/acme/pdf", repo: "acme/pdf" })
    expect(result.ok).toBe(false)
  })

  it("requires a secret alongside a callback URL", () => {
    // 常量等于公开，派生自 API key 等于把 key 的寿命绑到回调上，两种默认值都不做。
    const result = resolveWriteTarget({
      url: "https://github.com/acme/pdf",
      callbackUrl: "https://web.example/api/webhook/daily/skills",
    })
    expect(result).toMatchObject({ ok: false, code: "invalid_body" })
  })

  it("accepts http and https callback URLs", () => {
    for (const url of ["https://web.example/hook", "http://localhost:20001/hook"]) {
      expect(
        resolveWriteTarget({ url: "https://github.com/acme/pdf", callbackUrl: url, callbackSecret: SECRET })
      ).toMatchObject({ ok: true, target: { callback: { url, secret: SECRET } } })
    }
  })

  it("refuses a callback URL that is not http(s)", () => {
    // file: / gopher: / data: 都能被 fetch 层接受，但没有任何东西会在上面应答。
    for (const url of [
      "file:///etc/passwd",
      "gopher://127.0.0.1:6379/_SET",
      "data:text/plain,hi",
      "ftp://web.example/hook",
      "not-a-url",
      "https://",
    ]) {
      const result = resolveWriteTarget({
        url: "https://github.com/acme/pdf",
        callbackUrl: url,
        callbackSecret: SECRET,
      })
      expect(result, url).toMatchObject({ ok: false, code: "invalid_body" })
    }
  })

  it("validates the callback before the address, so a bad scheme never wins", () => {
    // 顺序不重要，但两个都必须拒：字段选对、形状对，是值不对。
    const result = resolveWriteTarget({
      url: "https://github.com/acme/pdf",
      callbackUrl: "file:///etc/passwd",
      callbackSecret: SECRET,
    })
    expect(result.ok).toBe(false)
  })
})