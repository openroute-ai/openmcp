/**
 * 出站 `fetch` 的 SSRF 防护层。
 *
 * 权重放在「攻击者控制地址」这一侧：地址怎么写、重定向怎么跳、DNS 怎么回答，
 * 都要能证明请求不会落进内网。公网成功转发是平凡路径，一行 `fetch` 就是它的
 * 实现，断言不出更多信息。
 */
import { describe, expect, it, vi } from "vitest"

import { assertOutboundTarget, SafeFetchError, safeFetch } from "@/lib/net/safe-fetch"

/** 一个公认的公网地址，让每条正向断言都不必先解释自己为什么是安全的。 */
const PUBLIC_IP = "93.184.216.34"
const publicResolve = async (): Promise<string[]> => [PUBLIC_IP]

/** 不发真请求：默认断言「根本没走到 fetch」，命中网络本身就是一个失败。 */
function unreachableFetch(): typeof fetch {
  return vi.fn(async () => {
    throw new Error("fetch must not be reached")
  }) as unknown as typeof fetch
}

async function expectBlocked(url: string, mode: "strict" | "lenient"): Promise<SafeFetchError> {
  const error = await assertOutboundTarget(url, { mode }).then(
    () => null,
    (reason: unknown) => reason
  )
  expect(error).toBeInstanceOf(SafeFetchError)
  expect((error as SafeFetchError).code).toBe("blocked_target")
  return error as SafeFetchError
}

describe("strict 出站策略", () => {
  it.each([
    ["环回", "http://127.0.0.1/"],
    ["私网 10/8", "http://10.0.0.1/"],
    ["私网 172.16/12", "http://172.16.0.1/"],
    ["私网 192.168/16", "http://192.168.1.1/"],
    ["CGNAT", "http://100.64.0.1/"],
    ["链路本地与云元数据", "http://169.254.169.254/latest/meta-data/"],
    ["阿里云元数据", "http://100.100.100.200/"],
    ["this network", "http://0.0.0.0/"],
    ["组播", "http://224.0.0.1/"],
    ["IPv6 环回", "http://[::1]/"],
    ["IPv6 链路本地", "http://[fe80::1]/"],
    ["IPv6 ULA", "http://[fc00::1]/"],
    ["IPv4 映射的环回", "http://[::ffff:127.0.0.1]/"],
    ["NAT64 包裹的环回", "http://[64:ff9b::7f00:1]/"],
    ["6to4 包裹的环回", "http://[2002:7f00:1::]/"],
  ])("拒绝 %s", async (_label, url) => {
    await expectBlocked(url, "strict")
  })

  it.each([
    ["十进制整数", "http://2130706433/"],
    ["十六进制", "http://0x7f.0.0.1/"],
    ["八进制", "http://0177.0.0.1/"],
    ["点分简写", "http://127.1/"],
  ])("拒绝 %s 写法的环回", async (_label, url) => {
    await expectBlocked(url, "strict")
  })

  it("拒绝解析到内网的主机名", async () => {
    await expect(
      assertOutboundTarget("https://looks-fine.test/", {
        mode: "strict",
        resolve: async () => ["10.1.2.3"],
      })
    ).rejects.toMatchObject({ code: "blocked_target" })
  })

  it("拒绝元数据主机名，连解析都不做", async () => {
    const resolve = vi.fn(publicResolve)
    await expect(
      assertOutboundTarget("http://metadata.google.internal/", { mode: "strict", resolve })
    ).rejects.toMatchObject({ code: "blocked_target" })
    expect(resolve).not.toHaveBeenCalled()
  })

  it("放行公网地址", async () => {
    await expect(
      assertOutboundTarget("https://raw.githubusercontent.com/o/r/main/img.png", {
        mode: "strict",
        resolve: publicResolve,
      })
    ).resolves.toBeUndefined()
  })

  it("拒绝非 http/https 协议", async () => {
    // `safeFetch` 对畸形输入同步抛错：`normalizeUrl` 在返回 promise 之前就拒绝，
    // 因此这里不能写成 `rejects`（它要求返回值是 promise）。同步抛和 reject
    // 对 `await` 调用点等价，所以只是测试形式不同。
    for (const url of ["file:///etc/passwd", "gopher://127.0.0.1/", "data:text/html,x"]) {
      let thrown: SafeFetchError | null = null
      try {
        safeFetch(url, { fetchImpl: unreachableFetch() })
      } catch (error) {
        thrown = error as SafeFetchError
      }
      expect(thrown?.code).toBe("invalid_url")
    }
  })

  it("拒绝无法解析成 IP 的地址", async () => {
    await expect(
      assertOutboundTarget("https://odd/", { mode: "strict", resolve: async () => ["not-an-ip"] })
    ).rejects.toMatchObject({ code: "blocked_target" })
  })
})

describe("lenient 出站策略", () => {
  it.each([
    ["环回", "http://127.0.0.1:3000/hook"],
    ["IPv6 环回", "http://[::1]:3000/hook"],
    ["私网", "http://10.0.0.8/hook"],
    ["VPC 内网名", "http://web.internal/hook"],
  ])("允许 %s，同一台机器上的回调是这个功能存在的理由", async (_label, url) => {
    await expect(
      assertOutboundTarget(url, { mode: "lenient", resolve: async () => ["127.0.0.1"] })
    ).resolves.toBeUndefined()
  })

  it.each([
    ["链路本地与云元数据", "http://169.254.169.254/"],
    ["阿里云元数据", "http://100.100.100.200/"],
    ["IPv6 链路本地", "http://[fe80::1]/"],
    ["元数据主机名", "http://metadata.google.internal/"],
  ])("仍拒绝 %s", async (_label, url) => {
    await expectBlocked(url, "lenient")
  })
})

