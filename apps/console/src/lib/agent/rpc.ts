/**
 * The A2A JSON-RPC endpoint.
 *
 * `SendMessage` and nothing else. That is a deliberate under-implementation, not
 * an omission: every read here resolves in well under a second against data the
 * public HTML already renders, so there is no long-running work to track, no
 * artifact to stream in pieces, and nothing to notify a webhook about. A task
 * that is `TASK_STATE_COMPLETED` before the response is written is the honest
 * description of what this server does, and claiming streaming or push would buy
 * nothing but a half-implemented protocol surface.
 *
 * Version handling follows §3.6: the `A2A-Version` header selects the wire
 * shape, an empty value means 0.3, and an unknown value is refused rather than
 * guessed at. Both method spellings are accepted (`SendMessage` in 1.0,
 * `message/send` in 0.3) so a client that ignores negotiation still works.
 */
import {
  ANONYMOUS_RPD,
  ANONYMOUS_RPM,
  anonymousIdentity,
  consumeAnonymousRateLimit,
} from "@/lib/agent/anonymous-limit"
import {
  SUPPORTED_PROTOCOL_VERSIONS,
  type ProtocolVersion,
} from "@/lib/agent/card"
import {
  explainSite,
  readAnomalies,
  readProjectDetail,
  readRankings,
  readRisingStars,
  SkillInputError,
  type SkillAnswer,
} from "@/lib/agent/skills"

/* ───────────────────────────── JSON-RPC plumbing ───────────────────────────── */

type JsonRpcId = string | number | null

/**
 * §9.5: the error `data` is an array whose entries each carry a `@type`, so the
 * detail is typed rather than `unknown` — a caller spreading it (as the batch
 * path does) needs it to be an object.
 */
type ErrorInfo = {
  "@type": "type.googleapis.com/google.rpc.ErrorInfo"
  reason: string
  domain: string
  metadata: { description: string }
}

type JsonRpcError = {
  code: number
  message: string
  data?: ErrorInfo[]
}

/** §9.5 standard codes, plus the A2A-specific band. */
const PARSE_ERROR = -32700
const INVALID_REQUEST = -32600
const METHOD_NOT_FOUND = -32601
const INVALID_PARAMS = -32602
const INTERNAL_ERROR = -32603
/** A2A-specific errors occupy -32001..-32099. */
const VERSION_NOT_SUPPORTED = -32001
const UNSUPPORTED_OPERATION = -32002

type ParsedRequest = {
  id: JsonRpcId
  method: string
  params: Record<string, unknown> | undefined
}

/**
 * Reads the request body as one JSON-RPC call.
 *
 * Returns a list because a batch is legal JSON-RPC 2.0. Batching is accepted
 * because a client that pipelines four skill calls should not have to detect the
 * non-batch response and retry one at a time — but each call is answered
 * independently, and one failing call never takes the others down with it.
 */
async function parseBody(
  body: unknown
): Promise<
  | { ok: true; calls: ParsedRequest[] }
  | { ok: false; id: JsonRpcId; error: JsonRpcError }
> {
  if (typeof body !== "object" || body === null) {
    return {
      ok: false,
      id: null,
      error: {
        code: INVALID_REQUEST,
        message: "Request payload validation error",
        data: [
          errorInfo("request", "请求体必须是一个 JSON-RPC 对象或对象数组。"),
        ],
      },
    }
  }

  const candidates = Array.isArray(body) ? body : [body]
  const calls: ParsedRequest[] = []
  for (const candidate of candidates) {
    if (typeof candidate !== "object" || candidate === null) {
      return {
        ok: false,
        id: null,
        error: {
          code: INVALID_REQUEST,
          message: "Request payload validation error",
          data: [
            errorInfo("request", "batch 中的每一项都必须是 JSON-RPC 对象。"),
          ],
        },
      }
    }
    const record = candidate as Record<string, unknown>
    if (record.jsonrpc !== "2.0" || typeof record.method !== "string") {
      return {
        ok: false,
        id: asId(record.id),
        error: {
          code: INVALID_REQUEST,
          message: "Request payload validation error",
          data: [
            errorInfo(
              "request",
              '每个请求都需要 "jsonrpc":"2.0" 与字符串类型的 "method"。'
            ),
          ],
        },
      }
    }
    calls.push({
      id: asId(record.id),
      method: record.method,
      params: asParams(record.params),
    })
  }

  return { ok: true, calls }
}

function asId(value: unknown): JsonRpcId {
  return typeof value === "string" || typeof value === "number" ? value : null
}

function asParams(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return undefined
}

/** §9.5: `data` is an array of objects that each carry a `@type`. */
function errorInfo(reason: string, description: string): ErrorInfo {
  return {
    "@type": "type.googleapis.com/google.rpc.ErrorInfo",
    reason,
    domain: "vercelai.cn",
    metadata: { description },
  }
}

