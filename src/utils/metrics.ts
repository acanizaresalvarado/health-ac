import {
  AppState,
  CoreExerciseId,
  DailyLog,
  MealName,
  MeasurementEntry,
  PainLevel,
  WorkoutSession
} from '../types'
import { CORE_EXERCISE_IDS, CORE_EXERCISE_LABELS, MEAL_TARGETS } from '../constants'

export type KpiDecision = 'none' | 'down150kcal' | 'up125kcal' | 'deload'

export interface DailyTotal {
  p: number
  f: number
  c: number
  kcal: number
}

export interface KpiSummary {
  kpis7: {
    avgWeight: number
    waist: number | null
    waistTrend: number | null
    lumbar: number
    adherence: number
    weightPoints: number
    waistPoints: number
  }
  kpis14: {
    avgWeight: number
    waist: number | null
    waistTrend: number | null
    lumbar: number | null
    adherence: number
    perfIndex: number
    decision: KpiDecision
    reason: string
  }
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

export const uid = (): string => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

export const formatDateInputValue = (date = new Date()) => date.toISOString().slice(0, 10)

export const addDays = (date: Date, days: number) => {
  const out = new Date(date)
  out.setDate(out.getDate() + days)
  return out
}

export const getRange = (days: number, from = new Date()) => {
  const end = new Date(from)
  const start = addDays(end, -(days - 1))
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) }
}

export const isInRange = (date: string, start: string, end: string) => date >= start && date <= end

export const createEmptySession = (dayId: string): WorkoutSession => ({
  id: uid(),
  dayId,
  sets: []
})

export const createEmptyLog = (date: string): DailyLog => {
  const id = uid()
  return {
    id,
    date,
    dayType: 'nogym',
    lumbarPain: 0 as PainLevel,
    meals: [],
    workout: [createEmptySession(id)],
    adherence: { nutritionPercent: 0, kpiFlags: [] }
  }
}

export const getDailyTotals = (log: DailyLog): DailyTotal =>
  log.meals.reduce(
    (acc, meal) => ({
      p: acc.p + meal.p,
      f: acc.f + meal.f,
      c: acc.c + meal.c,
      kcal: acc.kcal + meal.kcal
    }),
    { p: 0, f: 0, c: 0, kcal: 0 }
  )

const getSetExerciseId = (set: { exerciseId?: string; exercise?: string }) =>
  set.exerciseId || (set.exercise ? set.exercise : '')

export const computeDayAdherence = (log: DailyLog) => {
  const mealCompleted = {
    desayuno: log.meals.some((m) => m.meal === 'desayuno'),
    comida: log.meals.some((m) => m.meal === 'comida'),
    cena: log.meals.some((m) => m.meal === 'cena')
  }

  const flags: string[] = []
  if (!mealCompleted.desayuno) flags.push('missing_desayuno')
  if (!mealCompleted.comida) flags.push('missing_comida')
  if (!mealCompleted.cena) flags.push('missing_cena')

  const mealScore = [mealCompleted.desayuno, mealCompleted.comida, mealCompleted.cena].filter(Boolean).length / 3

  return {
    nutritionPercent: clamp(Math.round(mealScore * 100), 0, 100),
    kpiFlags: flags
  }
}

const filterRange = (logs: DailyLog[], range: { start: string; end: string }) =>
  logs.filter((log) => isInRange(log.date, range.start, range.end))
const filterMeasurementRange = (rows: MeasurementEntry[], range: { start: string; end: string }) =>
  rows.filter((row) => isInRange(row.date, range.start, range.end))

const average = (values: number[]) => {
  if (!values.length) return 0
  return Number((values.reduce((acc, value) => acc + value, 0) / values.length).toFixed(2))
}

const lastNumberFor = <K extends keyof DailyLog>(rows: DailyLog[], field: K): number | null => {
  const reversed = [...rows].sort((a, b) => b.date.localeCompare(a.date))
  const row = reversed.find((item) => {
    const value = item[field]
    return typeof value === 'number'
  })
  if (!row) return null
  const value = row[field]
  return typeof value === 'number' ? value : null
}

type MeasurementNumberField = keyof Omit<MeasurementEntry, 'id' | 'date'>

const lastMeasurementNumber = (rows: MeasurementEntry[], field: MeasurementNumberField): number | null => {
  const reversed = [...rows].sort((a, b) => b.date.localeCompare(a.date))
  const row = reversed.find((item) => typeof item[field] === 'number')
  const value = row?.[field]
  return typeof value === 'number' ? value : null
}

