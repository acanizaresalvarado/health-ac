import {
  AppSchemaVersion,
  AppSaveMeta,
  AppState,
  ExerciseCatalogItem,
  MeasurementEntry,
  Objective,
  TrainingTemplateDay,
  WorkoutSessionLog,
  WorkoutSetLog
} from '../types'
import {
  DEFAULT_EXERCISE_CATALOG,
  DEFAULT_OBJECTIVES,
  DEFAULT_TRAINING_TEMPLATES
} from '../constants'
import { createEmptySession, formatDateInputValue, normalizeSetNumbers, uid } from './metrics'

const STORAGE_KEY = 'health-tracker-state-v2'
const LEGACY_BACKUP_PREFIX = 'health-tracker-state-v5-backup-'
const DB_NAME = 'health-tracker-db'
const STORE_NAME = 'state'
const STORAGE_VERSION: AppSchemaVersion = 6
const SAVE_DEBOUNCE_MS = 500
const DEVICE_ID_KEY = 'health-tracker-device-id'
const BASE_URL = (import.meta.env.BASE_URL as string | undefined) || '/'
const BASE_NORMALIZED = BASE_URL.endsWith('/') ? BASE_URL.slice(0, -1) : BASE_URL
const BASE_AWARE_DEFAULT_SYNC_ENDPOINT = `${BASE_NORMALIZED}/api/sheets-sync`.replace(/\/{2,}/g, '/')
const DEFAULT_BACKEND_SYNC_ENDPOINT = (
  (import.meta.env.VITE_SYNC_API_ENDPOINT as string | undefined) || BASE_AWARE_DEFAULT_SYNC_ENDPOINT
).trim()

export type StorageSaveResult = {
  usedFallback: boolean
  savedAt: number
  source: 'indexeddb' | 'localstorage'
}

let saveDebounceTimer: ReturnType<typeof setTimeout> | null = null
let pendingSaveResolvers: Array<{ resolve: (value: StorageSaveResult) => void; reject: (reason?: unknown) => void }> = []

type LegacyWorkoutSet = {
  exerciseId?: string
  exercise?: string
  sets?: number
  reps?: number
  weightKg?: number
  rir?: number
}

type LegacyWorkoutSession = {
  sets?: LegacyWorkoutSet[]
}

type LegacyDailyLog = {
  id?: string
  date?: string
  dayType?: 'gym' | 'nogym'
  note?: string
  workout?: LegacyWorkoutSession[]
}

type LegacyState = {
  createdAt?: string
  updatedAt?: string
  version?: number
  logs?: LegacyDailyLog[]
  measurements?: MeasurementEntry[]
  exerciseCatalog?: ExerciseCatalogItem[]
  draftByDate?: Record<string, LegacyDailyLog>
  settings?: {
    notificationsEnabled?: boolean
    sheetsSync?: {
      enabled?: boolean
      mode?: 'backend_proxy' | 'direct_webhook'
      endpointUrl?: string
      autoSyncOnSave?: boolean
      lastSyncAt?: string
      lastSyncStatus?: 'idle' | 'syncing' | 'success' | 'error'
      lastSyncError?: string
    }
  }
  meta?: Partial<AppSaveMeta>
}

const isStorageAvailable = (storage: Storage) => {
  try {
    const test = '__test__'
    storage.setItem(test, test)
    storage.removeItem(test)
    return true
  } catch {
    return false
  }
}

const toIso = () => new Date().toISOString()

const parseFiniteNumber = (value: unknown): number | undefined => {
  if (typeof value !== 'number') return undefined
  if (!Number.isFinite(value)) return undefined
  return value
}

const parsePositiveNumber = (value: unknown): number | undefined => {
  const parsed = parseFiniteNumber(value)
  if (parsed == null || parsed <= 0) return undefined
  return parsed
}

const parseDateValue = (value: unknown): string => {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  return formatDateInputValue()
}

function getDeviceId(): string {
  const fallback = `device-${Date.now().toString(36)}`
  if (typeof localStorage === 'undefined' || !isStorageAvailable(localStorage)) return fallback

  const existing = localStorage.getItem(DEVICE_ID_KEY)
  if (existing) return existing

  const generated = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  localStorage.setItem(DEVICE_ID_KEY, generated)
  return generated
}

