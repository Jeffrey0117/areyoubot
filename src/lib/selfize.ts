// Selfize REST client. Reads base URL + bearer token from env at call time
// (so tests can stub env / the deploy can set it once). All write/read paths
// go through `selfizeFetch`, which centralises auth + error handling.

export type SelfizeFieldType = 'text' | 'number' | 'integer' | 'boolean' | 'json' | 'date'

export interface SelfizeField {
  readonly name: string
  readonly type: SelfizeFieldType
  readonly required?: boolean
}

export type SelfizeRule = 'public' | 'admin'

export interface SelfizeRules {
  readonly read: SelfizeRule
  readonly create: SelfizeRule
  readonly update: SelfizeRule
  readonly delete: SelfizeRule
}

export interface SelfizeRecord {
  readonly id: string
  readonly created_at?: string
  readonly updated_at?: string
  readonly [key: string]: unknown
}

interface ListResponse {
  readonly items: SelfizeRecord[]
  readonly total?: number
  readonly limit?: number
  readonly offset?: number
}

interface SelfizeConfig {
  readonly baseUrl: string
  readonly token: string
}

function getConfig(): SelfizeConfig {
  const baseUrl = process.env.SELFIZE_URL
  const token = process.env.SELFIZE_TOKEN
  if (!baseUrl) throw new Error('SELFIZE_URL not configured')
  if (!token) throw new Error('SELFIZE_TOKEN not configured')
  return { baseUrl: baseUrl.replace(/\/+$/, ''), token }
}

interface SelfizeFetchOptions {
  readonly method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  readonly body?: unknown
  // When set, these HTTP statuses are treated as success and parsed (or null).
  // Used by ensureReady() to swallow "collection already exists" (409).
  readonly okStatuses?: readonly number[]
}

export async function selfizeFetch<T = unknown>(
  path: string,
  options: SelfizeFetchOptions = {}
): Promise<T> {
  const { baseUrl, token } = getConfig()
  const { method = 'GET', body, okStatuses } = options
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  if (!res.ok && !(okStatuses ?? []).includes(res.status)) {
    const text = await res.text().catch(() => '')
    throw new Error(`selfize ${method} ${path} failed: ${res.status} ${text}`)
  }
  if (res.status === 204) return null as T
  return (await res.json().catch(() => null)) as T
}

export async function sfCreateCollection(input: {
  name: string
  schema: readonly SelfizeField[]
  rules: SelfizeRules
}): Promise<void> {
  await selfizeFetch('/api/collections', {
    method: 'POST',
    body: { name: input.name, schema: input.schema, rules: input.rules },
    // 409 / already-exists is fine for idempotent ensureReady.
    okStatuses: [409],
  })
}

export async function sfCreate(collection: string, record: Record<string, unknown>): Promise<SelfizeRecord> {
  return selfizeFetch<SelfizeRecord>(`/api/collections/${collection}/records`, {
    method: 'POST',
    body: record,
  })
}

export async function sfList(collection: string): Promise<SelfizeRecord[]> {
  const out = await selfizeFetch<ListResponse>(`/api/collections/${collection}/records`)
  return out?.items ?? []
}

export async function sfFindOne(
  collection: string,
  field: string,
  value: string
): Promise<SelfizeRecord | null> {
  const query = `${encodeURIComponent(field)}=eq.${encodeURIComponent(value)}&limit=1`
  const out = await selfizeFetch<ListResponse>(`/api/collections/${collection}/records?${query}`)
  return out?.items?.[0] ?? null
}

export async function sfDelete(collection: string, id: string): Promise<void> {
  await selfizeFetch(`/api/collections/${collection}/records/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}