/* ───────────────────────────── version negotiation ───────────────────────────── */

/**
 * Which wire version this request wants.
 *
 * §3.6.2 makes an empty `A2A-Version` mean 0.3, so a header that is missing and
 * a header that is blank are the same case rather than one of them silently
 * getting the newest version — defaulting an unstated version up to 1.0 is how a
 * 0.3 client ends up parsing `TASK_STATE_COMPLETED` as a state it has never
 * heard of.
 */
export function negotiateVersion(header: string | null):
  | {
      ok: true
      version: ProtocolVersion
    }
  | {
      ok: false
      error: JsonRpcError
    } {
  const raw = (header ?? "").trim()
  if (raw === "") return { ok: true, version: "0.3" }

  // Accept "1.0", "1", "v1.0": clients disagree on all three, and the patch
  // component is explicitly not negotiated (§3.6).
  const normalized = raw.replace(/^v/i, "").split(".").slice(0, 2).join(".")
  const major = normalized.split(".")[0]
  if (major === "1") return { ok: true, version: "1.0" }
  if (major === "0") return { ok: true, version: "0.3" }

  return {
    ok: false,
    error: {
      code: VERSION_NOT_SUPPORTED,
      message: "Version not supported",
      data: [
        errorInfo(
          "A2A_VERSION_NOT_SUPPORTED",
          `本服务支持 ${SUPPORTED_PROTOCOL_VERSIONS.join(" 与 ")}，收到 ${raw}。`
        ),
      ],
    },
  }
}

/* ───────────────────────────── dispatch ───────────────────────────── */

/**
 * Turns one message into one skill call.
 *
 * A `data` part is read as JSON and dispatched on its `skill` field. Text is
 * accepted too, but only as an explicit instruction to describe the site: a
 * free-text ranking query would mean guessing which week was meant, and a
 * ranking that quietly answers the wrong week is worse than one that asks.
 */
function routeSkill(message: unknown): SkillPlan {
  const messageRecord =
    typeof message === "object" && message !== null
      ? (message as Record<string, unknown>)
      : undefined

  const parts = Array.isArray(messageRecord?.parts)
    ? (messageRecord.parts as unknown[])
    : []

  const dataParts = parts.filter(
    (part): part is { data: unknown } =>
      typeof part === "object" &&
      part !== null &&
      "data" in part &&
      (part as { data: unknown }).data !== null
  )

  if (dataParts.length === 0) {
    const text = parts
      .map((part) =>
        typeof part === "object" && part !== null && "text" in part
          ? String((part as { text: unknown }).text ?? "")
          : ""
      )
      .join("\n")
      .trim()

    if (text === "") {
      throw new SkillInputError(
        '消息里既没有 data part 也没有 text part。data part 形如 {"skill":"rankings", ...}；' +
          "纯文本只会走 describe（本站介绍）。"
      )
    }
    return { run: () => explainSite(), label: "explain" }
  }

  const first = dataParts[0]?.data
  const payload = asParams(first)
  if (!payload) {
    throw new SkillInputError("data part 必须是 JSON 对象。")
  }

  const skill = payload.skill
  if (typeof skill !== "string") {
    throw new SkillInputError(
      'data part 需要一个 "skill" 字段，取值：explain | rankings | rising-stars | project-detail | anomalies。'
    )
  }

  return plan(skill, payload)
}

type SkillPlan = {
  run: () => Promise<SkillAnswer> | SkillAnswer
  label: string
}

function plan(skill: string, payload: Record<string, unknown>): SkillPlan {
  switch (skill) {
    case "explain":
    case "about":
      return { run: () => explainSite(), label: "explain" }

    case "rankings":
      return {
        label: "rankings",
        run: () =>
          readRankings({
            cadence: asCadence(payload.cadence),
            year: asNumber(payload.year),
            week: asNumber(payload.week),
            month: asNumber(payload.month),
            day: asString(payload.day),
            limit: asNumber(payload.limit),
          }),
      }

    case "rising-stars":
    case "rising":
      return {
        label: "rising-stars",
        run: () =>
          readRisingStars({
            year: asNumber(payload.year),
            week: asNumber(payload.week),
            limit: asNumber(payload.limit),
          }),
      }

    case "project-detail":
      return {
        label: "project-detail",
        run: () =>
          readProjectDetail({
            fullName: asString(payload.fullName),
            owner: asString(payload.owner),
            name: asString(payload.name),
          }),
      }

    case "anomalies":
      return {
        label: "anomalies",
        run: () =>
          readAnomalies({
            limit: asNumber(payload.limit),
            includeGood: payload.includeGood === true,
          }),
      }

    default:
      throw new SkillInputError(
        `未知 skill "${skill}"。可用：explain | rankings | rising-stars | project-detail | anomalies。`
      )
  }
}

