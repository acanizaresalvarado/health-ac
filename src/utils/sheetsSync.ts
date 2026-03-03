import {
  AppSchemaVersion,
  MeasurementEntry,
  Objective,
  SheetsSyncEnvelope,
  SheetsSyncMode,
  SyncQueueItem,
  SyncQueueItemInput,
  TrainingTemplateDay,
  WorkoutSetLog,
  WorkoutSessionLog
} from '../types'
import { enqueue, flushQueue, loadQueue } from './syncQueue'

const TOKEN_STORAGE_KEY = 'health-tracker-sheets-sync-token-v1'
const DEFAULT_BATCH_SIZE = 120

type WebhookResponse = {
  ok: boolean
  accepted?: string[]
  errors?: string[]
  error?: string
}

const hasLocalStorage = () => typeof localStorage !== 'undefined'

const normalizeToken = (token: string) => token.trim()

const sanitizeRecord = (row: Record<string, unknown>): Record<string, unknown> => {
  const next: Record<string, unknown> = {}
  Object.entries(row).forEach(([key, value]) => {
    next[key] = value ?? null
  })
  return next
}

const toAcceptedKey = (item: SyncQueueItem) => `${item.entity}::${item.key}`
const templateDayLabel = (templateDayId: string) => (templateDayId === 'CUSTOM' ? 'Dia libre' : `Dia ${templateDayId}`)

export function setSheetsSyncToken(token: string): void {
  if (!hasLocalStorage()) return
  const normalized = normalizeToken(token)
  if (!normalized) {
    localStorage.removeItem(TOKEN_STORAGE_KEY)
    return
  }
  localStorage.setItem(TOKEN_STORAGE_KEY, normalized)
}

export function getSheetsSyncToken(): string {
  if (!hasLocalStorage()) return ''
  return normalizeToken(localStorage.getItem(TOKEN_STORAGE_KEY) || '')
}

export function hasSheetsSyncToken(): boolean {
  return Boolean(getSheetsSyncToken())
}

export function clearSheetsSyncToken(): void {
  if (!hasLocalStorage()) return
  localStorage.removeItem(TOKEN_STORAGE_KEY)
}

export function toSyncRowsFromSession(session: WorkoutSessionLog): SyncQueueItemInput[] {
  const sessionRow: SyncQueueItemInput = {
    entity: 'sessions',
    key: session.id,
    data: sanitizeRecord({
      session_id: session.id,
      date: session.date,
      template_day_id: session.templateDayId,
      template_day_label: templateDayLabel(session.templateDayId),
      notes: session.notes || '',
      sets_count: session.sets.length,
      is_deleted: 0,
      created_at: session.createdAt,
      updated_at: session.updatedAt
    }),
    updatedAt: session.updatedAt
  }

  const setRows: SyncQueueItemInput[] = session.sets.map((set) => ({
    entity: 'sets',
    key: set.id,
    data: sanitizeRecord({
      set_id: set.id,
      session_id: session.id,
      date: session.date,
      template_day_id: session.templateDayId,
      template_day_label: templateDayLabel(session.templateDayId),
      exercise_id: set.exerciseId,
      set_number: set.setNumber,
      reps: set.reps,
      weight_kg: set.weightKg,
      rir: set.rir,
      is_warmup: set.isWarmup ? 1 : 0,
      is_deleted: 0,
      updated_at: session.updatedAt
    }),
    updatedAt: session.updatedAt
  }))

  return [sessionRow, ...setRows]
}

export function toSoftDeleteRowsFromSets(
  session: Pick<WorkoutSessionLog, 'id' | 'date' | 'templateDayId'>,
  sets: WorkoutSetLog[],
  updatedAt = new Date().toISOString()
): SyncQueueItemInput[] {
  if (!sets.length) return []

  return sets.map((set) => ({
    entity: 'sets',
    key: set.id,
    data: sanitizeRecord({
      set_id: set.id,
      session_id: session.id,
      date: session.date,
      template_day_id: session.templateDayId,
      template_day_label: templateDayLabel(session.templateDayId),
      exercise_id: set.exerciseId,
      set_number: set.setNumber,
      reps: set.reps,
      weight_kg: set.weightKg,
      rir: set.rir,
      is_warmup: set.isWarmup ? 1 : 0,
      is_deleted: 1,
      updated_at: updatedAt,
      deleted_at: updatedAt
    }),
    updatedAt
  }))
}

export function toSoftDeleteRowsFromSession(
  session: WorkoutSessionLog,
  updatedAt = new Date().toISOString()
): SyncQueueItemInput[] {
  const deletedSessionRow: SyncQueueItemInput = {
    entity: 'sessions',
    key: session.id,
    data: sanitizeRecord({
      session_id: session.id,
      date: session.date,
      template_day_id: session.templateDayId,
      template_day_label: templateDayLabel(session.templateDayId),
      notes: session.notes || '',
      sets_count: 0,
      is_deleted: 1,
      created_at: session.createdAt,
      updated_at: updatedAt,
      deleted_at: updatedAt
    }),
    updatedAt
  }

  return [deletedSessionRow, ...toSoftDeleteRowsFromSets(session, session.sets, updatedAt)]
}

