'use client'

import { useEffect, useState, useCallback } from 'react'

// letmeuse app id for areyoubot. Prefer NEXT_PUBLIC_LETMEUSE_APP_ID; fall back to
// the known app id so the page works even if the env var is not wired in a given
// environment. (App id is public — it's safe to ship in client JS.)
const LETMEUSE_APP_ID = process.env.NEXT_PUBLIC_LETMEUSE_APP_ID || 'app_KeD453DW'
const ACCENT = '#16a34a'

interface LetmeuseUser {
  id: string
  email: string
  displayName?: string
  role?: string
}

interface LetmeuseSdk {
  ready: boolean
  user: LetmeuseUser | null
  login: () => void
  logout: () => Promise<void>
  getToken: () => string | null
  onAuthChange: (cb: (user: LetmeuseUser | null) => void) => () => void
}

declare global {
  interface Window {
    letmeuse?: LetmeuseSdk
  }
}

interface SiteRow {
  sitekey: string
  difficulty: number
  disabled: boolean
  label: string
  created_at: string | null
}

interface CreatedSite {
  sitekey: string
  secret: string
  difficulty: number
  label: string
}

const SDK_SRC = 'https://letmeuse.isnowfriend.com/letmeuse.js'

function useLetmeuse(): { ready: boolean; user: LetmeuseUser | null } {
  const [ready, setReady] = useState(false)
  const [user, setUser] = useState<LetmeuseUser | null>(null)

  useEffect(() => {
    let unsub: (() => void) | undefined

    const wire = () => {
      const sdk = window.letmeuse
      if (!sdk) return false
      setReady(true)
      unsub = sdk.onAuthChange((u) => setUser(u))
      return true
    }

    if (wire()) return () => unsub?.()

    // Inject the SDK script once, then wire on load.
    let script = document.querySelector<HTMLScriptElement>(`script[data-app-id="${LETMEUSE_APP_ID}"]`)
    if (!script) {
      script = document.createElement('script')
      script.src = SDK_SRC
      script.async = true
      script.setAttribute('data-app-id', LETMEUSE_APP_ID)
      script.setAttribute('data-accent', ACCENT)
      document.head.appendChild(script)
    }
    const onLoad = () => {
      // SDK may need a tick to set window.letmeuse.ready
      const poll = setInterval(() => {
        if (wire()) clearInterval(poll)
      }, 50)
      setTimeout(() => clearInterval(poll), 5000)
    }
    script.addEventListener('load', onLoad)
    return () => {
      script?.removeEventListener('load', onLoad)
      unsub?.()
    }
  }, [])

  return { ready, user }
}

