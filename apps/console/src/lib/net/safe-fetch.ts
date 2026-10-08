/**
 * 出站 `fetch` 的 SSRF 防护层。
 *
 * 服务器替调用方访问一个攻击者给出的地址时，「地址」本身就是输入：这一层在真正
 * 发请求之前把地址解析成 IP 并逐跳校验，而不是信任 URL 长什么样。
 *
 * 两档策略（`mode`）：
 *
 *   - `strict`（默认）：私网、环回、链路本地、保留与组播一律拒绝。README 镜像、
 *     Open Graph 图、头像走这一档 —— 它们的来源本来就只有公网 CDN。
 *   - `lenient`：允许私网与环回，只拒绝链路本地与云元数据端点。webhook 与订阅投递
 *     走这一档，因为「回调打到同一台机器上的 web 应用」是这个功能存在的理由
 *     （见 `lib/api/write-request.ts`）。它挡不住一次横向移动，但挡得住元数据窃取。
 *
 * 重定向逐跳复检：`redirect: "manual"` 加每一跳重新解析，一个公网 302 没法把请求
 * 送进内网。
 *
 * 已知边界：解析与连接之间存在 DNS 重绑定的时间窗（TOCTOU）。这一层要保证的是
 * 「直接指向内网的请求不会发生」，不是替代网络层的出站白名单 —— VPC 部署仍应在
 * 安全组/防火墙上限制 egress。
 */
import { lookup } from "node:dns/promises"
import { isIP } from "node:net"

export type OutboundMode = "strict" | "lenient"

export type SafeFetchErrorCode =
  | "invalid_url"
  | "blocked_target"
  | "too_many_redirects"
  | "body_too_large"

export class SafeFetchError extends Error {
  readonly code: SafeFetchErrorCode
  readonly url: string

  constructor(code: SafeFetchErrorCode, url: string, message: string) {
    super(message)
    this.name = "SafeFetchError"
    this.code = code
    this.url = url
  }
}

/**
 * `mode` and `redirect` are not part of `RequestInit` here on purpose. `mode`
 * is this layer's own policy switch and would otherwise collide with
 * `RequestMode`; `redirect` is omitted rather than ignored because this layer
 * always takes the `3xx` and re-validates the `Location` itself — letting a
 * caller opt back into `follow` would reopen the hole the module exists to
 * close.
 */
export interface SafeFetchOptions extends Omit<RequestInit, "mode" | "redirect"> {
  /** 出站策略，默认 `strict`。 */
  mode?: OutboundMode
  /** 总超时（含每一跳），默认 15s。与调用方自己的 `signal` 合并。 */
  timeoutMs?: number
  /** 响应体上限（字节），默认 5 MiB。`content-length` 超限直接拒绝，流式超限中断。 */
  maxBytes?: number
  /** 允许跟随的重定向次数，默认 3。 */
  maxRedirects?: number
  /** 测试注入。 */
  fetchImpl?: typeof fetch
  resolve?: (hostname: string) => Promise<string[]>
}

const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024
const DEFAULT_MAX_REDIRECTS = 3

/**
 * 无论哪一档都拒绝的主机名：云厂商的元数据服务。`169.254.169.254` 一类的地址本身
 * 已被链路本地规则挡住，这里拦的是用域名绕过 —— 比如 `metadata.google.internal`
 * 在 DNS 之前就该死掉。
 */
const METADATA_HOSTNAMES = new Set([
  "metadata",
  "metadata.google.internal",
  "metadata.goog",
])

/** 阿里云元数据端点，落在 100.64/10 之内，`strict` 已挡；`lenient` 单独拦。 */
const METADATA_IPV4 = new Set(["100.100.100.200"])

/** 15s 超时 + 5 MiB 上限：镜像图与 webhook 响应都用得上，不用每个调用点重申。 */
export function safeFetch(url: string | URL, options: SafeFetchOptions = {}): Promise<Response> {
  return request(normalizeUrl(url), options)
}

