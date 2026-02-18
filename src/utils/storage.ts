import { AppState, AppSaveMeta, DailyLog, ExerciseCatalogItem, FoodPreset, WeeklyMeasurement } from '../types'
import { DEFAULT_EXERCISE_CATALOG, DEFAULT_PRESETS } from '../constants'

const STORAGE_KEY = 'health-tracker-state-v1'
const DB_NAME = 'health-tracker-db'
const STORE_NAME = 'state'
const STORAGE_VERSION = 4

const SAVE_DEBOUNCE_MS = 500
const DEVICE_ID_KEY = 'health-tracker-device-id'
const DEFAULT_DEVICE_ID = (() => {
  if (typeof globalThis === 'undefined' || typeof (globalThis as typeof globalThis & { navigator?: { userAgent?: string } }).navigator === 'undefined') {
    return `device-${Date.now().toString(36)}`
  }

  const userAgent = (globalThis as typeof globalThis & { navigator: { userAgent?: string } }).navigator.userAgent
  return `${userAgent || 'device'}-${Date.now().toString(36)}`
})()

type StorageSaveResult = {
  usedFallback: boolean
  savedAt: number
  source: 'indexeddb' | 'localstorage'
}

export type { StorageSaveResult }

let saveDebounceTimer: ReturnType<typeof setTimeout> | null = null
let pendingSaveResolvers: Array<{ resolve: (value: StorageSaveResult) => void; reject: (reason?: unknown) => void }> = []

const toStringDate = () => new Date().toISOString()

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

function getDeviceId(): string {
  if (typeof localStorage === 'undefined' || !isStorageAvailable(localStorage)) {
    return DEFAULT_DEVICE_ID
  }

  const existing = localStorage.getItem(DEVICE_ID_KEY)
  if (existing) return existing

  const generated = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  localStorage.setItem(DEVICE_ID_KEY, generated)
  return generated
}

function normalizeMeta(rawMeta: Partial<AppSaveMeta> | undefined): AppSaveMeta {
  return {
    lastSavedAt:
      typeof rawMeta?.lastSavedAt === 'number' && Number.isFinite(rawMeta.lastSavedAt)
        ? rawMeta.lastSavedAt
        : Date.now(),
    schemaVersion: STORAGE_VERSION,
    deviceId: rawMeta?.deviceId || getDeviceId(),
    lastSavedWithFallback: rawMeta?.lastSavedWithFallback
  }
}

function normalizeDate(rawDate: unknown): string {
  if (typeof rawDate === 'string' && !Number.isNaN(Date.parse(rawDate))) {
    return rawDate
  }
  return toStringDate()
}