function normalizeMeta(rawMeta: Partial<AppSaveMeta> | undefined): AppSaveMeta {
  return {
    lastSavedAt: typeof rawMeta?.lastSavedAt === 'number' ? rawMeta.lastSavedAt : Date.now(),
    schemaVersion: STORAGE_VERSION,
    deviceId: rawMeta?.deviceId || getDeviceId(),
    lastSavedWithFallback: rawMeta?.lastSavedWithFallback
  }
}

function normalizeSheetsSyncSettings(raw: unknown): AppState['settings']['sheetsSync'] {
  const value = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const status = value.lastSyncStatus
  const mode = value.mode
  const endpoint = typeof value.endpointUrl === 'string' ? value.endpointUrl.trim() : ''
  const inferredMode =
    mode === 'direct_webhook' || mode === 'backend_proxy'
      ? mode
      : endpoint.includes('script.google.com/macros')
        ? 'direct_webhook'
        : 'backend_proxy'
  const normalizedEndpoint =
    endpoint === '/api/sheets-sync' && inferredMode === 'backend_proxy' ? DEFAULT_BACKEND_SYNC_ENDPOINT : endpoint

  return {
    enabled: typeof value.enabled === 'boolean' ? value.enabled : true,
    mode: inferredMode,
    endpointUrl: normalizedEndpoint || (inferredMode === 'backend_proxy' ? DEFAULT_BACKEND_SYNC_ENDPOINT : ''),
    autoSyncOnSave: typeof value.autoSyncOnSave === 'boolean' ? value.autoSyncOnSave : true,
    lastSyncAt: typeof value.lastSyncAt === 'string' ? value.lastSyncAt : undefined,
    lastSyncStatus:
      status === 'idle' || status === 'syncing' || status === 'success' || status === 'error' ? status : 'idle',
    lastSyncError: typeof value.lastSyncError === 'string' ? value.lastSyncError : undefined
  }
}

const buildExerciseIdFromName = (name: string) => {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')

  return slug ? `custom_${slug}` : `custom_${uid()}`
}

function normalizeExerciseCatalog(rawCatalog: unknown): ExerciseCatalogItem[] {
  const incoming = Array.isArray(rawCatalog) ? rawCatalog : []
  const merged = [...DEFAULT_EXERCISE_CATALOG]
  const knownIds = new Set(merged.map((item) => item.id))

  incoming.forEach((item) => {
    if (!item || typeof item !== 'object') return
    const rawId = (item as { id?: unknown }).id
    const rawName = (item as { name?: unknown }).name
    const name = typeof rawName === 'string' ? rawName.trim() : ''
    const id = typeof rawId === 'string' && rawId.trim() ? rawId : buildExerciseIdFromName(name)
    if (!name || knownIds.has(id)) return

    merged.push({
      id,
      name,
      isCore: Boolean((item as { isCore?: unknown }).isCore),
      coreId: (item as { coreId?: ExerciseCatalogItem['coreId'] }).coreId
    })
    knownIds.add(id)
  })

  return merged
}

function normalizeMeasurement(row: unknown): MeasurementEntry | null {
  if (!row || typeof row !== 'object') return null

  const raw = row as Record<string, unknown>
  const normalized: MeasurementEntry = {
    id: typeof raw.id === 'string' && raw.id ? raw.id : uid(),
    date: parseDateValue(raw.date),
    weightKg: parseFiniteNumber(raw.weightKg),
    waistCm: parseFiniteNumber(raw.waistCm),
    lumbarPain: parseFiniteNumber(raw.lumbarPain),
    steps: parseFiniteNumber(raw.steps),
    sleepHours: parseFiniteNumber(raw.sleepHours),
    chestCm: parseFiniteNumber(raw.chestCm),
    shouldersCm: parseFiniteNumber(raw.shouldersCm),
    armCm: parseFiniteNumber(raw.armCm),
    hipsCm: parseFiniteNumber(raw.hipsCm)
  }

  return normalized
}

