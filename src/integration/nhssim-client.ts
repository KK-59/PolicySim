/**
 * NHS-SIM HTTP client — the single chokepoint for every call to the live server.
 * OWNER: Oriol.
 *
 * Everything that touches the network goes through here: auth, timeout, retry, idempotency,
 * and typed errors. Nothing else in the repo should call fetch() against NHS-SIM.
 *
 * Retry policy: transient failures only (network error, timeout, 429, 5xx). A 4xx is a
 * statement about the request and is never retried. A 409 is a first-class outcome, not a
 * failure, because the agent's fallback logic is defined in terms of it.
 */

export interface ClientConfig {
  baseUrl: string
  teamKey: string
  timeoutMs: number
  maxRetries: number
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): ClientConfig {
  const baseUrl = env.NHSSIM_BASE_URL?.replace(/\/$/, '')
  const teamKey = env.NHSSIM_TEAM_KEY
  if (!baseUrl) throw new Error('NHSSIM_BASE_URL is not set. Copy .env.example to .env.')
  if (!teamKey) throw new Error('NHSSIM_TEAM_KEY is not set. Copy .env.example to .env.')
  return {
    baseUrl,
    teamKey,
    timeoutMs: Number(env.NHSSIM_TIMEOUT_MS ?? 8000),
    maxRetries: 2,
  }
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly path: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/**
 * 409. Stale expectedVersion, an idempotency key reused with a different body, or an
 * invalid state transition. The caller decides the fallback; the client never retries it,
 * because a blind retry of a conflicting write is how you get a duplicate clinical action.
 */
export class ConflictError extends ApiError {
  constructor(code: string, message: string, path: string) {
    super(409, code, message, path)
    this.name = 'ConflictError'
  }
}

export class TimeoutError extends Error {
  constructor(readonly path: string, readonly timeoutMs: number) {
    super(`Request to ${path} timed out after ${timeoutMs}ms`)
    this.name = 'TimeoutError'
  }
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504])

export interface RequestOptions {
  method?: 'GET' | 'POST'
  body?: unknown
  /** Sent as the Idempotency-Key header. Required by convention on every write. */
  idempotencyKey?: string
  query?: Record<string, string | number | undefined>
  signal?: AbortSignal
  /**
   * Override the retry budget. Use 0 for any write that is NOT idempotent: a retried
   * `POST /api/clock` advances the world a second time, because it carries no idempotency key.
   */
  retries?: number
}

export class NhsSimClient {
  constructor(private readonly config: ClientConfig = configFromEnv()) {}

  get baseUrl(): string {
    return this.config.baseUrl
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', body, idempotencyKey, query } = options
    const maxRetries = options.retries ?? this.config.maxRetries
    const url = new URL(this.config.baseUrl + path)
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v))
    }

    let lastTransient: Error | undefined

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) await sleep(backoffMs(attempt))

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), this.config.timeoutMs)
      if (options.signal) {
        options.signal.addEventListener('abort', () => controller.abort(), { once: true })
      }

      try {
        const headers: Record<string, string> = {
          Authorization: `Bearer ${this.config.teamKey}`,
          Accept: 'application/json',
        }
        if (body !== undefined) headers['Content-Type'] = 'application/json'
        if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey

        const res = await fetch(url, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal,
        })

        if (res.ok) return (await res.json()) as T

        const payload = await safeJson(res)
        const code = payload.error ?? String(res.status)
        const message = payload.message ?? payload.error ?? res.statusText

        if (res.status === 409) throw new ConflictError(code, message, path)

        if (RETRYABLE_STATUS.has(res.status) && attempt < maxRetries) {
          lastTransient = new ApiError(res.status, code, message, path)
          continue
        }
        throw new ApiError(res.status, code, message, path)
      } catch (err) {
        if (err instanceof ApiError) throw err

        const isAbort = err instanceof Error && err.name === 'AbortError'
        const transient = isAbort ? new TimeoutError(path, this.config.timeoutMs) : (err as Error)
        if (attempt < maxRetries) {
          lastTransient = transient
          continue
        }
        throw transient
      } finally {
        clearTimeout(timer)
      }
    }

    throw lastTransient ?? new Error(`Request to ${path} failed`)
  }

  get<T>(path: string, query?: RequestOptions['query']): Promise<T> {
    return this.request<T>(path, { method: 'GET', query })
  }

  post<T>(path: string, body: unknown, idempotencyKey?: string): Promise<T> {
    // The clock is the one write with no idempotency key, so a retry moves the world twice.
    // Better to surface the timeout and record an observation gap than to advance it again.
    const retries = path === '/api/clock' ? 0 : undefined
    return this.request<T>(path, { method: 'POST', body, idempotencyKey, retries })
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** 300ms, 900ms. Deterministic, so tests do not need fake timers beyond sleep. */
export function backoffMs(attempt: number): number {
  return 300 * 3 ** (attempt - 1)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function safeJson(res: Response): Promise<{ error?: string; message?: string }> {
  try {
    return (await res.json()) as { error?: string; message?: string }
  } catch {
    return {}
  }
}

/** RFC 4122 v4, the format the server's clientRequestId pattern accepts. */
export function newIdempotencyKey(): string {
  return crypto.randomUUID()
}