export default function AdminPage() {
  const { ready, user } = useLetmeuse()
  const [isAdmin, setIsAdmin] = useState(false)
  const [sites, setSites] = useState<SiteRow[]>([])
  const [label, setLabel] = useState('')
  const [difficulty, setDifficulty] = useState(18)
  const [created, setCreated] = useState<CreatedSite | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // Ask the server (with the current token) whether this user is the admin.
  // Server enforces authorisation on every call; this is purely for UX gating
  // and avoids leaking the configured admin email to the client.
  useEffect(() => {
    if (!user) {
      setIsAdmin(false)
      return
    }
    const token = window.letmeuse?.getToken()
    if (!token) return
    fetch('/api/admin/whoami', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setIsAdmin(Boolean(d?.isAdmin)))
      .catch(() => setIsAdmin(false))
  }, [user])

  const loadSites = useCallback(async () => {
    const token = window.letmeuse?.getToken()
    if (!token) return
    setError(null)
    try {
      const res = await fetch('/api/admin/sites', { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) {
        setError('無法載入 site 列表')
        return
      }
      const data = await res.json()
      setSites(data.sites ?? [])
    } catch {
      setError('無法載入 site 列表')
    }
  }, [])

  useEffect(() => {
    if (isAdmin) void loadSites()
  }, [isAdmin, loadSites])

  const createSite = useCallback(async () => {
    const token = window.letmeuse?.getToken()
    if (!token) return
    setLoading(true)
    setError(null)
    setCreated(null)
    try {
      const res = await fetch('/api/admin/sites', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ label, difficulty }),
      })
      if (!res.ok) {
        setError('建立失敗')
        return
      }
      const data = (await res.json()) as CreatedSite
      setCreated(data)
      setLabel('')
      await loadSites()
    } catch {
      setError('建立失敗')
    } finally {
      setLoading(false)
    }
  }, [label, difficulty, loadSites])

  return (
    <main style={styles.page}>
      <div style={styles.card}>
        <h1 style={styles.h1}>areyoubot 管理後台</h1>

        {!ready && <p style={styles.muted}>載入中...</p>}

        {ready && !user && (
          <div>
            <p style={styles.muted}>請用管理員帳號登入。</p>
            <button style={styles.primaryBtn} onClick={() => window.letmeuse?.login()}>
              登入
            </button>
          </div>
        )}

        {ready && user && !isAdmin && (
          <div>
            <p style={styles.muted}>
              你已登入為 <strong>{user.email}</strong>，但此帳號沒有管理權限。
            </p>
          </div>
        )}

        {ready && user && isAdmin && (
          <div>
            <p style={styles.muted}>
              管理員：<strong>{user.email}</strong>
            </p>

            <section style={styles.section}>
              <h2 style={styles.h2}>建立 site</h2>
              <label style={styles.label}>
                名稱 (label)
                <input
                  style={styles.input}
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="My App"
                />
              </label>
              <label style={styles.label}>
                難度 (difficulty)
                <input
                  style={styles.input}
                  type="number"
                  min={1}
                  max={24}
                  value={difficulty}
                  onChange={(e) => setDifficulty(Number(e.target.value))}
                />
              </label>
              <button style={styles.primaryBtn} onClick={createSite} disabled={loading}>
                {loading ? '建立中...' : '建立 site'}
              </button>
            </section>

            {created && (
              <div style={styles.secretBox}>
                <p style={styles.secretTitle}>已建立 — secret 只會出現這一次，請立即複製保存。</p>
                <div style={styles.kv}>
                  <span style={styles.k}>sitekey</span>
                  <code style={styles.code}>{created.sitekey}</code>
                </div>
                <div style={styles.kv}>
                  <span style={styles.k}>secret</span>
                  <code style={styles.code}>{created.secret}</code>
                </div>
              </div>
            )}

            {error && <p style={styles.error}>{error}</p>}

            <section style={styles.section}>
              <h2 style={styles.h2}>現有 site</h2>
              {sites.length === 0 ? (
                <p style={styles.muted}>尚無 site。</p>
              ) : (
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>sitekey</th>
                      <th style={styles.th}>label</th>
                      <th style={styles.th}>難度</th>
                      <th style={styles.th}>狀態</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sites.map((s) => (
                      <tr key={s.sitekey}>
                        <td style={styles.td}>
                          <code style={styles.code}>{s.sitekey}</code>
                        </td>
                        <td style={styles.td}>{s.label || '—'}</td>
                        <td style={styles.td}>{s.difficulty}</td>
                        <td style={styles.td}>{s.disabled ? '停用' : '啟用'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </div>
        )}
      </div>
    </main>
  )
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: '#f8fafc',
    display: 'flex',
    justifyContent: 'center',
    padding: '48px 16px',
    fontFamily: 'system-ui, sans-serif',
    color: '#0f172a',
  },
  card: {
    width: '100%',
    maxWidth: 720,
    background: '#fff',
    border: '1px solid #e2e8f0',
    borderRadius: 12,
    padding: 32,
    boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
  },
  h1: { fontSize: 22, fontWeight: 700, margin: '0 0 16px' },
  h2: { fontSize: 16, fontWeight: 600, margin: '0 0 12px' },
  muted: { color: '#64748b', fontSize: 14, margin: '0 0 16px' },
  section: { marginTop: 24, paddingTop: 24, borderTop: '1px solid #f1f5f9' },
  label: { display: 'block', fontSize: 13, color: '#334155', marginBottom: 12 },
  input: {
    display: 'block',
    width: '100%',
    marginTop: 4,
    padding: '8px 10px',
    border: '1px solid #cbd5e1',
    borderRadius: 8,
    fontSize: 14,
    boxSizing: 'border-box',
  },
  primaryBtn: {
    background: ACCENT,
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    padding: '10px 18px',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
  },
  secretBox: {
    marginTop: 20,
    padding: 16,
    background: '#f0fdf4',
    border: `1px solid ${ACCENT}`,
    borderRadius: 8,
  },
  secretTitle: { margin: '0 0 12px', fontSize: 13, fontWeight: 600, color: '#166534' },
  kv: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 },
  k: { width: 70, fontSize: 12, color: '#64748b' },
  code: {
    fontFamily: 'ui-monospace, monospace',
    fontSize: 13,
    background: '#f1f5f9',
    padding: '2px 6px',
    borderRadius: 4,
    wordBreak: 'break-all',
  },
  error: { color: '#dc2626', fontSize: 14, marginTop: 12 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { textAlign: 'left', padding: '8px 6px', borderBottom: '2px solid #e2e8f0', color: '#475569' },
  td: { padding: '8px 6px', borderBottom: '1px solid #f1f5f9' },
}