function normalizeMeasurements(rows: unknown): MeasurementEntry[] {
  const incoming = Array.isArray(rows) ? rows : []
  const byDate = new Map<string, MeasurementEntry>()

  incoming.forEach((row) => {
    const normalized = normalizeMeasurement(row)
    if (!normalized) return
    byDate.set(normalized.date, normalized)
  })

  return Array.from(byDate.values()).sort((a, b) => b.date.localeCompare(a.date))
}

function normalizeObjective(row: unknown): Objective | null {
  if (!row || typeof row !== 'object') return null

  const raw = row as Record<string, unknown>
  const title = typeof raw.title === 'string' ? raw.title.trim() : ''
  if (!title) return null

  const now = toIso()
  const metric =
    raw.metric === 'waist' ||
    raw.metric === 'weight' ||
    raw.metric === 'strength' ||
    raw.metric === 'consistency' ||
    raw.metric === 'custom'
      ? raw.metric
      : 'custom'

  const status = raw.status === 'active' || raw.status === 'paused' || raw.status === 'done' ? raw.status : 'active'

  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : uid(),
    title,
    metric,
    targetValue: parseFiniteNumber(raw.targetValue),
    unit:
      raw.unit === 'kg' || raw.unit === 'cm' || raw.unit === '%' || raw.unit === 'sessions' || raw.unit === 'custom'
        ? raw.unit
        : undefined,
    deadline: typeof raw.deadline === 'string' ? parseDateValue(raw.deadline) : undefined,
    status,
    notes: typeof raw.notes === 'string' ? raw.notes : undefined,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : now
  }
}

function normalizeObjectives(rows: unknown): Objective[] {
  const incoming = Array.isArray(rows) ? rows : []
  const byId = new Map<string, Objective>()

  incoming.forEach((row) => {
    const normalized = normalizeObjective(row)
    if (!normalized) return
    byId.set(normalized.id, normalized)
  })

  if (!byId.size) {
    return DEFAULT_OBJECTIVES.map((objective) => ({ ...objective }))
  }

  return Array.from(byId.values())
}

function normalizeTemplateExercise(
  row: unknown,
  order: number,
  exerciseCatalog: ExerciseCatalogItem[]
): TrainingTemplateDay['exercises'][number] | null {
  if (!row || typeof row !== 'object') return null

  const raw = row as Record<string, unknown>
  const exerciseId = typeof raw.exerciseId === 'string' ? raw.exerciseId : ''
  if (!exerciseId) return null

  const catalogName = exerciseCatalog.find((item) => item.id === exerciseId)?.name
  const fallbackName = typeof raw.name === 'string' ? raw.name : exerciseId

  return {
    exerciseId,
    name: catalogName || fallbackName,
    order: typeof raw.order === 'number' && raw.order > 0 ? raw.order : order,
    targetSets: parsePositiveNumber(raw.targetSets),
    repRange: typeof raw.repRange === 'string' ? raw.repRange : undefined,
    rirRange: typeof raw.rirRange === 'string' ? raw.rirRange : undefined,
    notes: typeof raw.notes === 'string' ? raw.notes : undefined
  }
}

function normalizeTrainingTemplates(rows: unknown, exerciseCatalog: ExerciseCatalogItem[]): TrainingTemplateDay[] {
  const incoming = Array.isArray(rows) ? rows : []
  const byId = new Map<string, TrainingTemplateDay>()

  incoming.forEach((row) => {
    if (!row || typeof row !== 'object') return
    const raw = row as Record<string, unknown>
    const id = raw.id === 'A' || raw.id === 'B' || raw.id === 'C' || raw.id === 'CUSTOM' ? raw.id : null
    if (!id) return

    const rawExercises = Array.isArray(raw.exercises) ? raw.exercises : []
    const exercises = rawExercises
      .map((entry, index) => normalizeTemplateExercise(entry, index + 1, exerciseCatalog))
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
      .sort((a, b) => a.order - b.order)

    byId.set(id, {
      id,
      label: typeof raw.label === 'string' && raw.label.trim() ? raw.label : `Dia ${id}`,
      exercises
    })
  })

  if (!byId.size) return DEFAULT_TRAINING_TEMPLATES.map((template) => ({ ...template, exercises: [...template.exercises] }))

  ;(['A', 'B', 'C', 'CUSTOM'] as Array<TrainingTemplateDay['id']>).forEach((id) => {
    if (!byId.has(id)) {
      const fallback = DEFAULT_TRAINING_TEMPLATES.find((template) => template.id === id)
      if (fallback) {
        byId.set(id, {
          ...fallback,
          exercises: [...fallback.exercises]
        })
      }
    }
  })

  return Array.from(byId.values())
}

