import { WORKER_SOURCE } from './worker-source'

// areyoubot client widget — IIFE entry point.
// Reads its own <script> config, fetches a PoW challenge, solves it in a Web
// Worker, injects the proof into the host <form>, and shows a tiny badge.
;(() => {
  interface Config {
    sitekey: string
    base: string
    callback: string | null
    badge: boolean
    script: HTMLScriptElement
  }

  interface ChallengeResponse {
    token: string
    difficulty: number
    ttl: number
  }

  type BadgeState = 'idle' | 'solving' | 'verified' | 'error'

  const HIDDEN_FIELD = 'areyoubot-token'

  function readConfig(): Config | null {
    const script = (document.currentScript as HTMLScriptElement | null) ?? null
    if (!script) return null
    const sitekey = script.getAttribute('data-ayb-sitekey')
    if (!sitekey) return null
    let base = ''
    try {
      base = new URL(script.src, window.location.href).origin
    } catch {
      base = window.location.origin
    }
    return {
      sitekey,
      base,
      callback: script.getAttribute('data-ayb-callback'),
      badge: script.getAttribute('data-ayb-badge') !== 'off',
      script,
    }
  }

  function createBadge(): { el: HTMLDivElement; set: (s: BadgeState) => void } {
    const el = document.createElement('div')
    Object.assign(el.style, {
      position: 'fixed',
      right: '12px',
      bottom: '12px',
      zIndex: '2147483647',
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      padding: '6px 10px',
      borderRadius: '8px',
      fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
      fontSize: '12px',
      lineHeight: '1',
      color: '#1f2937',
      background: '#ffffff',
      border: '1px solid #e5e7eb',
      boxShadow: '0 1px 3px rgba(0,0,0,0.12)',
      userSelect: 'none',
    } satisfies Partial<CSSStyleDeclaration>)

    const label = document.createElement('span')
    label.textContent = 'are you bot? 😏'
    const status = document.createElement('span')
    status.style.fontWeight = '600'

    el.appendChild(label)
    el.appendChild(status)

    const set = (s: BadgeState): void => {
      if (s === 'solving') {
        status.textContent = 'checking…'
        status.style.color = '#6b7280'
      } else if (s === 'verified') {
        status.textContent = '✓ verified'
        status.style.color = '#16a34a'
      } else if (s === 'error') {
        status.textContent = '⚠ retry'
        status.style.color = '#dc2626'
      } else {
        status.textContent = ''
      }
    }
    set('idle')
    return { el, set }
  }

  function findForm(script: HTMLScriptElement | null): HTMLFormElement | null {
    const own = script?.closest('form') as HTMLFormElement | null
    if (own) return own
    return document.querySelector('form')
  }

  function setHiddenField(form: HTMLFormElement, value: string): void {
    const existing = form.querySelector(
      `input[name="${HIDDEN_FIELD}"]`
    ) as HTMLInputElement | null
    if (existing) {
      existing.value = value
      return
    }
    const input = document.createElement('input')
    input.type = 'hidden'
    input.name = HIDDEN_FIELD
    input.value = value
    form.appendChild(input)
  }

  function solveInWorker(token: string, difficulty: number): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      let url = ''
      let worker: Worker | null = null
      const cleanup = (): void => {
        if (worker) worker.terminate()
        if (url) URL.revokeObjectURL(url)
      }
      try {
        const blob = new Blob([WORKER_SOURCE], { type: 'text/javascript' })
        url = URL.createObjectURL(blob)
        worker = new Worker(url)
      } catch (err) {
        cleanup()
        reject(err instanceof Error ? err : new Error(String(err)))
        return
      }
      worker.onmessage = (ev: MessageEvent<{ solution?: string; error?: string }>) => {
        const { solution, error } = ev.data
        cleanup()
        if (typeof solution === 'string') resolve(solution)
        else reject(new Error(error ?? 'worker failed'))
      }
      worker.onerror = (ev) => {
        cleanup()
        reject(new Error(ev.message || 'worker error'))
      }
      worker.postMessage({ token, difficulty })
    })
  }

  function init(config: Config): void {
    const form = findForm(config.script)
    const badge = config.badge ? createBadge() : null
    if (badge) document.body.appendChild(badge.el)

    const state: {
      ready: boolean
      token: string | null
      fullToken: string | null
      expiresAt: number
      inFlight: Promise<string> | null
    } = {
      ready: false,
      token: null,
      fullToken: null,
      expiresAt: 0,
      inFlight: null,
    }

    async function fetchChallenge(): Promise<ChallengeResponse> {
      const res = await fetch(
        `${config.base}/api/challenge?sitekey=${encodeURIComponent(config.sitekey)}`,
        { method: 'GET' }
      )
      if (!res.ok) throw new Error(`challenge request failed: ${res.status}`)
      return (await res.json()) as ChallengeResponse
    }

    async function runSolve(): Promise<string> {
      badge?.set('solving')
      const challenge = await fetchChallenge()
      const solution = await solveInWorker(challenge.token, challenge.difficulty)
      const fullToken = `${challenge.token}.${solution}`
      state.token = challenge.token
      state.fullToken = fullToken
      state.expiresAt = Date.now() + challenge.ttl
      state.ready = true
      if (form) setHiddenField(form, fullToken)
      badge?.set('verified')
      if (config.callback) {
        const fn = (window as unknown as Record<string, unknown>)[config.callback]
        if (typeof fn === 'function') {
          ;(fn as (t: string) => void)(fullToken)
        }
      }
      return fullToken
    }

    function isExpired(): boolean {
      return !state.fullToken || Date.now() >= state.expiresAt
    }

    function solve(): Promise<string> {
      if (state.inFlight) return state.inFlight
      const p = runSolve()
        .catch((err) => {
          badge?.set('error')
          throw err
        })
        .finally(() => {
          state.inFlight = null
        })
      state.inFlight = p
      return p
    }

    // Auto re-solve when the token expires (lazy: only checked on access/submit,
    // plus a light timer so the badge reflects reality on idle pages).
    function ensureFresh(): Promise<string> {
      if (isExpired()) {
        state.ready = false
        return solve()
      }
      return Promise.resolve(state.fullToken as string)
    }

    if (form) {
      form.addEventListener('submit', (ev) => {
        if (isExpired()) {
          ev.preventDefault()
          ensureFresh()
            .then(() => {
              if (form.requestSubmit) form.requestSubmit()
              else form.submit()
            })
            .catch(() => {
              /* badge already shows error; leave form for user retry */
            })
        }
      })
    }

    // Public API on window.
    ;(window as unknown as Record<string, unknown>).areyoubot = {
      get ready(): boolean {
        return state.ready && !isExpired()
      },
      solve(): Promise<string> {
        return ensureFresh()
      },
      getToken(): string | null {
        return isExpired() ? null : state.fullToken
      },
    }

    // Kick off the first solve immediately.
    solve().catch(() => {
      /* error surfaced via badge; getToken() returns null until retried */
    })

    // Periodically refresh an expired token so badge + field stay valid.
    window.setInterval(() => {
      if (isExpired() && !state.inFlight) {
        solve().catch(() => {
          /* swallow; next tick retries */
        })
      }
    }, 15_000)
  }

  const config = readConfig()
  if (!config) return
  if (document.body) {
    init(config)
  } else {
    document.addEventListener('DOMContentLoaded', () => init(config), { once: true })
  }
})()