function safeParseJSON(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function normalizeState(input: Partial<AppState> | null): AppState {
  const logs = Array.isArray(input?.logs) ? input.logs : []
  const presets = Array.isArray(input?.presets) && input?.presets.length ? input.presets : DEFAULT_PRESETS
  const rawCatalog = Array.isArray(input?.exerciseCatalog) ? input.exerciseCatalog : []
  const rawDrafts = input?.draftByDate
  const rawWeekly: WeeklyMeasurement[] = Array.isArray(input?.weeklyMeasurements) ? input.weeklyMeasurements : []
  const rawDraftByWeek = input?.draftByWeek

  return {
    createdAt: normalizeDate(input?.createdAt),
    updatedAt: normalizeDate(input?.updatedAt),
    version: STORAGE_VERSION,
    meta: normalizeMeta(input?.meta),
    logs,
    presets,
    exerciseCatalog: normalizeExerciseCatalog(rawCatalog),
    draftByDate: rawDrafts && typeof rawDrafts === 'object' ? { ...(rawDrafts as Record<string, DailyLog>) } : {},
    weeklyMeasurements: normalizeWeeklyMeasurements(rawWeekly),
    draftByWeek: rawDraftByWeek && typeof rawDraftByWeek === 'object' ? { ...(rawDraftByWeek as Record<string, WeeklyMeasurement>) } : {},
    settings: {
      notificationsEnabled: Boolean(input?.settings?.notificationsEnabled)
    }
  }
}

function normalizeExerciseCatalog(rawCatalog: ExerciseCatalogItem[]): ExerciseCatalogItem[] {
  const merged = [...DEFAULT_EXERCISE_CATALOG]
  const knownIds = new Set(merged.map((item) => item.id))

  rawCatalog.forEach((item) => {
    if (!item?.id || !item?.name) return
    if (!knownIds.has(item.id)) {
      merged.push({
        id: item.id,
        name: item.name,
        isCore: Boolean(item.isCore),
        coreId: item.coreId
      })
      knownIds.add(item.id)
    }
  })

  return merged
}

function normalizeWeeklyMeasurements(rawWeekly: WeeklyMeasurement[]): WeeklyMeasurement[] {
  const seen = new Set<string>()
  return rawWeekly
    .map((row) => ({
      id: row.id ?? uid(),
      weekStart: row.weekStart,
      avgWeightKg: typeof row.avgWeightKg === 'number' && Number.isFinite(row.avgWeightKg) ? row.avgWeightKg : undefined,
      waistCm: typeof row.waistCm === 'number' && Number.isFinite(row.waistCm) ? row.waistCm : undefined,
      avgLumbarPain:
        typeof row.avgLumbarPain === 'number' && Number.isFinite(row.avgLumbarPain) ? row.avgLumbarPain : undefined,
      steps: typeof row.steps === 'number' && Number.isFinite(row.steps) ? row.steps : undefined,
      sleepHours: typeof row.sleepHours === 'number' && Number.isFinite(row.sleepHours) ? row.sleepHours : undefined,
      chestCm: typeof row.chestCm === 'number' && Number.isFinite(row.chestCm) ? row.chestCm : undefined,
      shouldersCm: typeof row.shouldersCm === 'number' && Number.isFinite(row.shouldersCm) ? row.shouldersCm : undefined,
      armCm: typeof row.armCm === 'number' && Number.isFinite(row.armCm) ? row.armCm : undefined,
      hipsCm: typeof row.hipsCm === 'number' && Number.isFinite(row.hipsCm) ? row.hipsCm : undefined
    }))
    .filter((row) => row.weekStart)
    .filter((row) => {
      if (seen.has(row.weekStart)) return false
      seen.add(row.weekStart)
      return true
    })
    .sort((a, b) => b.weekStart.localeCompare(a.weekStart))
}

function uid(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
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
  if (typeof localStorage === 'undefined') return normalizeState({ presets: DEFAULT_PRESETS, logs: [] })

  if (!isStorageAvailable(localStorage)) {
    return normalizeState({ presets: DEFAULT_PRESETS, logs: [] })
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return normalizeState({ presets: DEFAULT_PRESETS, logs: [] })
    }
    const parsed = safeParseJSON(raw)
    if (!parsed || typeof parsed !== 'object') {
      return normalizeState({ presets: DEFAULT_PRESETS, logs: [] })
    }
    return normalizeState(parsed as Partial<AppState>)
  } catch {
    return normalizeState({ presets: DEFAULT_PRESETS, logs: [] })
  }
}

function writeToLocalStorage(state: AppState): void {
  if (typeof localStorage === 'undefined' || !isStorageAvailable(localStorage)) {
    return
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

export function sanitizePresetId(presetId: string | undefined, presets: FoodPreset[]): string {
  const exists = presets.some((preset) => preset.id === presetId)
  return exists ? presetId! : presets[0]?.id
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
    if (!result) return normalizeState({ presets: DEFAULT_PRESETS, logs: [] })
    return normalizeState(result as Partial<AppState>)
  } catch {
    return loadFromLocalStorage()
  }
}

export async function saveAppState(state: AppState): Promise<StorageSaveResult> {
  const normalized = normalizeState({
    ...state,
    updatedAt: toStringDate(),
    meta: {
      ...state.meta,
      lastSavedAt: Date.now(),
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
  return normalizeState({
    createdAt: toStringDate(),
    updatedAt: toStringDate(),
    version: STORAGE_VERSION,
    logs: [],
    presets: DEFAULT_PRESETS,
    exerciseCatalog: DEFAULT_EXERCISE_CATALOG,
    draftByDate: {},
    weeklyMeasurements: [],
    draftByWeek: {},
    settings: { notificationsEnabled: false },
    meta: {
      lastSavedAt: Date.now(),
      schemaVersion: STORAGE_VERSION,
      deviceId: getDeviceId()
    }
  })
}