function asCadence(value: unknown): "day" | "week" | "month" | undefined {
  if (value === undefined) return undefined
  if (value === "day" || value === "week" || value === "month") return value
  throw new SkillInputError('cadence 必须是 "day" | "week" | "month" 之一。')
}

function asNumber(value: unknown): number | undefined {
  if (value === undefined) return undefined
  const parsed = typeof value === "string" ? Number(value) : value
  if (typeof parsed !== "number" || !Number.isFinite(parsed)) {
    throw new SkillInputError("数值参数必须是有限数字。")
  }
  return parsed
}

function asString(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "string") {
    throw new SkillInputError("该参数必须是字符串。")
  }
  return value
}

/* ───────────────────────────── response shaping ───────────────────────────── */

/**
 * Builds the A2A Task.
 *
 * A completed task with one artifact per answer part: the prose as a `text`
 * part for a model that reads language, and the numbers as a `data` part for a
 * caller that wants to compute with them. Both come from one skill call, so they
 * cannot disagree — which is the failure mode of shipping a summary and a
 * payload from two different queries.
 */
async function completeTask(
  version: ProtocolVersion,
  request: ParsedRequest,
  message: unknown
): Promise<unknown> {
  const plan = routeSkill(message)
  const answer = await plan.run()

  const taskId = crypto.randomUUID()
  const now = new Date().toISOString()

  const task = {
    id: taskId,
    contextId:
      asString(asParams(request.params ?? {})?.contextId) ??
      crypto.randomUUID(),
    status: {
      state: version === "1.0" ? "TASK_STATE_COMPLETED" : "completed",
      timestamp: now,
    },
    artifacts: [
      {
        artifactId: crypto.randomUUID(),
        name: `${plan.label}.md`,
        parts: [{ text: answer.text }],
      },
      {
        artifactId: crypto.randomUUID(),
        name: `${plan.label}.json`,
        parts: [{ data: answer.data, mediaType: "application/json" }],
      },
    ],
    history: [normalizeMessage(message, "ROLE_USER", version)],
  }

  // §3.7: results belong in artifacts, and the 1.0 envelope wraps them in
  // `task`. 0.3 returned the task directly and 0.3 clients are still deployed.
  return version === "1.0" ? { task } : task
}

function normalizeMessage(
  message: unknown,
  role: "ROLE_USER" | "ROLE_AGENT",
  version: ProtocolVersion
): unknown {
  if (typeof message !== "object" || message === null) {
    return { role: normalizeRole(role, version), parts: [] }
  }
  return {
    ...(message as Record<string, unknown>),
    role: normalizeRole(role, version),
  }
}

function normalizeRole(
  role: "ROLE_USER" | "ROLE_AGENT",
  version: ProtocolVersion
): string {
  return version === "1.0" ? role : role.replace("ROLE_", "").toLowerCase()
}

/* ───────────────────────────── entry point ───────────────────────────── */

/**
 * `POST /api/a2a`
 *
 * Rate limited before any parsing, so a flood costs the limiter rather than the
 * database. The limiter's failure is returned as-is (a 429 with `Retry-After`,
 * not a JSON-RPC error) because a rate limit is an HTTP-level fact about this
 * request, and a client that retries on the JSON-RPC code alone would not wait.
 */
export async function handleA2ARequest(request: Request): Promise<Response> {
  const limit = await consumeAnonymousRateLimit(
    request,
    anonymousIdentity(request)
  )
  if (limit.failure) return limit.failure

  const version = negotiateVersion(request.headers.get("a2a-version"))
  if (!version.ok) {
    return jsonRpc(null, undefined, version.error, limit.headers)
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonRpc(
      null,
      undefined,
      {
        code: PARSE_ERROR,
        message: "Invalid JSON payload",
        data: [errorInfo("parse", "请求体不是合法 JSON。")],
      },
      limit.headers
    )
  }

  const parsed = await parseBody(body)
  if (!parsed.ok) {
    return jsonRpc(parsed.id, undefined, parsed.error, limit.headers)
  }

  const answers: unknown[] = []
  for (const call of parsed.calls) {
    const answer = await answerOne(call, version.version)
    answers.push(answer)
  }

  // §9.4: a single call answers with a bare result, a batch with an array.
  return bareJsonRpc(
    parsed.calls.length === 1 ? answers[0] : answers,
    limit.headers
  )
}

