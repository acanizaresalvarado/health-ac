import {
  AppSettings,
  AppSaveMeta,
  AppState,
  DailyLog,
  ExerciseCatalogItem,
  FoodPreset,
  WeeklyMeasurement
} from '../types'
import { formatDateInputValue } from './metrics'

type WeekExportResult = {
  fileName: string
  content: string
  weekStart: string
  weekEnd: string
  payload: {
    exportMeta: {
      appVersion: string
      generatedAt: string
      weekStart: string
      weekEnd: string
      timeZone: string
      schemaVersion: number
    }
    logs: DailyLog[]
    weeklyMeasurements: WeeklyMeasurement[]
    draftByDate: Record<string, DailyLog>
    draftByWeek: Record<string, WeeklyMeasurement>
    presets: FoodPreset[]
    exerciseCatalog: ExerciseCatalogItem[]
    settings: AppSettings
    meta: AppSaveMeta
  }
}

const toWeekStart = (date: string) => {
  const base = new Date(`${date}T00:00:00`)
  const day = base.getDay()
  const diff = (day + 6) % 7
  base.setDate(base.getDate() - diff)
  return base.toISOString().slice(0, 10)
}

const toWeekEnd = (weekStart: string) => {
  const end = new Date(`${weekStart}T00:00:00`)
  end.setDate(end.getDate() + 6)
  return end.toISOString().slice(0, 10)
}

const inDateRange = (value: string, start: string, end: string) => value >= start && value <= end

const filterDrafts = <T extends { date: string }>(rows: Record<string, T>, start: string, end: string) => {
  const next: Record<string, T> = {}

  Object.entries(rows).forEach(([date, row]) => {
    if (inDateRange(date, start, end)) {
      next[date] = row
    }
  })

  return next
}

const filterWeeklyDrafts = (rows: Record<string, WeeklyMeasurement>, weekStart: string, weekEnd: string) => {
  const next: Record<string, WeeklyMeasurement> = {}

  Object.entries(rows).forEach(([date, row]) => {
    if (inDateRange(date, weekStart, weekEnd)) {
      next[date] = row
    }
  })

  return next
}

export const getWeekBounds = (referenceDate = formatDateInputValue()) => {
  const weekStart = toWeekStart(referenceDate)
  const weekEnd = toWeekEnd(weekStart)
  return { weekStart, weekEnd }
}

export const exportWeeklyJson = (state: AppState, referenceDate = formatDateInputValue()): WeekExportResult => {
  const { weekStart, weekEnd } = getWeekBounds(referenceDate)
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

  const weeklyLogs = state.logs.filter((log) => inDateRange(log.date, weekStart, weekEnd))
  const weeklyDrafts = filterDrafts(state.draftByDate || {}, weekStart, weekEnd)

  const weekMeasurements = state.weeklyMeasurements.filter((row) => inDateRange(row.weekStart, weekStart, weekEnd))
  const weekDrafts = filterWeeklyDrafts(state.draftByWeek || {}, weekStart, weekEnd)

  const payload = {
    exportMeta: {
      appVersion: 'health-tracker-pwa-v1.1',
      generatedAt: new Date().toISOString(),
      weekStart,
      weekEnd,
      timeZone,
      schemaVersion: state.version
    },
    logs: weeklyLogs,
    weeklyMeasurements: weekMeasurements,
    draftByDate: weeklyDrafts,
    draftByWeek: weekDrafts,
    presets: state.presets,
    exerciseCatalog: state.exerciseCatalog,
    settings: state.settings,
    meta: state.meta
  }

  return {
    weekStart,
    weekEnd,
    fileName: `health-tracker-semana-${weekStart}.json`,
    content: JSON.stringify(payload, null, 2),
    payload
  }
}

export const downloadJson = (content: string, fileName: string) => {
  const blob = new Blob([content], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
}
