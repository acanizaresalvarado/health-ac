import { AppState, MeasurementEntry, Objective, TrainingTemplateDay, WorkoutSessionLog, WorkoutSetLog } from '../types'
import { formatDateInputValue, inDateRange, sortByDateDesc } from './metrics'

export interface ExportMeta {
  schemaVersion: number
  generatedAt: string
  timeZone: string
  fromDate: string
  toDate: string
}

export interface AnalyticsExportPayload {
  exportMeta: ExportMeta
  sessions: WorkoutSessionLog[]
  workoutSets: Array<WorkoutSetLog & { sessionId: string; date: string; templateDayId: string }>
  measurements: MeasurementEntry[]
  objectives: Objective[]
  trainingTemplates: TrainingTemplateDay[]
}

const escapeCsv = (value: string): string => {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

const toCsv = (header: string[], rows: string[][]): string => {
  const lines = [header.join(',')]
  rows.forEach((row) => {
    lines.push(row.map(escapeCsv).join(','))
  })
  return lines.join('\n')
}

const filterSessionsByRange = (sessions: WorkoutSessionLog[], fromDate: string, toDate: string): WorkoutSessionLog[] => {
  return sessions.filter((session) => inDateRange(session.date, fromDate, toDate))
}

const filterMeasurementsByRange = (
  measurements: MeasurementEntry[],
  fromDate: string,
  toDate: string
): MeasurementEntry[] => {
  return measurements.filter((entry) => inDateRange(entry.date, fromDate, toDate))
}

export const createAnalyticsPayload = (
  state: AppState,
  fromDate: string,
  toDate: string
): AnalyticsExportPayload => {
  const sessions = sortByDateDesc(filterSessionsByRange(state.sessions, fromDate, toDate))
  const measurements = sortByDateDesc(filterMeasurementsByRange(state.measurements, fromDate, toDate))

  const workoutSets = sessions.flatMap((session) =>
    session.sets.map((set) => ({
      ...set,
      sessionId: session.id,
      date: session.date,
      templateDayId: session.templateDayId
    }))
  )

  return {
    exportMeta: {
      schemaVersion: state.version,
      generatedAt: new Date().toISOString(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      fromDate,
      toDate
    },
    sessions,
    workoutSets,
    measurements,
    objectives: state.objectives,
    trainingTemplates: state.trainingTemplates
  }
}

export const exportBackupJson = (state: AppState): { fileName: string; content: string } => {
  const payload = {
    exportMeta: {
      schemaVersion: state.version,
      generatedAt: new Date().toISOString(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    },
    state
  }

  return {
    fileName: `health-tracker-backup-${formatDateInputValue()}.json`,
    content: JSON.stringify(payload, null, 2)
  }
}

export const exportAnalyticsJson = (
  state: AppState,
  fromDate: string,
  toDate: string
): { fileName: string; content: string } => {
  const payload = createAnalyticsPayload(state, fromDate, toDate)
  return {
    fileName: `health-tracker-analytics-${fromDate}-to-${toDate}.json`,
    content: JSON.stringify(payload, null, 2)
  }
}

export const exportWorkoutSetsCsv = (state: AppState, fromDate: string, toDate: string): string => {
  const payload = createAnalyticsPayload(state, fromDate, toDate)
  const header = [
    'session_id',
    'date',
    'template_day',
    'set_id',
    'exercise_id',
    'set_number',
    'reps',
    'weight_kg',
    'rir',
    'is_warmup'
  ]

  const rows = payload.workoutSets.map((set) => [
    set.sessionId,
    set.date,
    set.templateDayId,
    set.id,
    set.exerciseId,
    String(set.setNumber),
    String(set.reps),
    String(set.weightKg),
    set.rir == null ? '' : String(set.rir),
    set.isWarmup ? '1' : '0'
  ])

  return toCsv(header, rows)
}

export const exportWorkoutSessionsCsv = (state: AppState, fromDate: string, toDate: string): string => {
  const sessions = sortByDateDesc(filterSessionsByRange(state.sessions, fromDate, toDate))
  const header = ['session_id', 'date', 'template_day', 'notes', 'sets_count', 'created_at', 'updated_at']

  const rows = sessions.map((session) => [
    session.id,
    session.date,
    session.templateDayId,
    session.notes ?? '',
    String(session.sets.length),
    session.createdAt,
    session.updatedAt
  ])

  return toCsv(header, rows)
}

export const exportMeasurementsCsv = (state: AppState, fromDate: string, toDate: string): string => {
  const measurements = sortByDateDesc(filterMeasurementsByRange(state.measurements, fromDate, toDate))
  const header = [
    'measurement_id',
    'date',
    'weight_kg',
    'waist_cm',
    'lumbar_pain',
    'steps',
    'sleep_hours',
    'chest_cm',
    'shoulders_cm',
    'arm_cm',
    'hips_cm'
  ]

  const rows = measurements.map((entry) => [
    entry.id,
    entry.date,
    entry.weightKg == null ? '' : String(entry.weightKg),
    entry.waistCm == null ? '' : String(entry.waistCm),
    entry.lumbarPain == null ? '' : String(entry.lumbarPain),
    entry.steps == null ? '' : String(entry.steps),
    entry.sleepHours == null ? '' : String(entry.sleepHours),
    entry.chestCm == null ? '' : String(entry.chestCm),
    entry.shouldersCm == null ? '' : String(entry.shouldersCm),
    entry.armCm == null ? '' : String(entry.armCm),
    entry.hipsCm == null ? '' : String(entry.hipsCm)
  ])

  return toCsv(header, rows)
}

export const downloadText = (content: string, fileName: string, mimeType = 'text/plain') => {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
}

export const defaultExportRange = (state: AppState): { fromDate: string; toDate: string } => {
  const sessionDates = state.sessions.map((session) => session.date)
  const measurementDates = state.measurements.map((entry) => entry.date)
  const allDates = [...sessionDates, ...measurementDates].sort()

  if (!allDates.length) {
    const today = formatDateInputValue()
    return { fromDate: today, toDate: today }
  }

  return {
    fromDate: allDates[0],
    toDate: allDates[allDates.length - 1]
  }
}