function normalizeSet(
  row: unknown,
  sessionDate: string,
  templateDayId: string
): (WorkoutSetLog & { dedupeKey: string }) | null {
  if (!row || typeof row !== 'object') return null

  const raw = row as Record<string, unknown>
  const exerciseId =
    typeof raw.exerciseId === 'string' && raw.exerciseId
      ? raw.exerciseId
      : typeof raw.exercise === 'string' && raw.exercise
        ? raw.exercise
        : ''

  if (!exerciseId) return null

  const reps = parsePositiveNumber(raw.reps)
  const weightKg = parsePositiveNumber(raw.weightKg)
  if (!reps || !weightKg) return null

  const setNumber = parsePositiveNumber(raw.setNumber) || 1
  const rir = parseFiniteNumber(raw.rir)
  const dedupeKey = `${sessionDate}|${templateDayId}|${exerciseId}|${setNumber}|${reps}|${weightKg}|${rir ?? ''}`

  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : uid(),
    exerciseId,
    setNumber,
    reps,
    weightKg,
    rir,
    isWarmup: Boolean(raw.isWarmup),
    dedupeKey
  }
}

function dedupeAndNormalizeSets(sets: Array<WorkoutSetLog & { dedupeKey: string }>): WorkoutSetLog[] {
  const byId = new Map<string, WorkoutSetLog & { dedupeKey: string }>()
  const byComposite = new Set<string>()

  sets.forEach((set) => {
    if (byId.has(set.id)) return
    if (byComposite.has(set.dedupeKey)) return
    byId.set(set.id, set)
    byComposite.add(set.dedupeKey)
  })

  return normalizeSetNumbers(Array.from(byId.values()).map(({ dedupeKey, ...rest }) => rest))
}

function normalizeSession(row: unknown): WorkoutSessionLog | null {
  if (!row || typeof row !== 'object') return null

  const raw = row as Record<string, unknown>
  const date = parseDateValue(raw.date)
  const templateDayId = typeof raw.templateDayId === 'string' && raw.templateDayId ? raw.templateDayId : 'CUSTOM'
  const rawSets = Array.isArray(raw.sets) ? raw.sets : []

  const sets = dedupeAndNormalizeSets(
    rawSets
      .map((set) => normalizeSet(set, date, templateDayId))
      .filter((set): set is NonNullable<typeof set> => Boolean(set))
  )

  const now = toIso()
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : uid(),
    date,
    templateDayId,
    notes: typeof raw.notes === 'string' ? raw.notes : '',
    sets,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : now
  }
}

function normalizeDrafts(rawDrafts: unknown): Record<string, WorkoutSessionLog> {
  if (!rawDrafts || typeof rawDrafts !== 'object') return {}

  const next: Record<string, WorkoutSessionLog> = {}
  Object.entries(rawDrafts as Record<string, unknown>).forEach(([date, row]) => {
    const normalized = normalizeSession({ ...(row as object), date })
    if (!normalized) return
    next[date] = normalized
  })

  return next
}

function normalizeSessions(rows: unknown): WorkoutSessionLog[] {
  const incoming = Array.isArray(rows) ? rows : []
  const byId = new Map<string, WorkoutSessionLog>()
  const bySignature = new Set<string>()

  incoming.forEach((row) => {
    const normalized = normalizeSession(row)
    if (!normalized) return
    const signature = buildSessionSignature(normalized)

    if (byId.has(normalized.id)) {
      byId.set(normalized.id, normalized)
      return
    }

    if (bySignature.has(signature)) return

    byId.set(normalized.id, normalized)
    bySignature.add(signature)
  })

  return Array.from(byId.values()).sort((a, b) => {
    if (a.date === b.date) return b.updatedAt.localeCompare(a.updatedAt)
    return b.date.localeCompare(a.date)
  })
}