/**
 * 只校验地址、不发请求。给「先判断再决定要不要镜像」这类调用点用，
 * 也方便测试直接断言某一档策略的结论。
 */
export async function assertOutboundTarget(
  url: string | URL,
  options: Pick<SafeFetchOptions, "mode" | "resolve"> = {}
): Promise<void> {
  await checkTarget(normalizeUrl(url), options)
}

function normalizeUrl(url: string | URL): URL {
  let parsed: URL
  try {
    parsed = url instanceof URL ? url : new URL(url)
  } catch {
    throw new SafeFetchError("invalid_url", String(url), `not an absolute URL: ${String(url)}`)
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new SafeFetchError(
      "invalid_url",
      parsed.toString(),
      `unsupported scheme: ${parsed.protocol}`
    )
  }
  return parsed
}

async function request(url: URL, options: SafeFetchOptions): Promise<Response> {
  const {
    mode = "strict",
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxBytes = DEFAULT_MAX_BYTES,
    maxRedirects = DEFAULT_MAX_REDIRECTS,
    fetchImpl = fetch,
    resolve = resolveAddresses,
  } = options

  const signal = combineSignal(options.signal, AbortSignal.timeout(timeoutMs))
  let current = url
  let method = (options.method ?? "GET").toUpperCase()
  let body = options.body ?? undefined
  let redirects = 0

  for (;;) {
    // Re-checked per hop: a `Location` can change the scheme as well as the
    // host, and `file:`/`gopher:` are no more acceptable as a redirect target
    // than they are as an original one.
    current = normalizeUrl(current)
    await checkTarget(current, { mode, resolve })

    const response = await fetchImpl(current, {
      method,
      headers: options.headers,
      body,
      redirect: "manual",
      signal,
    })

    const location = response.headers.get("location")
    if (!isRedirect(response.status) || !location) {
      return capBody(response, maxBytes, current.toString())
    }

    // The body of a redirect is never the payload; releasing it keeps the
    // connection usable instead of waiting on a socket we are about to leave.
    void response.body?.cancel().catch(() => {})

    if (++redirects > maxRedirects) {
      throw new SafeFetchError(
        "too_many_redirects",
        current.toString(),
        `more than ${maxRedirects} redirects`
      )
    }

    // Relative `Location` resolves against the URL that produced it, which is
    // how a redirect chain across hosts stays well-formed.
    current = new URL(location, current)

    // 303 always becomes GET; 301/302 demote POST the way every browser does.
    if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === "POST")) {
      method = method === "HEAD" ? "HEAD" : "GET"
      body = undefined
    }
  }
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308
}

/** The host policy of this module: parse, resolve, and reject what is not allowed. */
async function checkTarget(
  url: URL,
  options: Pick<SafeFetchOptions, "mode" | "resolve">
): Promise<void> {
  const mode = options.mode ?? "strict"
  const hostname = normalizeHostname(url.hostname)

  if (METADATA_HOSTNAMES.has(hostname)) {
    throw new SafeFetchError("blocked_target", url.toString(), `metadata host: ${hostname}`)
  }

  if (isIP(hostname)) {
    assertAddress(hostname, mode, url.toString())
    return
  }

  const addresses = await (options.resolve ?? resolveAddresses)(hostname)
  if (addresses.length === 0) {
    throw new SafeFetchError("blocked_target", url.toString(), `no address for ${hostname}`)
  }
  for (const address of addresses) {
    assertAddress(address, mode, url.toString())
  }
}

function normalizeHostname(hostname: string): string {
  // WHATWG keeps the brackets on an IPv6 literal (`[::1]`); the address rules
  // below are written against the bare form.
  const bare = hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname
  // A trailing dot is the same host, and is how a resolver spells "this is FQDN".
  return bare.endsWith(".") ? bare.slice(0, -1).toLowerCase() : bare.toLowerCase()
}

async function resolveAddresses(hostname: string): Promise<string[]> {
  const records = await lookup(hostname, { all: true })
  return records.map((record) => record.address)
}

