export type AppSchemaVersion = 6
export type SyncEntity = 'sessions' | 'sets' | 'measurements' | 'objectives' | 'templates'
export type SyncOperation = 'upsert'
export type SheetsSyncStatus = 'idle' | 'syncing' | 'success' | 'error'
export type SheetsSyncMode = 'backend_proxy' | 'direct_webhook'

export type ObjectiveMetric = 'waist' | 'weight' | 'strength' | 'consistency' | 'custom'
export type ObjectiveUnit = 'kg' | 'cm' | '%' | 'sessions' | 'custom'
export type ObjectiveStatus = 'active' | 'paused' | 'done'

export type CoreExerciseId = 'jalon' | 'remo' | 'laterales' | 'press_inclinado'

export interface ExerciseCatalogItem {
  id: string
  name: string
  isCore: boolean
  coreId?: CoreExerciseId
}

export interface Objective {
  id: string
  title: string
  metric: ObjectiveMetric
  targetValue?: number
  unit?: ObjectiveUnit
  deadline?: string // YYYY-MM-DD local date
  status: ObjectiveStatus
  notes?: string
  createdAt: string
  updatedAt: string
}

export interface TemplateExercise {
  exerciseId: string
  name: string
  targetSets?: number
  repRange?: string
  rirRange?: string
  notes?: string
  order: number
}

export interface TrainingTemplateDay {
  id: 'A' | 'B' | 'C' | 'CUSTOM'
  label: string
  exercises: TemplateExercise[]
}

export interface WorkoutSetLog {
  id: string
  exerciseId: string
  setNumber: number
  reps: number
  weightKg: number
  rir?: number
  isWarmup: boolean
}

export interface WorkoutSessionLog {
  id: string
  date: string // YYYY-MM-DD local date
  templateDayId: string
  notes?: string
  sets: WorkoutSetLog[]
  createdAt: string
  updatedAt: string
}

export interface MeasurementEntry {
  id: string
  date: string // YYYY-MM-DD local date
  weightKg?: number
  waistCm?: number
  lumbarPain?: number
  steps?: number
  sleepHours?: number
  chestCm?: number
  shouldersCm?: number
  armCm?: number
  hipsCm?: number
}

export interface AppSaveMeta {
  lastSavedAt: number
  schemaVersion: AppSchemaVersion
  deviceId?: string
  lastSavedWithFallback?: boolean
}

export interface SheetsSyncSettings {
  enabled: boolean
  mode: SheetsSyncMode
  endpointUrl: string
  autoSyncOnSave: boolean
  lastSyncAt?: string
  lastSyncStatus?: SheetsSyncStatus
  lastSyncError?: string
}

export interface AppSettings {
  notificationsEnabled: boolean
  sheetsSync: SheetsSyncSettings
}

export interface SyncQueueItemInput {
  entity: SyncEntity
  key: string
  op?: SyncOperation
  data: Record<string, unknown>
  updatedAt?: string
}

export interface SyncQueueItem {
  id: string
  entity: SyncEntity
  key: string
  op: SyncOperation
  data: Record<string, unknown>
  createdAt: string
  updatedAt: string
  attempts: number
  nextRetryAt: number
  lastError?: string
}

export interface SheetsSyncEnvelopeItem {
  entity: SyncEntity
  key: string
  op: SyncOperation
  updatedAt: string
  data: Record<string, unknown>
}

export interface SheetsSyncEnvelope {
  source: 'health-tracker-pwa'
  schemaVersion: AppSchemaVersion
  generatedAt: string
  deviceId?: string
  token?: string
  items: SheetsSyncEnvelopeItem[]
}

export interface AppState {
  createdAt: string
  updatedAt: string
  version: AppSchemaVersion
  sessions: WorkoutSessionLog[]
  measurements: MeasurementEntry[]
  objectives: Objective[]
  trainingTemplates: TrainingTemplateDay[]
  exerciseCatalog: ExerciseCatalogItem[]
  settings: AppSettings
  draftByDate: Record<string, WorkoutSessionLog>
  meta: AppSaveMeta
}