export function toSyncRowsFromMeasurement(measurement: MeasurementEntry): SyncQueueItemInput[] {
  return [
    {
      entity: 'measurements',
      key: measurement.date,
      data: sanitizeRecord({
        date: measurement.date,
        measurement_id: measurement.id,
        weight_kg: measurement.weightKg,
        waist_cm: measurement.waistCm,
        lumbar_pain: measurement.lumbarPain,
        steps: measurement.steps,
        sleep_hours: measurement.sleepHours,
        chest_cm: measurement.chestCm,
        shoulders_cm: measurement.shouldersCm,
        arm_cm: measurement.armCm,
        hips_cm: measurement.hipsCm
      }),
      updatedAt: new Date().toISOString()
    }
  ]
}

export function toSyncRowsFromObjective(objective: Objective): SyncQueueItemInput[] {
  return [
    {
      entity: 'objectives',
      key: objective.id,
      data: sanitizeRecord({
        objective_id: objective.id,
        title: objective.title,
        metric: objective.metric,
        target_value: objective.targetValue,
        unit: objective.unit,
        deadline: objective.deadline,
        status: objective.status,
        notes: objective.notes || '',
        created_at: objective.createdAt,
        updated_at: objective.updatedAt
      }),
      updatedAt: objective.updatedAt
    }
  ]
}

export function toSyncRowsFromTemplate(template: TrainingTemplateDay): SyncQueueItemInput[] {
  if (!template.exercises.length) {
    return [
      {
        entity: 'templates',
        key: `${template.id}::__none__`,
        data: sanitizeRecord({
          template_day_id: template.id,
          template_label: template.label,
          exercise_id: '__none__',
          exercise_name: '',
          order: 0,
          target_sets: null,
          rep_range: null,
          rir_range: null,
          notes: null,
          is_empty: 1
        }),
        updatedAt: new Date().toISOString()
      }
    ]
  }

  return template.exercises.map((exercise) => ({
    entity: 'templates',
    key: `${template.id}::${exercise.exerciseId}`,
    data: sanitizeRecord({
      template_day_id: template.id,
      template_label: template.label,
      exercise_id: exercise.exerciseId,
      exercise_name: exercise.name,
      order: exercise.order,
      target_sets: exercise.targetSets ?? null,
      rep_range: exercise.repRange ?? null,
      rir_range: exercise.rirRange ?? null,
      notes: exercise.notes ?? null,
      is_empty: 0
    }),
    updatedAt: new Date().toISOString()
  }))
}

const buildEnvelope = (
  items: SyncQueueItem[],
  token: string | undefined,
  schemaVersion: AppSchemaVersion,
  deviceId?: string
): SheetsSyncEnvelope => ({
  source: 'health-tracker-pwa',
  schemaVersion,
  generatedAt: new Date().toISOString(),
  deviceId,
  token,
  items: items.map((item) => ({
    entity: item.entity,
    key: item.key,
    op: item.op,
    updatedAt: item.updatedAt,
    data: item.data
  }))
})

export async function postToSheetsWebhook(endpointUrl: string, envelope: SheetsSyncEnvelope): Promise<WebhookResponse> {
  const response = await fetch(endpointUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(envelope)
  })

  if (!response.ok) {
    return { ok: false, error: `HTTP ${response.status}` }
  }

  const payload = (await response.json()) as Partial<WebhookResponse>
  return {
    ok: Boolean(payload.ok),
    accepted: Array.isArray(payload.accepted) ? payload.accepted.filter((entry): entry is string => typeof entry === 'string') : undefined,
    errors: Array.isArray(payload.errors) ? payload.errors.filter((entry): entry is string => typeof entry === 'string') : undefined,
    error: typeof payload.error === 'string' ? payload.error : undefined
  }
}

export function enqueueSyncRows(items: SyncQueueItemInput[]): number {
  return enqueue(items).length
}

export function getSyncQueueSize(): number {
  return loadQueue().length
}

export async function syncNow(params: {
  endpointUrl: string
  token?: string
  schemaVersion: AppSchemaVersion
  deviceId?: string
  batchSize?: number
  force?: boolean
  mode: SheetsSyncMode
}): Promise<{ ok: boolean; sent: number; pending: number; failed: number; error?: string; syncedAt?: string }> {
  const endpointUrl = params.endpointUrl.trim()
  const mode = params.mode
  const token = mode === 'direct_webhook' ? normalizeToken(params.token || getSheetsSyncToken()) : undefined

  if (!endpointUrl) {
    return { ok: false, sent: 0, pending: getSyncQueueSize(), failed: 0, error: 'Falta endpoint URL' }
  }

  if (mode === 'direct_webhook' && !token) {
    return { ok: false, sent: 0, pending: getSyncQueueSize(), failed: 0, error: 'Falta token de escritura' }
  }

  const flush = await flushQueue(
    async (batch) => {
      const envelope = buildEnvelope(batch, token, params.schemaVersion, params.deviceId)
      const result = await postToSheetsWebhook(endpointUrl, envelope)

      if (result.ok) {
        return {
          ok: true,
          accepted:
            result.accepted && result.accepted.length
              ? result.accepted
              : batch.map((item) => toAcceptedKey(item))
        }
      }

      return { ok: false, error: result.error || result.errors?.join('; ') || 'Error de webhook' }
    },
    {
      batchSize: params.batchSize ?? DEFAULT_BATCH_SIZE,
      nowMs: params.force ? Number.MAX_SAFE_INTEGER : undefined
    }
  )

  return {
    ok: !flush.error,
    sent: flush.sent,
    pending: flush.pending,
    failed: flush.failed,
    error: flush.error,
    syncedAt: flush.sent > 0 ? new Date().toISOString() : undefined
  }
}

export const getSheetsSyncTokenStorageKey = () => TOKEN_STORAGE_KEY