function assertAddress(address: string, mode: OutboundMode, url: string): void {
  if (isBlocked(address, mode)) {
    throw new SafeFetchError("blocked_target", url, `address not allowed (${mode}): ${address}`)
  }
}

function isBlocked(address: string, mode: OutboundMode): boolean {
  const family = isIP(address)
  if (family === 4) return isBlockedIPv4(address, mode)
  if (family === 6) return isBlockedIPv6(address, mode)
  // Not an IP literal: `dns.lookup` should not hand these back, and treating an
  // unparsable address as allowed would be the wrong way to fail.
  return true
}

/** `ip ∈ cidr`, for the four-octet form. */
function ipv4InCidr(address: string, cidr: string): boolean {
  const [base, bitsRaw] = cidr.split("/")
  const bits = Number(bitsRaw)
  const toInt = (ip: string): number =>
    ip.split(".").reduce((acc, octet) => ((acc << 8) | Number(octet)) >>> 0, 0) >>> 0
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
  return (toInt(address) & mask) === (toInt(base!) & mask)
}

/** 任何情况下都拒绝的 IPv4 段。 */
const ALWAYS_BLOCKED_V4 = [
  "0.0.0.0/8", // "this network"
  "169.254.0.0/16", // link-local, carries every cloud metadata endpoint
  "224.0.0.0/4", // multicast
  "240.0.0.0/4", // reserved, incl. 255.255.255.255
]

/** 仅 `strict` 拒绝的 IPv4 段：私网、环回与保留给文档/基准测试的地址。 */
const STRICT_BLOCKED_V4 = [
  "10.0.0.0/8",
  "100.64.0.0/10", // CGNAT
  "127.0.0.0/8",
  "172.16.0.0/12",
  "192.0.0.0/24", // IETF protocol assignments
  "192.0.2.0/24", // TEST-NET-1
  "192.168.0.0/16",
  "198.18.0.0/15", // benchmarking
  "198.51.100.0/24", // TEST-NET-2
  "203.0.113.0/24", // TEST-NET-3
]

function isBlockedIPv4(address: string, mode: OutboundMode): boolean {
  if (METADATA_IPV4.has(address)) return true
  if (ALWAYS_BLOCKED_V4.some((cidr) => ipv4InCidr(address, cidr))) return true
  if (mode === "lenient") return false
  return STRICT_BLOCKED_V4.some((cidr) => ipv4InCidr(address, cidr))
}

function isBlockedIPv6(address: string, mode: OutboundMode): boolean {
  const groups = parseIPv6(address)
  if (!groups) return true

  const allZero = (from: number, to: number) => groups.slice(from, to).every((g) => g === 0)

  // `::`, `::1` and the rest of `::/96` are the unspecified and loopback
  // addresses, not the IPv4-compatible form they resemble — they are decided
  // here, before the embedded-quad rule below can mistake `::1` for `0.0.0.1`.
  if (allZero(0, 7)) return mode === "strict"

  const embedded = embeddedIPv4(groups)
  if (embedded) return isBlockedIPv4(embedded, mode)

  const first = groups[0]!
  // fe80::/10 link-local — both modes, same reason as 169.254/16.
  if ((first & 0xffc0) === 0xfe80) return true
  // fec0::/10 site-local (deprecated) and ff00::/8 multicast.
  if ((first & 0xffc0) === 0xfec0) return true
  if ((first & 0xff00) === 0xff00) return true

  if (mode === "lenient") return false

  // fc00::/7 unique local addresses.
  if ((first & 0xfe00) === 0xfc00) return true
  // 2001:db8::/32 documentation prefix.
  return first === 0x2001 && groups[1] === 0x0db8
}