const avgByField = <K extends keyof DailyLog>(rows: DailyLog[], field: K): number => {
  const values = rows.flatMap((row) => {
    const value = row[field]
    return typeof value === 'number' && Number.isFinite(value) ? [value] : []
  })
  return average(values)
}

const avgMeasurementByField = (rows: MeasurementEntry[], field: MeasurementNumberField): number => {
  const values = rows
    .map((row) => row[field])
    .filter((value): value is number => typeof value === 'number')
  return average(values)
}

const latestFromMeasurementOrDaily = (
  measurementRows: MeasurementEntry[],
  dailyRows: DailyLog[],
  measurementField: MeasurementNumberField,
  dailyField: keyof DailyLog
): number | null => {
  const measurementValue = lastMeasurementNumber(measurementRows, measurementField)
  if (measurementValue != null) return measurementValue

  const dailyValue = lastNumberFor(dailyRows, dailyField)
  if (dailyValue == null) return null
  return dailyValue
}

const avgFromMeasurementOrDaily = (
  measurementRows: MeasurementEntry[],
  dailyRows: DailyLog[],
  measurementField: MeasurementNumberField,
  dailyField: keyof DailyLog
): number => {
  const hasMeasurementValue = measurementRows.some((row) => {
    const value = row[measurementField]
    return typeof value === 'number' && Number.isFinite(value)
  })
  if (hasMeasurementValue) {
    return avgMeasurementByField(measurementRows, measurementField)
  }

  return avgByField(dailyRows, dailyField)
}

const lumbarAvg = (rows: DailyLog[]) => average(rows.map((row) => row.lumbarPain))

const latestMeasurementPainAverage = (rows: MeasurementEntry[]) => {
  const values = rows
    .map((row) => row.lumbarPain)
    .filter((value): value is number => typeof value === 'number')
  if (!values.length) return null
  return average(values)
}

const hasConsecutivePainSpike = (rows: DailyLog[], threshold = 7, minStreak = 3) => {
  const ordered = [...rows].sort((a, b) => a.date.localeCompare(b.date))
  if (!ordered.length) return false

  const isNextDay = (a: string, b: string) => {
    const previous = new Date(a)
    previous.setDate(previous.getDate() + 1)
    return previous.toISOString().slice(0, 10) === b
  }

  let run = 0
  let lastDate: string | null = null

  for (const row of ordered) {
    if (row.lumbarPain >= threshold) {
      if (lastDate && isNextDay(lastDate, row.date)) {
        run += 1
      } else {
        run = 1
      }
      if (run >= minStreak) return true
    } else {
      run = 0
    }
    lastDate = row.date
  }

  return false
}

const getExerciseBest = (rows: DailyLog[], exercise: CoreExerciseId) => {
  const groupedByDate = new Map<string, number>()
  rows.forEach((log) => {
    const day = log.date
    const best = log.workout
      .flatMap((session) => session.sets)
      .filter((set) => getSetExerciseId(set) === exercise)
      .reduce((acc, set) => {
        const load = set.sets * set.reps * set.weightKg
        return Math.max(acc, load)
      }, 0)

    if (best > 0) {
      groupedByDate.set(day, Math.max(groupedByDate.get(day) ?? 0, best))
    }
  })

  return average(Array.from(groupedByDate.values()))
}

const performanceIndex = (state: AppState, fromDate = new Date()) => {
  const currentWindow = filterRange(state.logs, getRange(7, fromDate))
  const previousWindow = filterRange(state.logs, getRange(7, addDays(fromDate, -7)))

  const keys: CoreExerciseId[] = CORE_EXERCISE_IDS
  const diffs = keys.map((key) => {
    const current = getExerciseBest(currentWindow, key)
    const previous = getExerciseBest(previousWindow, key)
    if (!previous || !current) return 0
    return (current - previous) / previous
  })

  if (!diffs.length) return 0
  return Number((diffs.reduce((a, b) => a + b, 0) / diffs.length).toFixed(3))
}

const measurementHasHighPain = (rows: MeasurementEntry[], threshold = 7) =>
  rows.some((row) => row.lumbarPain != null && row.lumbarPain >= threshold)