async function answerOne(
  call: ParsedRequest,
  version: ProtocolVersion
): Promise<unknown> {
  // Both spellings are routed to the same handler: 1.0 renamed the methods to
  // PascalCase, and a client that hardcodes the 0.3 name should still work
  // rather than get a MethodNotFoundError from a server that does the work.
  const isSend = call.method === "SendMessage" || call.method === "message/send"

  if (!isSend) {
    return {
      jsonrpc: "2.0",
      id: call.id,
      error: unsupportedOperation(call.method),
    }
  }

  try {
    const result = await completeTask(version, call, call.params?.message)
    return { jsonrpc: "2.0", id: call.id, result }
  } catch (cause) {
    if (cause instanceof SkillInputError) {
      return {
        jsonrpc: "2.0",
        id: call.id,
        error: {
          code: INVALID_PARAMS,
          message: "Invalid parameters",
          data: [errorInfo("INVALID_SKILL_INPUT", cause.message)],
        },
      }
    }
    // The underlying failure is not echoed back: a stack trace or a driver
    // message in an unauthenticated response is free reconnaissance.
    console.error("[a2a] skill failed", cause)
    return {
      jsonrpc: "2.0",
      id: call.id,
      error: {
        code: INTERNAL_ERROR,
        message: "Internal error",
        data: [errorInfo("INTERNAL", "读取数据时出错，请稍后重试。")],
      },
    }
  }
}

/**
 * The error for a method this server does not have.
 *
 * Three distinct refusals, because a client that asked for streaming deserves a
 * different message than one that asked for a task by a stale id — and both
 * deserve a different message from one that invented a method name. Telling them
 * apart is what lets a client fall back correctly: streaming is worth retrying
 * without streaming, a stale task id is not worth retrying at all, and a typo is
 * worth fixing.
 *
 * The task branch matches a fixed list of known task methods rather than
 * "anything containing 'task'". A substring test sends an invented method
 * containing the word "task" down the unsupported-operation path, and the client
 * is then told the operation exists — which is worse than being told it does
 * not.
 */
const TASK_METHODS = new Set([
  "gettask",
  "listtasks",
  "canceltask",
  "tasks/get",
  "tasks/list",
  "tasks/cancel",
  "tasks/subscribe",
  "tasksresubscribe",
  "tasks/cancel",
])

function unsupportedOperation(method: string): JsonRpcError {
  const name = method.toLowerCase().replace(/[^a-z]/g, "")

  if (name === "sendstreamingmessage" || name === "tasks/resubscribe") {
    return {
      code: UNSUPPORTED_OPERATION,
      message: "Streaming is not supported by this agent",
      data: [
        errorInfo(
          "UNSUPPORTED_OPERATION",
          "本服务的每次读取都在一次往返内完成，不支持流式；用 SendMessage 即可。"
        ),
      ],
    }
  }

  if (name.includes("push")) {
    return {
      code: UNSUPPORTED_OPERATION,
      message: "Push notifications are not supported by this agent",
      data: [
        errorInfo(
          "UNSUPPORTED_OPERATION",
          "本服务没有长任务，因此没有可推送的更新。"
        ),
      ],
    }
  }

  if (TASK_METHODS.has(method) || TASK_METHODS.has(name)) {
    return {
      code: UNSUPPORTED_OPERATION,
      message: "Unsupported operation",
      data: [
        errorInfo(
          "UNSUPPORTED_OPERATION",
          `没有状态可查：${method} 用于跟踪长任务，而本服务同步完成。改用 SendMessage。`
        ),
      ],
    }
  }

  return {
    code: METHOD_NOT_FOUND,
    message: "Method not found",
    data: [
      errorInfo(
        "METHOD_NOT_FOUND",
        `可用方法只有 SendMessage（0.3 客户端可用 message/send）。收到 ${method}。`
      ),
    ],
  }
}

function jsonRpc(
  id: JsonRpcId,
  result: unknown,
  error: JsonRpcError | undefined,
  extraHeaders: Record<string, string>
): Response {
  return envelope(
    { jsonrpc: "2.0", id, ...(error ? { error } : { result }) },
    extraHeaders
  )
}

/**
 * The already-enveloped answers, sent as-is.
 *
 * Each call in a batch builds its own `{ jsonrpc, id, … }` in `answerOne`, so
 * wrapping the array again would produce a response whose entries each carry a
 * second `jsonrpc` and `id` — valid-looking JSON that no JSON-RPC client parses.
 */
function bareJsonRpc(
  result: unknown,
  extraHeaders: Record<string, string>
): Response {
  return envelope(result, extraHeaders)
}

function envelope(
  payload: unknown,
  extraHeaders: Record<string, string>
): Response {
  return Response.json(payload, {
    headers: {
      "cache-control": "no-store",
      ...extraHeaders,
    },
  })
}

/** Advertised in the card's absence of a `securitySchemes` block, and here for anyone reading the source. */
export const ANONYMOUS_QUOTA = {
  requestsPerMinute: ANONYMOUS_RPM,
  requestsPerDay: ANONYMOUS_RPD,
}