function inferTemplateDayFromLegacyLog(log: LegacyDailyLog): string {
  if (log.dayType === 'nogym') return 'CUSTOM'
  return 'A'
}

function migrateLegacyLogToSession(log: LegacyDailyLog): WorkoutSessionLog {
  const date = parseDateValue(log.date)
  const templateDayId = inferTemplateDayFromLegacyLog(log)
  const now = toIso()

  const flatSets = (log.workout ?? []).flatMap((session) => session.sets ?? [])
  const perExerciseCounter = new Map<string, number>()
  const generated: Array<WorkoutSetLog & { dedupeKey: string }> = []

  flatSets.forEach((legacySet) => {
    const exerciseId = legacySet.exerciseId || legacySet.exercise || ''
    if (!exerciseId) return

    const reps = parsePositiveNumber(legacySet.reps)
    const weightKg = parsePositiveNumber(legacySet.weightKg)
    if (!reps || !weightKg) return

    const setCount = Math.max(1, Math.round(parsePositiveNumber(legacySet.sets) ?? 1))
    for (let index = 0; index < setCount; index += 1) {
      const setNumber = (perExerciseCounter.get(exerciseId) ?? 0) + 1
      perExerciseCounter.set(exerciseId, setNumber)

      const rir = parseFiniteNumber(legacySet.rir)
      const dedupeKey = `${date}|${templateDayId}|${exerciseId}|${setNumber}|${reps}|${weightKg}|${rir ?? ''}`

      generated.push({
        id: uid(),
        exerciseId,
        setNumber,
        reps,
        weightKg,
        rir,
        isWarmup: false,
        dedupeKey
      })
    }
  })

  return {
    id: log.id || uid(),
    date,
    templateDayId,
    notes: log.note || '',
    sets: dedupeAndNormalizeSets(generated),
    createdAt: now,
    updatedAt: now
  }
}

function migrateLegacyState(raw: LegacyState): AppState {
  const exerciseCatalog = normalizeExerciseCatalog(raw.exerciseCatalog)
  const sessions = normalizeSessions((raw.logs ?? []).map((log) => migrateLegacyLogToSession(log)))

  const draftByDate: Record<string, WorkoutSessionLog> = {}
  Object.entries(raw.draftByDate ?? {}).forEach(([date, log]) => {
    draftByDate[date] = migrateLegacyLogToSession({ ...log, date })
  })

  return {
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : toIso(),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : toIso(),
    version: STORAGE_VERSION,
    sessions,
    measurements: normalizeMeasurements(raw.measurements),
    objectives: DEFAULT_OBJECTIVES.map((objective) => ({ ...objective })),
    trainingTemplates: normalizeTrainingTemplates(undefined, exerciseCatalog),
    exerciseCatalog,
    settings: {
      notificationsEnabled: Boolean(raw.settings?.notificationsEnabled),
      sheetsSync: normalizeSheetsSyncSettings(raw.settings?.sheetsSync)
    },
    draftByDate,
    meta: normalizeMeta(raw.meta)
  }
}

function isLegacyState(input: unknown): input is LegacyState {
  if (!input || typeof input !== 'object') return false
  const raw = input as Record<string, unknown>
  return Array.isArray(raw.logs)
}

function isV6State(input: unknown): input is Partial<AppState> {
  if (!input || typeof input !== 'object') return false
  const raw = input as Record<string, unknown>
  return Array.isArray(raw.sessions)
}

function backupLegacySnapshot(input: unknown): void {
  if (typeof localStorage === 'undefined' || !isStorageAvailable(localStorage)) return

  try {
    const key = `${LEGACY_BACKUP_PREFIX}${Date.now()}`
    localStorage.setItem(key, JSON.stringify(input))
  } catch {
    // Ignore backup errors to keep the app operational.
  }
}