const decide = (state: AppState, fromDate = new Date()) => {
  const this14 = filterRange(state.logs, getRange(14, fromDate))
  const prev14 = filterRange(state.logs, getRange(14, addDays(fromDate, -14)))
  const this14Measurements = filterMeasurementRange(state.measurements ?? [], getRange(14, fromDate))
  const prev14Measurements = filterMeasurementRange(state.measurements ?? [], getRange(14, addDays(fromDate, -14)))

  const hasHighPain = measurementHasHighPain(this14Measurements) || hasConsecutivePainSpike(this14)
  if (hasHighPain) {
    return {
      decision: 'deload' as KpiDecision,
      reason:
        'Dolor lumbar alto (semanal o diario). Aplicar deload 30-40% de volumen 1 semana y sustituciones seguras.'
    }
  }

  const thisWaist = latestFromMeasurementOrDaily(this14Measurements, this14, 'waistCm', 'waistCm')
  const prevWaist = latestFromMeasurementOrDaily(prev14Measurements, prev14, 'waistCm', 'waistCm')
  const thisWeight = avgFromMeasurementOrDaily(this14Measurements, this14, 'weightKg', 'weightKg')
  const prevWeight = avgFromMeasurementOrDaily(prev14Measurements, prev14, 'weightKg', 'weightKg')
  const adherence = this14.length
    ? Math.round(this14.reduce((sum, log) => sum + computeDayAdherence(log).nutritionPercent, 0) / this14.length)
    : 0

  const waistNotDown = thisWaist != null && prevWaist != null ? thisWaist >= prevWaist : false
  const weightNotDown = thisWeight && prevWeight ? thisWeight >= prevWeight : false
  const perf = performanceIndex(state, fromDate)

  if (waistNotDown && weightNotDown && adherence >= 80) {
    return {
      decision: 'down150kcal' as KpiDecision,
      reason: 'No baja cintura ni peso, adherencia >=80. Sugerencia: -150 kcal o +2000 pasos por dia.'
    }
  }

  const weightDrop = prevWeight ? prevWeight - thisWeight : 0
  if (weightDrop > 0.6 || perf < -0.05) {
    return {
      decision: 'up125kcal' as KpiDecision,
      reason:
        'Pérdida de >0.6kg/semana o descenso de rendimiento. Sugerencia: +100/125 kcal en días de gimnasio.'
    }
  }

  return {
    decision: 'none' as KpiDecision,
    reason: 'Sin ajuste automatico en esta quincena.'
  }
}

export const calculateKpis = (state: AppState, fromDate = new Date()): KpiSummary => {
  const rows7 = filterRange(state.logs, getRange(7, fromDate))
  const rows14 = filterRange(state.logs, getRange(14, fromDate))
  const prev7 = filterRange(state.logs, getRange(7, addDays(fromDate, -7)))
  const prev14 = filterRange(state.logs, getRange(14, addDays(fromDate, -14)))

  const measurements7 = filterMeasurementRange(state.measurements ?? [], getRange(7, fromDate))
  const measurements14 = filterMeasurementRange(state.measurements ?? [], getRange(14, fromDate))
  const prevMeasurements7 = filterMeasurementRange(state.measurements ?? [], getRange(7, addDays(fromDate, -7)))
  const prevMeasurements14 = filterMeasurementRange(state.measurements ?? [], getRange(14, addDays(fromDate, -14)))

  const waist7 = latestFromMeasurementOrDaily(measurements7, rows7, 'waistCm', 'waistCm')
  const waist14 = latestFromMeasurementOrDaily(measurements14, rows14, 'waistCm', 'waistCm')
  const waist7Prev = latestFromMeasurementOrDaily(prevMeasurements7, prev7, 'waistCm', 'waistCm')
  const waist14Prev = latestFromMeasurementOrDaily(prevMeasurements14, prev14, 'waistCm', 'waistCm')

  const weightPoints =
    (measurements7.filter((row) => typeof row.weightKg === 'number').length ?? 0) +
    rows7.filter((row) => typeof row.weightKg === 'number').length
  const waistPoints =
    (measurements7.filter((row) => typeof row.waistCm === 'number').length ?? 0) +
    rows7.filter((row) => typeof row.waistCm === 'number').length

  return {
    kpis7: {
      avgWeight: avgFromMeasurementOrDaily(measurements7, rows7, 'weightKg', 'weightKg'),
      waist: waist7,
      waistTrend: waist7 != null && waist7Prev != null ? Number((waist7 - waist7Prev).toFixed(2)) : null,
      lumbar: (() => {
        const pain = latestMeasurementPainAverage(measurements7)
        if (pain != null) return pain
        return rows7.length ? lumbarAvg(rows7) : 0
      })(),
      adherence: rows7.length
        ? Math.round(rows7.reduce((sum, log) => sum + computeDayAdherence(log).nutritionPercent, 0) / rows7.length)
        : 0,
      weightPoints,
      waistPoints
    },
    kpis14: {
      avgWeight: avgFromMeasurementOrDaily(measurements14, rows14, 'weightKg', 'weightKg'),
      waist: waist14,
      waistTrend: waist14 != null && waist14Prev != null ? Number((waist14 - waist14Prev).toFixed(2)) : null,
      lumbar: (() => {
        const pain = latestMeasurementPainAverage(measurements14)
        if (pain != null) return pain
        return rows14.length ? lumbarAvg(rows14) : 0
      })(),
      adherence: rows14.length
        ? Math.round(rows14.reduce((sum, log) => sum + computeDayAdherence(log).nutritionPercent, 0) / rows14.length)
        : 0,
      perfIndex: performanceIndex(state, fromDate),
      ...decide(state, fromDate)
    }
  }
}

