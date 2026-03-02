import {
  CoreExerciseId,
  ExerciseCatalogItem,
  Objective,
  TrainingTemplateDay
} from './types'

export const CORE_EXERCISE_LABELS: Record<CoreExerciseId, string> = {
  jalon: 'Jalon al pecho',
  remo: 'Remo cable o maquina',
  laterales: 'Elevaciones laterales',
  press_inclinado: 'Press inclinado'
}

export const CORE_EXERCISE_IDS: CoreExerciseId[] = ['jalon', 'remo', 'laterales', 'press_inclinado']

export const DEFAULT_EXERCISE_CATALOG: ExerciseCatalogItem[] = [
  { id: 'jalon', name: CORE_EXERCISE_LABELS.jalon, isCore: true, coreId: 'jalon' },
  { id: 'remo', name: CORE_EXERCISE_LABELS.remo, isCore: true, coreId: 'remo' },
  { id: 'laterales', name: CORE_EXERCISE_LABELS.laterales, isCore: true, coreId: 'laterales' },
  { id: 'press_inclinado', name: CORE_EXERCISE_LABELS.press_inclinado, isCore: true, coreId: 'press_inclinado' },
  { id: 'press_pecho_maquina', name: 'Press pecho maquina', isCore: false },
  { id: 'prensa', name: 'Prensa', isCore: false },
  { id: 'pallof', name: 'Pallof press', isCore: false },
  { id: 'hip_thrust', name: 'Hip thrust', isCore: false },
  { id: 'extension_cuadriceps', name: 'Extension cuadriceps', isCore: false },
  { id: 'face_pulls', name: 'Face pulls', isCore: false },
  { id: 'dead_bug', name: 'Dead bug', isCore: false },
  { id: 'hack_squat', name: 'Hack squat', isCore: false },
  { id: 'abductores', name: 'Abductores', isCore: false },
  { id: 'curl_femoral', name: 'Curl femoral', isCore: false },
  { id: 'rkc', name: 'RKC 20-40s', isCore: false },
  { id: 'farmer_carry', name: 'Farmer carry', isCore: false }
]

const templateExercise = (
  exerciseId: string,
  name: string,
  order: number,
  targetSets?: number,
  repRange?: string,
  rirRange?: string,
  notes?: string
) => ({
  exerciseId,
  name,
  order,
  targetSets,
  repRange,
  rirRange,
  notes
})

export const DEFAULT_TRAINING_TEMPLATES: TrainingTemplateDay[] = [
  {
    id: 'A',
    label: 'Dia A',
    exercises: [
      templateExercise('press_pecho_maquina', 'Press pecho maquina', 1, 3, '6-10', '1-3'),
      templateExercise('remo', CORE_EXERCISE_LABELS.remo, 2, 4, '8-12', '1-3'),
      templateExercise('jalon', CORE_EXERCISE_LABELS.jalon, 3, 3, '8-12', '1-3'),
      templateExercise('prensa', 'Prensa', 4, 3, '8-12', '1-3'),
      templateExercise('laterales', CORE_EXERCISE_LABELS.laterales, 5, 4, '12-20', '0-2'),
      templateExercise('pallof', 'Pallof press', 6, 3, '10-12', '2-3')
    ]
  },
  {
    id: 'B',
    label: 'Dia B',
    exercises: [
      templateExercise('jalon', CORE_EXERCISE_LABELS.jalon, 1, 4, '8-12', '1-3'),
      templateExercise('remo', CORE_EXERCISE_LABELS.remo, 2, 3, '8-12', '1-3'),
      templateExercise('hip_thrust', 'Hip thrust', 3, 4, '8-12', '1-3'),
      templateExercise('extension_cuadriceps', 'Extension cuadriceps', 4, 3, '12-15', '1-2'),
      templateExercise('face_pulls', 'Face pulls', 5, 3, '12-15', '1-2'),
      templateExercise('dead_bug', 'Dead bug', 6, 3, '8-12', '2-3'),
      templateExercise('laterales', CORE_EXERCISE_LABELS.laterales, 7, 2, '15-20', '0-2')
    ]
  },
  {
    id: 'C',
    label: 'Dia C',
    exercises: [
      templateExercise('press_inclinado', CORE_EXERCISE_LABELS.press_inclinado, 1, 3, '8-12', '1-3'),
      templateExercise('remo', CORE_EXERCISE_LABELS.remo, 2, 3, '8-12', '1-3'),
      templateExercise('hack_squat', 'Hack squat', 3, 3, '8-12', '1-3'),
      templateExercise('abductores', 'Abductores', 4, 3, '12-20', '1-2'),
      templateExercise('curl_femoral', 'Curl femoral', 5, 3, '10-12', '1-3'),
      templateExercise('rkc', 'RKC 20-40s', 6, 4, '20-40s', '2-3'),
      templateExercise('farmer_carry', 'Farmer carry', 7, 5, '40-60m', '2-3')
    ]
  },
  {
    id: 'CUSTOM',
    label: 'Dia libre',
    exercises: []
  }
]

const nowIso = () => new Date().toISOString()

export const DEFAULT_OBJECTIVES: Objective[] = [
  {
    id: 'objective_waist',
    title: 'Bajar cintura a 84-85 cm',
    metric: 'waist',
    targetValue: 85,
    unit: 'cm',
    status: 'active',
    notes: 'Prioridad visual principal de la fase actual.',
    createdAt: nowIso(),
    updatedAt: nowIso()
  },
  {
    id: 'objective_consistency',
    title: 'Minimo 3 sesiones por semana',
    metric: 'consistency',
    targetValue: 3,
    unit: 'sessions',
    status: 'active',
    notes: 'Mantener consistencia antes de aumentar volumen.',
    createdAt: nowIso(),
    updatedAt: nowIso()
  }
]

export const REMINDER_TIMES = [
  { key: 'workout', label: 'Registro de entrenamiento', hour: 20, minute: 30, dayOfWeek: null as number | null },
  { key: 'review', label: 'Revision semanal de progreso', hour: 19, minute: 0, dayOfWeek: 0 as number }
]

export const TEMPLATE_DAY_IDS: Array<TrainingTemplateDay['id']> = ['A', 'B', 'C', 'CUSTOM']