describe("重定向", () => {
  const redirectingFetch = (location: string, status = 302): typeof fetch =>
    vi.fn(async () => new Response(null, { status, headers: { location } })) as unknown as typeof fetch

  it("拒绝跳进内网的重定向", async () => {
    await expect(
      safeFetch("https://public.test/a", {
        mode: "strict",
        resolve: publicResolve,
        fetchImpl: redirectingFetch("http://127.0.0.1/steal"),
      })
    ).rejects.toMatchObject({ code: "blocked_target" })
  })

  it("拒绝跳到元数据端点的重定向，即使在 lenient 档", async () => {
    await expect(
      safeFetch("https://public.test/a", {
        mode: "lenient",
        resolve: publicResolve,
        fetchImpl: redirectingFetch("http://169.254.169.254/latest/meta-data/"),
      })
    ).rejects.toMatchObject({ code: "blocked_target" })
  })

  it("拒绝跳到非 http 协议的重定向", async () => {
    await expect(
      safeFetch("https://public.test/a", {
        mode: "strict",
        resolve: publicResolve,
        fetchImpl: redirectingFetch("file:///etc/passwd"),
      })
    ).rejects.toMatchObject({ code: "invalid_url" })
  })

  it("超过跳数上限就停", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(null, { status: 302, headers: { location: "/next" } })
    ) as unknown as typeof fetch

    await expect(
      safeFetch("https://public.test/a", {
        mode: "strict",
        resolve: publicResolve,
        fetchImpl,
        maxRedirects: 2,
      })
    ).rejects.toMatchObject({ code: "too_many_redirects" })
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it("303 把 POST 降级成 GET，并丢掉请求体", async () => {
    let calls = 0
    const fetchImpl = vi.fn(async (): Promise<Response> => {
      calls += 1
      return calls === 1
        ? new Response(null, { status: 303, headers: { location: "/done" } })
        : new Response("ok")
    }) as unknown as typeof fetch

    const response = await safeFetch("https://public.test/a", {
      mode: "strict",
      resolve: publicResolve,
      fetchImpl,
      method: "POST",
      body: JSON.stringify({ a: 1 }),
      headers: { "content-type": "application/json" },
    })

    expect(response.status).toBe(200)
    const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[1]!
    expect(String(url)).toBe("https://public.test/done")
    expect(init).toMatchObject({ method: "GET", body: undefined })
  })

  it("相对 Location 以当前地址为基准解析", async () => {
    let calls = 0
    const fetchImpl = vi.fn(async (): Promise<Response> => {
      calls += 1
      return calls === 1
        ? new Response(null, { status: 307, headers: { location: "/b?x=1" } })
        : new Response("ok")
    }) as unknown as typeof fetch

    await safeFetch("https://public.test/a", {
      mode: "strict",
      resolve: publicResolve,
      fetchImpl,
    })
    expect(String((fetchImpl as ReturnType<typeof vi.fn>).mock.calls[1]![0])).toBe(
      "https://public.test/b?x=1"
    )
  })
})

describe("响应体上限", () => {
  it("content-length 超限直接拒绝", async () => {
    await expect(
      safeFetch("https://public.test/big", {
        mode: "strict",
        resolve: publicResolve,
        maxBytes: 16,
        fetchImpl: (async () =>
          new Response(new Uint8Array(8), {
            headers: { "content-length": "4096" },
          })) as unknown as typeof fetch,
      })
    ).rejects.toMatchObject({ code: "body_too_large" })
  })

  it("没报长度的流式响应在超限时中断", async () => {
    const response = await safeFetch("https://public.test/chunked", {
      mode: "strict",
      resolve: publicResolve,
      maxBytes: 16,
      fetchImpl: (async () => new Response(new Uint8Array(64))) as unknown as typeof fetch,
    })
    await expect(response.arrayBuffer()).rejects.toMatchObject({ code: "body_too_large" })
  })

  it("限内的响应体原样返回", async () => {
    const response = await safeFetch("https://public.test/small", {
      mode: "strict",
      resolve: publicResolve,
      maxBytes: 1024,
      fetchImpl: (async () => new Response("hello")) as unknown as typeof fetch,
    })
    await expect(response.text()).resolves.toBe("hello")
  })
})

describe("超时与取消", () => {
  it("调用方自己的 signal 会被合并进来", async () => {
    const controller = new AbortController()
    controller.abort(new Error("task cancelled"))

    const error = await safeFetch("https://public.test/", {
      mode: "strict",
      resolve: publicResolve,
      signal: controller.signal,
      // 真实的 `fetch` 在 signal 已中止时不会发出请求，这里复现同一行为。
      fetchImpl: (async (_url: string | URL, init?: RequestInit) => {
        expect(init?.signal?.aborted).toBe(true)
        throw new Error("task cancelled")
      }) as unknown as typeof fetch,
    }).then(
      () => null,
      (reason: unknown) => reason
    )

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe("task cancelled")
  })
})