const escapeValue = (value: string) => {
  if (value == null) return ''
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

export const toCsv = (
  rows: AppState['logs'],
  start = getRange(7).start,
  end = getRange(7).end,
  measurements: AppState['measurements'] = []
) => {
  const selected = rows.filter((row) => isInRange(row.date, start, end))
  const measurementMap = new Map(measurements.map((row) => [row.date, row]))
  const header = [
    'fecha',
    'tipo_dia',
    'pesoKg',
    'cinturaCm',
    'dolor_lumbar',
    'sueño_h',
    'pasos',
    'peso_medida_kg',
    'cintura_medida_cm',
    'dolor_lumbar_medida',
    'sueño_medida_h',
    'pasos_medida',
    'pecho_cm',
    'hombros_cm',
    'brazo_cm',
    'cadera_cm',
    'comida',
    'gramos',
    'proteinas',
    'grasas',
    'carbos',
    'kcal',
    'ejercicio',
    'sets',
    'reps',
    'kg',
    'rir'
  ]

  const lines = [header.join(',')]
  selected.forEach((log) => {
      const meals = log.meals.length
      ? log.meals
      : [
          {
            id: `empty-${log.id}`,
            dayId: log.id,
            meal: 'desayuno',
            grams: 0,
            p: 0,
            f: 0,
            c: 0,
            kcal: 0,
            source: 'manual'
          }
        ]
    const sets = log.workout.flatMap((session) => session.sets)
    const rowsInDay = Math.max(meals.length, sets.length, 1)
    const measurement = measurementMap.get(log.date)

    for (let i = 0; i < rowsInDay; i += 1) {
      const meal = meals[i]
      const set = sets[i]
      const row = [
        log.date,
        log.dayType,
        log.weightKg ? String(log.weightKg) : '',
        log.waistCm ? String(log.waistCm) : '',
        String(log.lumbarPain),
        log.sleepHours ? String(log.sleepHours) : '',
        log.steps ? String(log.steps) : '',
        measurement?.weightKg != null ? String(measurement.weightKg) : '',
        measurement?.waistCm != null ? String(measurement.waistCm) : '',
        measurement?.lumbarPain != null ? String(measurement.lumbarPain) : '',
        measurement?.sleepHours != null ? String(measurement.sleepHours) : '',
        measurement?.steps != null ? String(measurement.steps) : '',
        measurement?.chestCm != null ? String(measurement.chestCm) : '',
        measurement?.shouldersCm != null ? String(measurement.shouldersCm) : '',
        measurement?.armCm != null ? String(measurement.armCm) : '',
        measurement?.hipsCm != null ? String(measurement.hipsCm) : '',
        meal ? `${meal.meal}: ${meal.notes || ''}` : '',
        meal && meal.grams ? String(meal.grams) : '',
        meal && meal.p ? String(meal.p) : '',
        meal && meal.f ? String(meal.f) : '',
        meal && meal.c ? String(meal.c) : '',
        meal && meal.kcal ? String(meal.kcal) : '',
        set ? getSetExerciseId(set) : '',
        set ? String(set.sets) : '',
        set ? String(set.reps) : '',
        set ? String(set.weightKg) : '',
        set && set.rir != null ? String(set.rir) : ''
      ].map(escapeValue)
      lines.push(row.join(','))
    }
  })

  return lines.join('\n')
}

export const exerciseLabel = (key: string) => (key ? CORE_EXERCISE_LABELS[key as CoreExerciseId] ?? key : '')

export const mealTargetFor = (dayType: 'gym' | 'nogym', meal: MealName) => {
  if (dayType === 'gym') {
    return MEAL_TARGETS[meal]
  }

  if (meal === 'desayuno') {
    return { p: 50, f: 25, c: 50, kcal: 650 }
  }
  if (meal === 'comida') {
    return { p: 50, f: 25, c: 60, kcal: 750 }
  }
  return { p: 50, f: 20, c: 60, kcal: 600 }
}
