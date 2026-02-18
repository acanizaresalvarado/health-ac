import { CoreExerciseId, ExerciseCatalogItem, FoodPreset, MealName, TrainingDayType } from './types'

export const CORE_EXERCISE_LABELS: Record<CoreExerciseId, string> = {
  jalon: 'Jalon al pecho',
  remo: 'Remo cable / maquina',
  laterales: 'Elevaciones laterales',
  press_inclinado: 'Press inclinado'
}

export const CORE_EXERCISE_IDS: CoreExerciseId[] = ['jalon', 'remo', 'laterales', 'press_inclinado']

export const DEFAULT_EXERCISE_CATALOG: ExerciseCatalogItem[] = [
  { id: 'jalon', name: CORE_EXERCISE_LABELS.jalon, isCore: true, coreId: 'jalon' },
  { id: 'remo', name: CORE_EXERCISE_LABELS.remo, isCore: true, coreId: 'remo' },
  { id: 'laterales', name: CORE_EXERCISE_LABELS.laterales, isCore: true, coreId: 'laterales' },
  { id: 'press_inclinado', name: CORE_EXERCISE_LABELS.press_inclinado, isCore: true, coreId: 'press_inclinado' },
  { id: 'press_pecho_maquina', name: 'Press pecho máquina', isCore: false },
  { id: 'prensa', name: 'Prensa', isCore: false },
  { id: 'pallof', name: 'Pallof press', isCore: false },
  { id: 'hip_thrust', name: 'Hip thrust', isCore: false },
  { id: 'extension_cuadriceps', name: 'Extensión cuádriceps', isCore: false },
  { id: 'face_pulls', name: 'Face pulls', isCore: false },
  { id: 'dead_bug', name: 'Dead bug', isCore: false },
  { id: 'hack_squat', name: 'Hack squat', isCore: false },
  { id: 'abductores', name: 'Abductores', isCore: false },
  { id: 'curl_femoral', name: 'Curl femoral', isCore: false },
  { id: 'rkc', name: 'RKC 20-40s', isCore: false },
  { id: 'farmer_carry', name: 'Farmer carry', isCore: false }
]

export const WORKOUT_DAY_EXERCISES = {
  A: ['press_pecho_maquina', 'remo', 'jalon', 'prensa', 'laterales', 'pallof'],
  B: ['jalon', 'remo', 'hip_thrust', 'extension_cuadriceps', 'face_pulls', 'dead_bug', 'laterales'],
  C: ['press_inclinado', 'remo', 'hack_squat', 'abductores', 'curl_femoral', 'rkc', 'farmer_carry']
} as const

export const WORKOUT_DAY_OPTIONS = {
  A: 'Día A',
  B: 'Día B',
  C: 'Día C'
} as const

export type WorkoutDay = keyof typeof WORKOUT_DAY_EXERCISES

export const DAY_TARGETS: Record<TrainingDayType, { kcal: number; p: number; f: number; c: number }> = {
  gym: { kcal: 2200, p: 150, f: 60, c: 250 },
  nogym: { kcal: 2000, p: 150, f: 70, c: 170 }
}

export const MEAL_TARGETS: Record<MealName, { p: number; f: number; c: number; kcal: number }> = {
  desayuno: { p: 45, f: 20, c: 70, kcal: 650 },
  comida: { p: 45, f: 20, c: 80, kcal: 700 },
  cena: { p: 60, f: 20, c: 100, kcal: 850 }
}

export const DEFAULT_PRESETS: FoodPreset[] = [
  {
    id: 'preset_egg',
    name: 'Huevo entero',
    pPer100g: 12.6,
    fPer100g: 10.0,
    cPer100g: 1.1,
    kcalPer100g: 143
  },
  {
    id: 'preset_chicken',
    name: 'Pechuga pollo cocida',
    pPer100g: 31.0,
    fPer100g: 3.6,
    cPer100g: 0,
    kcalPer100g: 165
  },
  {
    id: 'preset_rice',
    name: 'Arroz blanco cocido',
    pPer100g: 2.7,
    fPer100g: 0.3,
    cPer100g: 28.2,
    kcalPer100g: 130
  },
  {
    id: 'preset_oats',
    name: 'Avena',
    pPer100g: 16.9,
    fPer100g: 6.9,
    cPer100g: 66.3,
    kcalPer100g: 389
  },
  {
    id: 'preset_whey',
    name: 'Proteina whey (1 scoop)',
    pPer100g: 80,
    fPer100g: 6,
    cPer100g: 8,
    kcalPer100g: 400
  },
  {
    id: 'preset_olive_oil',
    name: 'Aceite de oliva',
    pPer100g: 0,
    fPer100g: 100,
    cPer100g: 0,
    kcalPer100g: 884
  }
]

export const REMINDER_TIMES = [
  { key: 'desayuno', label: 'Registro de desayuno', hour: 9, minute: 0, dayOfWeek: null as number | null },
  { key: 'comida', label: 'Registro de comida', hour: 14, minute: 0, dayOfWeek: null as number | null },
  { key: 'cena', label: 'Cerrar registro', hour: 22, minute: 0, dayOfWeek: null as number | null },
  { key: 'revision', label: 'Revision quincenal', hour: 20, minute: 0, dayOfWeek: 5 as number }
]
