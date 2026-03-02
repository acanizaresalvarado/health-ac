import { AppState, MeasurementEntry, WorkoutSessionLog, WorkoutSetLog } from '../types'
import { getSessionTopSet, getSessionVolume, estimateE1Rm } from './strengthMetrics'

export type DashboardMetricCard = {
  weeklySessions: number
  weeklyVolume: number
  consistency4Weeks: number
  activeObjectives: number
}

export type DashboardStrengthRow = {
  exerciseId: string
  exerciseName: string
  bestE1Rm: number
  bestWeightKg: number
  bestReps: number
}

export type DashboardTrends = {
  weight14d: number | null
  waist14d: number | null
  sessions14d: number
}

export type DashboardSummary = {
  cards: DashboardMetricCard
  trends: DashboardTrends
  topStrength: DashboardStrengthRow[]
}

const pad2 = (value: number) => String(value).padStart(2, '0')

export const uid = (): string => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

export const formatDateInputValue = (date = new Date()): string => {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

export const parseDateInputValue = (value: string): Date => {
  const [year, month, day] = value.split('-').map((part) => Number(part))
  if (!year || !month || !day) return new Date()
  return new Date(year, month - 1, day, 12, 0, 0, 0)
}

export const addDaysToDateValue = (dateValue: string, days: number): string => {
  const date = parseDateInputValue(dateValue)
  date.setDate(date.getDate() + days)
  return formatDateInputValue(date)
}

export const getRange = (days: number, fromDate = formatDateInputValue()) => {
  const end = fromDate
  const start = addDaysToDateValue(end, -(days - 1))
  return { start, end }
}

export const inDateRange = (value: string, start: string, end: string): boolean => value >= start && value <= end

export const createEmptySession = (date: string, templateDayId = 'A'): WorkoutSessionLog => {
  const now = new Date().toISOString()
  return {
    id: uid(),
    date,
    templateDayId,
    notes: '',
    sets: [],
    createdAt: now,
    updatedAt: now
  }
}

export const normalizeSetNumbers = (sets: WorkoutSetLog[]): WorkoutSetLog[] => {
  const perExerciseCount = new Map<string, number>()
  return [...sets]
    .sort((a, b) => a.setNumber - b.setNumber)
    .map((set) => {
      const current = (perExerciseCount.get(set.exerciseId) ?? 0) + 1
      perExerciseCount.set(set.exerciseId, current)
      return {
        ...set,
        setNumber: current
      }
    })
}

export const getSessionSummary = (session: WorkoutSessionLog) => {
  const workingSets = session.sets.filter((set) => !set.isWarmup)
  return {
    totalSets: workingSets.length,
    totalVolume: getSessionVolume(session),
    topSet: getSessionTopSet(session)
  }
}

const average = (values: number[]): number => {
  if (!values.length) return 0
  const total = values.reduce((sum, value) => sum + value, 0)
  return Number((total / values.length).toFixed(2))
}

const averageMeasurement = (rows: MeasurementEntry[], field: keyof Omit<MeasurementEntry, 'id' | 'date'>): number | null => {
  const values = rows
    .map((row) => row[field])
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))

  if (!values.length) return null
  return average(values)
}

const bestStrengthByExercise = (state: AppState): DashboardStrengthRow[] => {
  return state.exerciseCatalog
    .map((exercise) => {
      let bestE1Rm = 0
      let bestWeightKg = 0
      let bestReps = 0

      state.sessions.forEach((session) => {
        session.sets.forEach((set) => {
          if (set.exerciseId !== exercise.id || set.isWarmup) return
          const e1rm = estimateE1Rm(set.weightKg, set.reps)
          if (e1rm > bestE1Rm) {
            bestE1Rm = e1rm
            bestWeightKg = set.weightKg
            bestReps = set.reps
          }
        })
      })

      return {
        exerciseId: exercise.id,
        exerciseName: exercise.name,
        bestE1Rm: Number(bestE1Rm.toFixed(2)),
        bestWeightKg,
        bestReps
      }
    })
    .filter((entry) => entry.bestE1Rm > 0)
    .sort((a, b) => b.bestE1Rm - a.bestE1Rm)
    .slice(0, 8)
}

export const calculateDashboardSummary = (
  state: AppState,
  referenceDate = formatDateInputValue()
): DashboardSummary => {
  const range7 = getRange(7, referenceDate)
  const range14 = getRange(14, referenceDate)
  const prev14 = getRange(14, addDaysToDateValue(referenceDate, -14))
  const range28 = getRange(28, referenceDate)

  const sessions7 = state.sessions.filter((session) => inDateRange(session.date, range7.start, range7.end))
  const sessions14 = state.sessions.filter((session) => inDateRange(session.date, range14.start, range14.end))
  const sessions28 = state.sessions.filter((session) => inDateRange(session.date, range28.start, range28.end))

  const measurements14 = state.measurements.filter((row) => inDateRange(row.date, range14.start, range14.end))
  const previousMeasurements14 = state.measurements.filter((row) => inDateRange(row.date, prev14.start, prev14.end))

  const weeklyVolume = Number(
    sessions7
      .reduce((sum, session) => sum + getSessionVolume(session), 0)
      .toFixed(2)
  )

  const weightNow = averageMeasurement(measurements14, 'weightKg')
  const weightPrev = averageMeasurement(previousMeasurements14, 'weightKg')
  const waistNow = averageMeasurement(measurements14, 'waistCm')
  const waistPrev = averageMeasurement(previousMeasurements14, 'waistCm')

  return {
    cards: {
      weeklySessions: sessions7.length,
      weeklyVolume,
      consistency4Weeks: Number((sessions28.length / 4).toFixed(2)),
      activeObjectives: state.objectives.filter((objective) => objective.status === 'active').length
    },
    trends: {
      weight14d: weightNow != null && weightPrev != null ? Number((weightNow - weightPrev).toFixed(2)) : null,
      waist14d: waistNow != null && waistPrev != null ? Number((waistNow - waistPrev).toFixed(2)) : null,
      sessions14d: sessions14.length
    },
    topStrength: bestStrengthByExercise(state)
  }
}

export const getSessionForDate = (state: AppState, date: string): WorkoutSessionLog | null => {
  if (state.draftByDate[date]) return { ...state.draftByDate[date], date }

  const existing = state.sessions
    .filter((session) => session.date === date)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]

  if (existing) return { ...existing, date }
  return null
}

export const getMeasurementForDate = (rows: MeasurementEntry[], date: string): MeasurementEntry | null => {
  const found = rows.find((row) => row.date === date)
  return found ? { ...found, date } : null
}

export const sortByDateDesc = <T extends { date: string }>(rows: T[]): T[] => {
  return [...rows].sort((a, b) => b.date.localeCompare(a.date))
}