/** The dotted-quad an IPv6 address carries inside it, when it carries one. */
function embeddedIPv4(groups: number[]): string | undefined {
  const zero = (from: number, to: number) => groups.slice(from, to).every((g) => g === 0)
  const quad = (high: number, low: number): string =>
    `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`

  // ::ffff:a.b.c.d — the form an IPv4 socket sees over IPv6.
  if (zero(0, 5) && groups[5] === 0xffff) return quad(groups[6]!, groups[7]!)
  // 64:ff9b::a.b.c.d — NAT64, which is how an IPv6-only network reaches IPv4.
  if (groups[0] === 0x0064 && groups[1] === 0xff9b && zero(2, 6)) {
    return quad(groups[6]!, groups[7]!)
  }
  // 2002:a.b.c.d:: — 6to4, the address of a tunneled IPv4 destination.
  if (groups[0] === 0x2002) return quad(groups[1]!, groups[2]!)
  // ::a.b.c.d — deprecated IPv4-compatible form.
  if (zero(0, 6)) return quad(groups[6]!, groups[7]!)
  return undefined
}

function parseIPv6(address: string): number[] | null {
  // A zone id (`%eth0`) is link-local scope, not part of the address.
  const bare = address.split("%", 1)[0] ?? ""
  const halves = bare.split("::")
  if (halves.length > 2) return null

  const head = halves[0] ? halves[0].split(":").filter(Boolean) : []
  const tail = halves.length === 2 ? (halves[1] ? halves[1].split(":").filter(Boolean) : []) : []

  // An embedded dotted-quad in the last group: `::ffff:127.0.0.1`.
  const expand = (parts: string[]): string[] => {
    const last = parts[parts.length - 1]
    if (last && last.includes(".")) {
      const octets = last.split(".").map(Number)
      if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
        return []
      }
      const high = ((octets[0]! << 8) | octets[1]!).toString(16)
      const low = ((octets[2]! << 8) | octets[3]!).toString(16)
      return [...parts.slice(0, -1), high, low]
    }
    return parts
  }

  const headWords = expand(head)
  const tailWords = expand(tail)
  const missing = 8 - headWords.length - tailWords.length

  // A compressed form without `::` cannot lose groups, and one with it must
  // still land on exactly eight.
  if (halves.length === 1 && headWords.length !== 8) return null
  if (missing < 0) return null

  const words = [
    ...headWords,
    ...new Array<string>(halves.length === 2 ? missing : 0).fill("0"),
    ...tailWords,
  ]
  if (words.length !== 8) return null

  const groups = words.map((word) => Number.parseInt(word, 16))
  return groups.some((g) => !Number.isInteger(g) || g < 0 || g > 0xffff) ? null : groups
}

/**
 * A caller's own signal (a webhook's timeout, a task's cancellation) and this
 * layer's budget have to be one signal: `fetch` takes a single `signal`, and
 * whichever fires first should abort the request.
 */
function combineSignal(caller: AbortSignal | null | undefined, budget: AbortSignal): AbortSignal {
  if (!caller) return budget
  if (typeof AbortSignal.any === "function") return AbortSignal.any([caller, budget])

  const controller = new AbortController()
  const abort = (reason: unknown) => controller.abort(reason)
  if (caller.aborted) abort(caller.reason)
  else caller.addEventListener("abort", () => abort(caller.reason), { once: true })
  budget.addEventListener("abort", () => abort(budget.reason), { once: true })
  return controller.signal
}

/**
 * Enforces `maxBytes` on the way out.
 *
 * `content-length` is checked first so an honest large body is refused before
 * it is read; the stream wrapper is what catches a chunked response that
 * simply never announces its size.
 */
function capBody(response: Response, maxBytes: number, url: string): Response {
  const declared = response.headers.get("content-length")
  if (declared && Number(declared) > maxBytes) {
    throw new SafeFetchError(
      "body_too_large",
      url,
      `content-length ${declared} exceeds ${maxBytes}`
    )
  }

  const source = response.body
  if (!source) return response

  const reader = source.getReader()
  let seen = 0
  const capped = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read()
      if (done) {
        controller.close()
        return
      }
      seen += value.byteLength
      if (seen > maxBytes) {
        controller.error(new SafeFetchError("body_too_large", url, `body exceeds ${maxBytes}`))
        return
      }
      controller.enqueue(value)
    },
    cancel(reason) {
      return reader.cancel(reason)
    },
  })

  return new Response(capped, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}