function normalizeV6State(input: Partial<AppState> | null): AppState {
  const exerciseCatalog = normalizeExerciseCatalog(input?.exerciseCatalog)

  return {
    createdAt: typeof input?.createdAt === 'string' ? input.createdAt : toIso(),
    updatedAt: typeof input?.updatedAt === 'string' ? input.updatedAt : toIso(),
    version: STORAGE_VERSION,
    sessions: normalizeSessions(input?.sessions),
    measurements: normalizeMeasurements(input?.measurements),
    objectives: normalizeObjectives(input?.objectives),
    trainingTemplates: normalizeTrainingTemplates(input?.trainingTemplates, exerciseCatalog),
    exerciseCatalog,
    settings: {
      notificationsEnabled: Boolean(input?.settings?.notificationsEnabled),
      sheetsSync: normalizeSheetsSyncSettings(input?.settings?.sheetsSync)
    },
    draftByDate: normalizeDrafts(input?.draftByDate),
    meta: normalizeMeta(input?.meta)
  }
}

function safeParseJSON(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function normalizeUnknownState(input: unknown, createLegacyBackup = false): AppState {
  if (isV6State(input)) {
    return normalizeV6State(input)
  }

  if (isLegacyState(input)) {
    if (createLegacyBackup) {
      backupLegacySnapshot(input)
    }
    return migrateLegacyState(input)
  }

  return getDefaultState()
}

function wrapRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

const hasIdb = () => typeof indexedDB !== 'undefined'

function loadFromLocalStorage(): AppState {
  if (typeof localStorage === 'undefined' || !isStorageAvailable(localStorage)) {
    return getDefaultState()
  }

  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return getDefaultState()

  return normalizeUnknownState(safeParseJSON(raw), true)
}

function writeToLocalStorage(state: AppState): void {
  if (typeof localStorage === 'undefined' || !isStorageAvailable(localStorage)) return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

function buildSessionSignature(session: WorkoutSessionLog): string {
  const setChunk = [...session.sets]
    .sort((a, b) => {
      if (a.exerciseId === b.exerciseId) return a.setNumber - b.setNumber
      return a.exerciseId.localeCompare(b.exerciseId)
    })
    .map((set) => `${set.exerciseId}|${set.setNumber}|${set.reps}|${set.weightKg}|${set.rir ?? ''}|${set.isWarmup ? 1 : 0}`)
    .join(';')

  return `${session.date}|${session.templateDayId}|${setChunk}|${session.notes ?? ''}`
}

export function normalizeImportedState(raw: unknown): AppState {
  if (raw && typeof raw === 'object') {
    const payload = raw as Record<string, unknown>
    if (payload.state) {
      return normalizeUnknownState(payload.state, false)
    }
  }
  return normalizeUnknownState(raw, false)
}

export function mergeAppStates(base: AppState, incoming: AppState): AppState {
  const exerciseCatalog = normalizeExerciseCatalog([...base.exerciseCatalog, ...incoming.exerciseCatalog])

  const objectiveById = new Map<string, Objective>()
  base.objectives.forEach((objective) => objectiveById.set(objective.id, objective))
  incoming.objectives.forEach((objective) => objectiveById.set(objective.id, objective))

  const templateById = new Map<string, TrainingTemplateDay>()
  base.trainingTemplates.forEach((template) => templateById.set(template.id, template))
  incoming.trainingTemplates.forEach((template) => templateById.set(template.id, template))

  const measurementByDate = new Map<string, MeasurementEntry>()
  base.measurements.forEach((entry) => measurementByDate.set(entry.date, entry))
  incoming.measurements.forEach((entry) => measurementByDate.set(entry.date, entry))

  const sessionById = new Map<string, WorkoutSessionLog>()
  const signatureToId = new Map<string, string>()

  ;[...base.sessions, ...incoming.sessions].forEach((session) => {
    const normalized = normalizeSession(session)
    if (!normalized) return

    const signature = buildSessionSignature(normalized)
    const existingBySignature = signatureToId.get(signature)

    if (sessionById.has(normalized.id)) {
      sessionById.set(normalized.id, normalized)
      signatureToId.set(signature, normalized.id)
      return
    }

    if (existingBySignature && existingBySignature !== normalized.id) {
      return
    }

    sessionById.set(normalized.id, normalized)
    signatureToId.set(signature, normalized.id)
  })

  return normalizeV6State({
    ...base,
    updatedAt: toIso(),
    sessions: Array.from(sessionById.values()),
    measurements: Array.from(measurementByDate.values()),
    objectives: Array.from(objectiveById.values()),
    trainingTemplates: Array.from(templateById.values()),
    exerciseCatalog,
    draftByDate: {
      ...base.draftByDate,
      ...incoming.draftByDate
    }
  })
}

export async function loadAppState(): Promise<AppState> {
  if (!hasIdb()) {
    return loadFromLocalStorage()
  }

  try {
    const db = await openDb()
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const result = await wrapRequest(store.get('appState'))
    db.close()

    if (!result) return getDefaultState()
    return normalizeUnknownState(result, true)
  } catch {
    return loadFromLocalStorage()
  }
}

export async function saveAppState(state: AppState): Promise<StorageSaveResult> {
  const normalized = normalizeV6State({
    ...state,
    updatedAt: toIso(),
    meta: {
      ...state.meta,
      lastSavedAt: Date.now(),
      schemaVersion: STORAGE_VERSION,
      lastSavedWithFallback: false
    }
  })
  const savedAt = normalized.meta.lastSavedAt

  if (!hasIdb()) {
    writeToLocalStorage({
      ...normalized,
      meta: {
        ...normalized.meta,
        lastSavedWithFallback: true
      }
    })
    return { usedFallback: true, savedAt, source: 'localstorage' }
  }

  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      store.put(normalized, 'appState')
      tx.oncomplete = () => {
        db.close()
        resolve()
      }
      tx.onerror = () => {
        db.close()
        reject(tx.error)
      }
      tx.onabort = () => {
        db.close()
        reject(tx.error)
      }
    })
    return { usedFallback: false, savedAt, source: 'indexeddb' }
  } catch {
    writeToLocalStorage({
      ...normalized,
      meta: {
        ...normalized.meta,
        lastSavedWithFallback: true
      }
    })
    return { usedFallback: true, savedAt, source: 'localstorage' }
  }
}

