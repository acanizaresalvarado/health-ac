export type TrainingDayType = 'gym' | 'nogym'
export type PainLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10
export type MealName = 'desayuno' | 'comida' | 'cena'
export type CoreExerciseId = 'jalon' | 'remo' | 'laterales' | 'press_inclinado'

export type ExerciseKey = CoreExerciseId

export interface ExerciseCatalogItem {
  id: string
  name: string
  isCore: boolean
  coreId?: CoreExerciseId
}

export interface FoodPreset {
  id: string
  name: string
  pPer100g: number
  fPer100g: number
  cPer100g: number
  kcalPer100g: number
}

export interface WeeklyMeasurement {
  id: string
  weekStart: string
  avgWeightKg?: number
  waistCm?: number
  avgLumbarPain?: number
  steps?: number
  sleepHours?: number
  chestCm?: number
  shouldersCm?: number
  armCm?: number
  hipsCm?: number
}

export interface AppSaveMeta {
  lastSavedAt: number
  schemaVersion: number
  deviceId?: string
  lastSavedWithFallback?: boolean
}

export interface MealItem {
  id: string
  dayId: string
  meal: MealName
  presetId?: string
  grams: number
  p: number
  f: number
  c: number
  kcal: number
  source: 'preset' | 'manual'
  notes?: string
}

export interface WorkoutSet {
  exerciseId: string
  sets: number
  reps: number
  weightKg: number
  rir?: number
  exercise?: CoreExerciseId
}

export interface WorkoutSession {
  id: string
  dayId: string
  durationMin?: number
  sets: WorkoutSet[]
}

export interface DailyLog {
  id: string
  date: string // YYYY-MM-DD
  dayType: TrainingDayType
  weightKg?: number
  waistCm?: number
  lumbarPain: PainLevel
  sleepHours?: number
  steps?: number
  note?: string
  meals: MealItem[]
  workout: WorkoutSession[]
  adherence: {
    nutritionPercent: number
    kpiFlags: string[]
  }
}

export interface WeeklyKPI {
  weekStart: string
  avgWeightKg: number
  waistCm?: number
  waistTrendCm?: number
  lumbarAvg: number
  topPain?: PainLevel
  nutritionAdherence: number
  perfImprovementIndex: number
  autoDecision?: 'none' | 'down150kcal' | 'up125kcal' | 'deload'
}

export interface AppSettings {
  notificationsEnabled: boolean
}

export interface AppState {
  createdAt: string
  updatedAt: string
  version: number
  logs: DailyLog[]
  presets: FoodPreset[]
  exerciseCatalog: ExerciseCatalogItem[]
  draftByDate: Record<string, DailyLog>
  weeklyMeasurements: WeeklyMeasurement[]
  draftByWeek: Record<string, WeeklyMeasurement>
  settings: AppSettings
  meta: AppSaveMeta
}
