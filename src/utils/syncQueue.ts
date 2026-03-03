import { SyncQueueItem, SyncQueueItemInput } from '../types'

const SYNC_QUEUE_KEY = 'health-tracker-sheets-sync-queue-v1'
const MAX_QUEUE_ITEMS = 1500
const DEFAULT_BATCH_SIZE = 200
const RETRY_BASE_MS = 1500
const RETRY_MAX_MS = 5 * 60 * 1000

type FlushProcessorResult = {
  ok: boolean
  accepted?: string[]
  error?: string
}

type FlushProcessor = (items: SyncQueueItem[]) => Promise<FlushProcessorResult>

const nowIso = () => new Date().toISOString()

const uid = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

const hasLocalStorage = () => typeof localStorage !== 'undefined'

const safeParse = (value: string): unknown => {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

const parseNumber = (value: unknown, fallback: number): number => {
  if (typeof value !== 'number') return fallback
  if (!Number.isFinite(value)) return fallback
  return value
}

const isEntity = (value: unknown): value is SyncQueueItem['entity'] =>
  value === 'sessions' ||
  value === 'sets' ||
  value === 'measurements' ||
  value === 'objectives' ||
  value === 'templates'

const isOperation = (value: unknown): value is SyncQueueItem['op'] => value === 'upsert'

const normalizeQueueItem = (row: unknown): SyncQueueItem | null => {
  if (!row || typeof row !== 'object') return null
  const raw = row as Record<string, unknown>

  if (!isEntity(raw.entity)) return null
  if (typeof raw.key !== 'string' || !raw.key) return null
  if (!isOperation(raw.op)) return null

  const updatedAt = typeof raw.updatedAt === 'string' ? raw.updatedAt : nowIso()
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : uid(),
    entity: raw.entity,
    key: raw.key,
    op: raw.op,
    data: raw.data && typeof raw.data === 'object' ? (raw.data as Record<string, unknown>) : {},
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : updatedAt,
    updatedAt,
    attempts: Math.max(0, Math.floor(parseNumber(raw.attempts, 0))),
    nextRetryAt: Math.max(0, Math.floor(parseNumber(raw.nextRetryAt, 0))),
    lastError: typeof raw.lastError === 'string' ? raw.lastError : undefined
  }
}

export function loadQueue(): SyncQueueItem[] {
  if (!hasLocalStorage()) return []
  const raw = localStorage.getItem(SYNC_QUEUE_KEY)
  if (!raw) return []

  const parsed = safeParse(raw)
  if (!Array.isArray(parsed)) return []

  return parsed
    .map((item) => normalizeQueueItem(item))
    .filter((item): item is SyncQueueItem => Boolean(item))
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
}

export function saveQueue(items: SyncQueueItem[]): void {
  if (!hasLocalStorage()) return
  localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(items))
}

export function compactQueueByKey(items: SyncQueueItem[]): SyncQueueItem[] {
  const byKey = new Map<string, SyncQueueItem>()

  items.forEach((item) => {
    const key = `${item.entity}::${item.key}`
    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, item)
      return
    }

    if (item.updatedAt >= existing.updatedAt) {
      byKey.set(key, item)
    }
  })

  return Array.from(byKey.values()).sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
}

const toQueueItem = (input: SyncQueueItemInput): SyncQueueItem => {
  const updatedAt = input.updatedAt || nowIso()
  return {
    id: uid(),
    entity: input.entity,
    key: input.key,
    op: input.op ?? 'upsert',
    data: input.data,
    createdAt: updatedAt,
    updatedAt,
    attempts: 0,
    nextRetryAt: 0
  }
}

export function enqueue(items: SyncQueueItemInput[]): SyncQueueItem[] {
  if (!items.length) return loadQueue()

  const current = loadQueue()
  const merged = compactQueueByKey([...current, ...items.map((item) => toQueueItem(item))])
  const trimmed = merged.length > MAX_QUEUE_ITEMS ? merged.slice(merged.length - MAX_QUEUE_ITEMS) : merged
  saveQueue(trimmed)
  return trimmed
}

const computeRetryDelayMs = (attempts: number): number => {
  const level = Math.max(0, attempts - 1)
  return Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** level)
}

const markItemFailure = (item: SyncQueueItem, error: string, nowMs: number): SyncQueueItem => {
  const attempts = item.attempts + 1
  return {
    ...item,
    attempts,
    nextRetryAt: nowMs + computeRetryDelayMs(attempts),
    lastError: error
  }
}

const matchesAccepted = (item: SyncQueueItem, accepted: Set<string>): boolean => {
  if (!accepted.size) return true
  return accepted.has(item.key) || accepted.has(`${item.entity}::${item.key}`)
}

export async function flushQueue(
  processBatch: FlushProcessor,
  options?: { batchSize?: number; nowMs?: number }
): Promise<{ sent: number; pending: number; failed: number; error?: string }> {
  const nowMs = options?.nowMs ?? Date.now()
  const batchSize = Math.max(1, options?.batchSize ?? DEFAULT_BATCH_SIZE)
  const queue = loadQueue()
  const due = queue.filter((item) => item.nextRetryAt <= nowMs)

  if (!due.length) {
    return { sent: 0, pending: queue.length, failed: 0 }
  }

  const batch = due.slice(0, batchSize)
  const byId = new Map(queue.map((item) => [item.id, item]))

  try {
    const result = await processBatch(batch)
    const accepted = new Set(result.accepted ?? [])

    if (result.ok) {
      if (!accepted.size) {
        batch.forEach((item) => byId.delete(item.id))
        const next = Array.from(byId.values())
        saveQueue(next)
        return { sent: batch.length, pending: next.length, failed: 0 }
      }

      let sent = 0
      let failed = 0

      batch.forEach((item) => {
        if (matchesAccepted(item, accepted)) {
          byId.delete(item.id)
          sent += 1
          return
        }

        byId.set(item.id, markItemFailure(item, 'Elemento no aceptado por webhook', nowMs))
        failed += 1
      })

      const next = Array.from(byId.values())
      saveQueue(next)
      return { sent, pending: next.length, failed, error: failed ? 'Aceptacion parcial del webhook' : undefined }
    }

    batch.forEach((item) => {
      byId.set(item.id, markItemFailure(item, result.error || 'Error de sincronizacion', nowMs))
    })
    const next = Array.from(byId.values())
    saveQueue(next)
    return { sent: 0, pending: next.length, failed: batch.length, error: result.error || 'Error de sincronizacion' }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error de red'
    batch.forEach((item) => {
      byId.set(item.id, markItemFailure(item, message, nowMs))
    })
    const next = Array.from(byId.values())
    saveQueue(next)
    return { sent: 0, pending: next.length, failed: batch.length, error: message }
  }
}

export const getQueueStorageKey = () => SYNC_QUEUE_KEY