export function safeSaveDebounced(state: AppState, delay = SAVE_DEBOUNCE_MS): Promise<StorageSaveResult> {
  if (saveDebounceTimer) {
    window.clearTimeout(saveDebounceTimer)
  }

  const promise = new Promise<StorageSaveResult>((resolve, reject) => {
    pendingSaveResolvers.push({ resolve, reject })
  })

  saveDebounceTimer = window.setTimeout(() => {
    saveDebounceTimer = null
    const resolvers = [...pendingSaveResolvers]
    pendingSaveResolvers = []

    void saveAppState(state)
      .then((result) => {
        resolvers.forEach((entry) => entry.resolve(result))
      })
      .catch((error) => {
        resolvers.forEach((entry) => entry.reject(error))
      })
  }, delay)

  return promise
}

export function getDefaultState(): AppState {
  const now = toIso()
  return normalizeV6State({
    createdAt: now,
    updatedAt: now,
    version: STORAGE_VERSION,
    sessions: [],
    measurements: [],
    objectives: DEFAULT_OBJECTIVES.map((objective) => ({ ...objective })),
    trainingTemplates: DEFAULT_TRAINING_TEMPLATES.map((template) => ({
      ...template,
      exercises: [...template.exercises]
    })),
    exerciseCatalog: DEFAULT_EXERCISE_CATALOG,
    settings: {
      notificationsEnabled: false,
      sheetsSync: normalizeSheetsSyncSettings(undefined)
    },
    draftByDate: {
      [formatDateInputValue()]: createEmptySession(formatDateInputValue(), 'A')
    },
    meta: {
      lastSavedAt: Date.now(),
      schemaVersion: STORAGE_VERSION,
      deviceId: getDeviceId()
    }
  })
}
