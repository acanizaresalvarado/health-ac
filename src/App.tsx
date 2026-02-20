import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react'
import './styles.css'
import {
  calculateKpis,
  computeDayAdherence,
  createEmptyLog,
  createEmptySession,
  getDailyTotals,
  getRange,
  mealTargetFor,
  toCsv,
  uid,
  formatDateInputValue
} from './utils/metrics'
import {
  getDefaultState,
  loadAppState,
  safeSaveDebounced,
  StorageSaveResult
} from './utils/storage'
import { downloadJson, exportWeeklyJson } from './utils/backup'
import {
  AppState,
  CoreExerciseId,
  DailyLog,
  MealItem,
  WeeklyMeasurement,
  WorkoutSet
} from './types'
import {
  CORE_EXERCISE_IDS,
  WORKOUT_DAY_EXERCISES,
  WORKOUT_DAY_OPTIONS,
  DAY_TARGETS,
  type WorkoutDay,
  REMINDER_TIMES
} from './constants'

const TABS = ['Plan y reglas', 'Hoy', 'Historico', 'Medidas semanales', 'Exportar'] as const
type Tab = (typeof TABS)[number]
const SW_UPDATE_EVENT = 'health-tracker-sw-update'

type UpdateEventDetail = {
  registration?: ServiceWorkerRegistration
}

const TAB_ICON: Record<Tab, string> = {
  'Plan y reglas': '📋',
  Hoy: '🏠',
  Historico: '📊',
  'Medidas semanales': '📏',
  Exportar: '💾'
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'offline'

const getWorkoutSetId = (set: { exerciseId?: string; exercise?: string }) => set.exerciseId || set.exercise || ''

const toWeekStart = (date: string) => {
  const base = new Date(`${date}T00:00:00`)
  const day = base.getDay()
  const diff = (day + 6) % 7
  base.setDate(base.getDate() - diff)
  return base.toISOString().slice(0, 10)
}

const emptyWeeklyMeasurement = (weekStart: string): WeeklyMeasurement => ({
  id: '',
  weekStart,
  avgWeightKg: undefined,
  waistCm: undefined,
  avgLumbarPain: undefined,
  steps: undefined,
  sleepHours: undefined,
  chestCm: undefined,
  shouldersCm: undefined,
  armCm: undefined,
  hipsCm: undefined
})

type MealDraftState = {
  name: string
  grams: number
  p: number
  f: number
  c: number
  kcal: number
}

type MealExpandedState = Record<MealName, boolean>

type MealName = 'desayuno' | 'comida' | 'cena'

type WorkoutDraft = {
  exerciseId: string
  sets: string
  reps: string
  weightKg: string
  rir: string
}

type MealAdvancedDraft = Record<MealName, boolean>

const defaultMealDraft = (): Record<MealName, MealDraftState> => ({
  desayuno: { name: '', grams: 100, p: 0, f: 0, c: 0, kcal: 0 },
  comida: { name: '', grams: 160, p: 0, f: 0, c: 0, kcal: 0 },
  cena: { name: '', grams: 180, p: 0, f: 0, c: 0, kcal: 0 }
})

const defaultWorkoutDraft = (fallbackExerciseId: string): WorkoutDraft => ({
  exerciseId: fallbackExerciseId,
  sets: '',
  reps: '',
  weightKg: '',
  rir: ''
})

const toNumber = (value: string): number => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const toTone = (ratio: number): 'ok' | 'warn' | 'bad' => {
  if (ratio >= 0.9) return 'ok'
  if (ratio >= 0.6) return 'warn'
  return 'bad'
}

export default function App() {
  const [state, setState] = useState<AppState>(getDefaultState())
  const [loaded, setLoaded] = useState(false)
  const [activeTab, setActiveTab] = useState<Tab>('Plan y reglas')
  const [activeDate, setActiveDate] = useState(formatDateInputValue())
  const [draftLog, setDraftLog] = useState<DailyLog>(() => createEmptyLog(formatDateInputValue()))
  const [weeklyDraft, setWeeklyDraft] = useState<WeeklyMeasurement>(
    emptyWeeklyMeasurement(toWeekStart(formatDateInputValue()))
  )
  const [mealDrafts, setMealDrafts] = useState<Record<MealName, MealDraftState>>({
    ...defaultMealDraft()
  })
  const [mealExpanded, setMealExpanded] = useState<MealExpandedState>({
    desayuno: true,
    comida: true,
    cena: true
  })
  const [mealAdvanced, setMealAdvanced] = useState<MealAdvancedDraft>({
    desayuno: false,
    comida: false,
    cena: false
  })
  const [workoutDraft, setWorkoutDraft] = useState<WorkoutDraft>(defaultWorkoutDraft(CORE_EXERCISE_IDS[0]))
  const [workoutDay, setWorkoutDay] = useState<WorkoutDay>('A')
  const [customExerciseName, setCustomExerciseName] = useState('')
  const [message, setMessage] = useState('')
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const timers = useRef<number[]>([])
  const draftAutosaveTimer = useRef<number | null>(null)
  const weeklyDraftAutosaveTimer = useRef<number | null>(null)
  const saveStatusTimer = useRef<number | null>(null)
  const swUpdateRegistration = useRef<ServiceWorkerRegistration | null>(null)
  const swReloadTimer = useRef<number | null>(null)
  const draftDirtyRef = useRef(false)
  const draftSourceDateRef = useRef(formatDateInputValue())
  const [workoutHistoryExpanded, setWorkoutHistoryExpanded] = useState(false)

  const kpis = useMemo(() => calculateKpis(state, new Date(activeDate)), [state, activeDate])
  const currentDecision = kpis.kpis14.decision
  const kpiDecisionTone = currentDecision === 'deload' ? 'bad' : currentDecision === 'none' ? 'ok' : 'warn'
  const kpi14Trend = kpis.kpis14.adherence >= 80 ? 'ok' : kpis.kpis14.adherence >= 60 ? 'warn' : 'bad'
  const draftTotals = getDailyTotals(draftLog)
  const saveLabel =
    saveStatus === 'saving'
      ? 'Guardando…'
      : saveStatus === 'offline'
        ? 'Sin guardar (offline temporal)'
        : 'Guardado'

  const getDraftBaseForDate = (snapshotState: AppState, date: string): DailyLog => {
    if (snapshotState.draftByDate?.[date]) {
      const draft = snapshotState.draftByDate[date]
      return { ...draft, date }
    }
    const persisted = snapshotState.logs.find((row) => row.date === date)
    if (persisted) return { ...persisted, date }
    return createEmptyLog(date)
  }

  const getWeeklyDraftBaseForDate = (snapshotState: AppState, date: string): WeeklyMeasurement => {
    const weekStart = toWeekStart(date)
    const draft = snapshotState.draftByWeek?.[weekStart]
    if (draft) return { ...draft, weekStart }

    const persisted = snapshotState.weeklyMeasurements.find((row) => row.weekStart === weekStart)
    if (persisted) return { ...persisted }

    return emptyWeeklyMeasurement(weekStart)
  }

  const getExerciseOptionsForDay = (snapshotState: AppState, day: WorkoutDay) => {
    const planned = WORKOUT_DAY_EXERCISES[day]
    const plannedIds = new Set<string>(planned)

    const plannedItems = snapshotState.exerciseCatalog.filter((item) => plannedIds.has(item.id))
    const otherItems = snapshotState.exerciseCatalog.filter((item) => !plannedIds.has(item.id))

    return [...plannedItems, ...otherItems]
  }

  const getWorkoutDefaultExercise = (snapshotState: AppState, day: WorkoutDay, fallback = '') => {
    const options = getExerciseOptionsForDay(snapshotState, day)
    const wanted = workoutDraft.exerciseId || fallback || options[0]?.id || CORE_EXERCISE_IDS[0]
    return options.some((item) => item.id === wanted) ? wanted : options[0]?.id || CORE_EXERCISE_IDS[0]
  }

  const getExerciseName = (id: string) => {
    const item = state.exerciseCatalog.find((entry) => entry.id === id)
    return item?.name ?? id
  }

  const getCurrentWorkoutEntries = () => draftLog.workout[0]?.sets ?? []

  useEffect(() => {
    ;(async () => {
      const loadedState = await loadAppState()
      const weeklyBase = getWeeklyDraftBaseForDate(loadedState, activeDate)
      const baseline = getDraftBaseForDate(loadedState, activeDate)
      setState(loadedState)
      setMealDrafts(defaultMealDraft())
      setWeeklyDraft({ ...weeklyBase, id: weeklyBase.id || uid() })
      setDraftLog({ ...baseline, adherence: computeDayAdherence(baseline) })
      setWorkoutHistoryExpanded(Boolean(baseline.workout[0]?.sets.length))
      setWorkoutDraft((prev) => ({
        ...prev,
        exerciseId: getWorkoutDefaultExercise(loadedState, 'A', CORE_EXERCISE_IDS[0])
      }))
      draftSourceDateRef.current = activeDate
      draftDirtyRef.current = false
      setLoaded(true)
    })()
  }, [])

  useEffect(() => {
    if (!loaded) return
    if (draftSourceDateRef.current === activeDate) return

    const selected = getDraftBaseForDate(state, activeDate)
    const weeklyBase = getWeeklyDraftBaseForDate(state, activeDate)
    const currentDraft = { ...selected, adherence: computeDayAdherence(selected) }
    const hasRecordedWorkout = Boolean(currentDraft.workout[0]?.sets.length)

    setDraftLog(currentDraft)
    setWeeklyDraft(weeklyBase)
    setMealDrafts(defaultMealDraft())
    setWorkoutHistoryExpanded(hasRecordedWorkout)
    setWorkoutDraft((prev) => ({
      ...prev,
      exerciseId: getWorkoutDefaultExercise(state, workoutDay)
    }))
    draftSourceDateRef.current = activeDate
    draftDirtyRef.current = false
  }, [activeDate, state.logs, state.exerciseCatalog, state.weeklyMeasurements, state.draftByDate, state.draftByWeek, loaded, workoutDay])

  useEffect(() => {
    if (!loaded) return
    const current = { ...draftLog, date: activeDate, adherence: computeDayAdherence(draftLog) }

    if (draftAutosaveTimer.current) {
      window.clearTimeout(draftAutosaveTimer.current)
    }

    draftAutosaveTimer.current = window.setTimeout(() => {
      setState((prev) => {
        const drafts = { ...(prev.draftByDate || {}) }
        drafts[activeDate] = current
        return { ...prev, draftByDate: drafts }
      })
    }, 600)

    return () => {
      if (draftAutosaveTimer.current) {
        window.clearTimeout(draftAutosaveTimer.current)
      }
    }
  }, [draftLog, activeDate, loaded])

  useEffect(() => {
    if (!loaded) return

    const current = { ...weeklyDraft, weekStart: toWeekStart(activeDate), id: weeklyDraft.id || uid() }

    if (weeklyDraftAutosaveTimer.current) {
      window.clearTimeout(weeklyDraftAutosaveTimer.current)
    }

    weeklyDraftAutosaveTimer.current = window.setTimeout(() => {
      setState((prev) => ({
        ...prev,
        draftByWeek: {
          ...(prev.draftByWeek || {}),
          [current.weekStart]: current
        }
      }))
    }, 600)

    return () => {
      if (weeklyDraftAutosaveTimer.current) {
        window.clearTimeout(weeklyDraftAutosaveTimer.current)
      }
    }
  }, [weeklyDraft, activeDate, loaded])

  useEffect(() => {
    if (!loaded) return

    setWorkoutDraft((prev) => ({
      ...prev,
      exerciseId: getWorkoutDefaultExercise(state, workoutDay, prev.exerciseId)
    }))
  }, [workoutDay, loaded, state.exerciseCatalog])

  useEffect(() => {
    if (!loaded) return
    setSaveStatus('saving')

    if (saveStatusTimer.current) {
      window.clearTimeout(saveStatusTimer.current)
    }

    void safeSaveDebounced(state, 500)
      .then((result: StorageSaveResult) => {
        setSaveStatus(result.usedFallback ? 'offline' : 'saved')

        if (saveStatusTimer.current) {
          window.clearTimeout(saveStatusTimer.current)
        }

        saveStatusTimer.current = window.setTimeout(() => {
          setSaveStatus('idle')
        }, 1000)
      })
      .catch(() => {
        setSaveStatus('offline')
        saveStatusTimer.current = window.setTimeout(() => {
          setSaveStatus('idle')
        }, 1200)
      })
  }, [state, loaded])

  useEffect(() => {
    timers.current.forEach((timer) => window.clearTimeout(timer))
    timers.current = []

    if (!loaded || !state.settings.notificationsEnabled) return
    if (!('Notification' in window) || Notification.permission !== 'granted') return

    const now = new Date()
    const toSchedule = REMINDER_TIMES

    toSchedule.forEach((rule) => {
      const target = getNextReminder(now, rule)
      const delay = target.getTime() - now.getTime()
      if (delay <= 0) return

      const timer = window.setTimeout(() => {
        new Notification(rule.label, {
          body: rule.key === 'revision' ? 'Revisa tu decision quincenal y actualiza plan.' : 'Registra esta parte de tu dia.',
          icon: '/icon.svg',
          tag: rule.key
        })
      }, delay)
      timers.current.push(timer)
    })

    return () => {
      timers.current.forEach((timer) => window.clearTimeout(timer))
      timers.current = []
    }
  }, [loaded, state.settings.notificationsEnabled])

  useEffect(() => {
    const handleUpdate = (event: Event) => {
      const customEvent = event as CustomEvent<UpdateEventDetail>
      const registration = customEvent.detail?.registration ?? null

      if (registration) {
        swUpdateRegistration.current = registration
      }

      setUpdateAvailable(true)
      setMessage('Nueva versión disponible')
    }

    window.addEventListener(SW_UPDATE_EVENT, handleUpdate)
    return () => {
      window.removeEventListener(SW_UPDATE_EVENT, handleUpdate)
    }
  }, [])

  const applyAppUpdate = async () => {
    const registration = swUpdateRegistration.current || (await navigator.serviceWorker.getRegistration())
    const reload = () => {
      if (swReloadTimer.current) {
        window.clearTimeout(swReloadTimer.current)
      }
      window.location.reload()
    }

    setUpdateAvailable(false)
    swReloadTimer.current = window.setTimeout(reload, 1000)

    if (registration?.waiting) {
      registration.waiting.addEventListener('statechange', () => {
        if (registration.waiting?.state === 'activated') {
          reload()
        }
      })
      registration.waiting.postMessage({ type: 'SKIP_WAITING' })
      return
    }

    if (registration?.update) {
      await registration.update()
    } else {
      reload()
    }
  }

  const updateDraft = <K extends keyof DailyLog>(field: K, value: DailyLog[K]) => {
    draftDirtyRef.current = true
    setDraftLog((prev) => ({ ...prev, [field]: value }))
  }

  const updateWeeklyDraft = <K extends keyof WeeklyMeasurement>(field: K, value: WeeklyMeasurement[K]) => {
    setWeeklyDraft((prev) => ({ ...prev, [field]: value }))
  }

  const saveDraft = () => {
    const cleaned: DailyLog = {
      ...draftLog,
      date: activeDate,
      adherence: computeDayAdherence(draftLog)
    }

    setState((prev) => {
      const existing = prev.logs.some((row) => row.date === activeDate)
      const logs = existing
        ? prev.logs.map((row) => (row.date === activeDate ? cleaned : row))
        : [...prev.logs, cleaned]

      const drafts = { ...(prev.draftByDate || {}) }
      delete drafts[activeDate]

      return {
        ...prev,
        logs,
        draftByDate: drafts
      }
    })
    draftDirtyRef.current = false
    setMessage('Registro guardado')
  }

  const saveWeekly = () => {
    setState((prev) => {
      const weekStart = toWeekStart(activeDate)
      const records = prev.weeklyMeasurements.some((row) => row.weekStart === weekStart)
      const entry = { ...weeklyDraft, weekStart, id: weeklyDraft.id || uid() }
      const weeklyMeasurements = records
        ? prev.weeklyMeasurements.map((row) => (row.weekStart === weekStart ? entry : row))
        : [...prev.weeklyMeasurements, entry]

      const draftByWeek = { ...(prev.draftByWeek || {}) }
      delete draftByWeek[weekStart]

      return { ...prev, weeklyMeasurements, draftByWeek }
    })
    setMessage('Medidas semanales guardadas')
  }

  const updateMealDraft = (meal: MealName, updates: Partial<MealDraftState>) => {
    setMealDrafts((prev) => ({
      ...prev,
      [meal]: {
        ...prev[meal],
        ...updates
      }
    }))
  }

  const toggleMealAdvanced = (meal: MealName) => {
    setMealAdvanced((prev) => ({
      ...prev,
      [meal]: !prev[meal]
    }))
  }

  const addMeal = (meal: MealName) => {
    const draft = mealDrafts[meal]
    const grams = Number(draft.grams)
    const foodName = draft.name.trim()

    if (!grams || grams <= 0) {
      setMessage('Indica gramos antes de guardar comida')
      return
    }

    if (!foodName) {
      setMessage('Añade nombre de comida')
      return
    }

    const itemData = {
      p: Number(draft.p),
      f: Number(draft.f),
      c: Number(draft.c),
      kcal: Number(draft.kcal)
    }

    const newEntry: MealItem = {
      id: uid(),
      dayId: draftLog.id,
      meal,
      presetId: undefined,
      grams,
      p: itemData.p,
      f: itemData.f,
      c: itemData.c,
      kcal: itemData.kcal,
      source: 'manual',
      notes: foodName
    }

    draftDirtyRef.current = true
    setDraftLog((prev) => ({ ...prev, meals: [...prev.meals, newEntry] }))
    setMealDrafts((prev) => ({
      ...prev,
      [meal]: {
        ...prev[meal],
        name: '',
        grams: meal === 'desayuno' ? 100 : meal === 'comida' ? 160 : 180,
        p: 0,
        f: 0,
        c: 0,
        kcal: 0
      }
    }))
    setMessage('Comida añadida')
  }

  const removeMeal = (id: string) => {
    draftDirtyRef.current = true
    setDraftLog((prev) => ({ ...prev, meals: prev.meals.filter((entry) => entry.id !== id) }))
  }

  const upsertWorkoutSet = (setData: WorkoutSet) => {
    draftDirtyRef.current = true
    setDraftLog((prev) => {
      const baseSession = prev.workout[0] ?? createEmptySession(prev.id)
      const index = baseSession.sets.findIndex((entry) => getWorkoutSetId(entry) === setData.exerciseId)
      const sanitized: WorkoutSet = {
        exerciseId: setData.exerciseId,
        sets: setData.sets,
        reps: setData.reps,
        weightKg: setData.weightKg,
        rir: setData.rir
      }

      const nextSets = index >= 0
        ? baseSession.sets.map((entry, entryIndex) => (entryIndex === index ? { ...entry, ...sanitized } : entry))
        : [...baseSession.sets, sanitized]

      return {
        ...prev,
        workout: [{ ...baseSession, sets: nextSets }, ...prev.workout.slice(1)]
      }
    })
  }

  const addOrUpdateWorkout = () => {
    const exId = workoutDraft.exerciseId
    if (!exId) {
      setMessage('Selecciona un ejercicio')
      return
    }

    const sets = toNumber(workoutDraft.sets)
    const reps = toNumber(workoutDraft.reps)
    const weightKg = toNumber(workoutDraft.weightKg)
    const rir = workoutDraft.rir === '' ? undefined : toNumber(workoutDraft.rir)

    if (!sets || !reps || !weightKg) {
      setMessage('Completa series, reps y kg para guardar el ejercicio')
      return
    }

    upsertWorkoutSet({
      exerciseId: exId,
      sets,
      reps,
      weightKg,
      rir
    })

    setWorkoutHistoryExpanded(true)

    setWorkoutDraft((prev) => ({ ...prev, sets: '', reps: '', weightKg: '', rir: '' }))
    setMessage('Ejercicio añadido/actualizado')
  }

  const updateWorkoutSet = (exerciseId: string, field: keyof WorkoutSet, value: number | undefined) => {
    draftDirtyRef.current = true
    setDraftLog((prev) => {
      const baseSession = prev.workout[0] ?? createEmptySession(prev.id)
      const index = baseSession.sets.findIndex((entry) => getWorkoutSetId(entry) === exerciseId)
      if (index < 0) return prev

      const nextSets = baseSession.sets.map((entry, entryIndex) =>
        entryIndex === index ? { ...entry, [field]: value } : entry
      )
      return {
        ...prev,
        workout: [{ ...baseSession, sets: nextSets }, ...prev.workout.slice(1)]
      }
    })
  }

  const removeWorkoutSet = (exerciseId: string) => {
    draftDirtyRef.current = true
    setDraftLog((prev) => {
      const baseSession = prev.workout[0] ?? createEmptySession(prev.id)
      const nextSets = baseSession.sets.filter((entry) => getWorkoutSetId(entry) !== exerciseId)
      return {
        ...prev,
        workout: [{ ...baseSession, sets: nextSets }, ...prev.workout.slice(1)]
      }
    })
  }

  const addCustomExercise = () => {
    const name = customExerciseName.trim()
    if (!name) {
      setMessage('Escribe el nombre del ejercicio')
      return
    }

    const exists = state.exerciseCatalog.some(
      (item) => item.name.trim().toLowerCase() === name.toLowerCase()
    )
    if (exists) {
      setMessage('Ese ejercicio ya existe')
      return
    }

    const newExerciseId = `custom_${uid()}`
    const newExercise = {
      id: newExerciseId,
      name,
      isCore: false
    }

    setState((prev) => ({ ...prev, exerciseCatalog: [...prev.exerciseCatalog, newExercise] }))
    setWorkoutDraft((prev) => ({ ...prev, exerciseId: newExerciseId }))
    setCustomExerciseName('')
    setMessage('Ejercicio personalizado añadido')
  }

  const getSetDraftForExercise = (exerciseId: string): Omit<WorkoutSet, 'exerciseId'> & { exerciseId: string } => {
    const session = draftLog.workout[0] ?? createEmptySession(draftLog.id)
    return (
      session.sets.find((entry) => getWorkoutSetId(entry) === exerciseId) ??
      { exerciseId, sets: 0, reps: 0, weightKg: 0, rir: undefined }
    )
  }

  const setNotificationPermission = async () => {
    if (!('Notification' in window)) {
      setMessage('Navegador sin soporte de notificaciones')
      return
    }

    if (Notification.permission === 'denied') {
      setMessage('Permiso denegado desde navegador')
      return
    }

    const permission = await Notification.requestPermission()
    setState((prev) => ({ ...prev, settings: { notificationsEnabled: permission === 'granted' } }))
  }

  const exportJson = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      ...state
    }
    const content = JSON.stringify(payload, null, 2)
    downloadJson(content, `health-tracker-${formatDateInputValue()}.json`)
  }

  const exportWeekly = () => {
    const result = exportWeeklyJson(state, activeDate)
    downloadJson(result.content, result.fileName)
  }

  const range7 = getRange(7)
  const exportCsv = () => {
    const csv = toCsv(state.logs, range7.start, range7.end, state.weeklyMeasurements)
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `health-tracker-${range7.start}-to-${range7.end}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const importJson = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = () => {
      try {
        const raw = JSON.parse(String(reader.result)) as {
          logs?: DailyLog[]
          presets?: AppState['presets']
          exerciseCatalog?: AppState['exerciseCatalog']
          draftByDate?: AppState['draftByDate']
          weeklyMeasurements?: AppState['weeklyMeasurements']
          draftByWeek?: AppState['draftByWeek']
        }

        const incomingLogs = Array.isArray(raw.logs) ? raw.logs : []
        const incomingPresets = Array.isArray(raw.presets) ? raw.presets : []
        const incomingCatalog = Array.isArray(raw.exerciseCatalog) ? raw.exerciseCatalog : []
        const incomingDrafts = raw.draftByDate && typeof raw.draftByDate === 'object' ? raw.draftByDate : {}
        const incomingWeekly = Array.isArray(raw.weeklyMeasurements) ? raw.weeklyMeasurements : []
        const incomingDraftByWeek =
          raw.draftByWeek && typeof raw.draftByWeek === 'object' ? raw.draftByWeek : {}

        setState((prev) => {
          const byDate = new Map(prev.logs.map((row) => [row.date, row]))
          incomingLogs.forEach((row) => {
            if (!byDate.has(row.date)) {
              byDate.set(row.date, row)
            }
          })

          const nextPresets = [...prev.presets]
          const existingPresetIds = new Set(nextPresets.map((preset) => preset.id))
          incomingPresets.forEach((preset) => {
            if (!preset?.id || !preset?.name) return
            if (!existingPresetIds.has(preset.id)) {
              nextPresets.push(preset)
              existingPresetIds.add(preset.id)
            }
          })

          const nextCatalog = [...prev.exerciseCatalog]
          const existingIds = new Set(nextCatalog.map((item) => item.id))
          incomingCatalog.forEach((item) => {
            if (!item?.id || !item?.name) return
            if (!existingIds.has(item.id)) {
              nextCatalog.push(item)
              existingIds.add(item.id)
            }
          })

          const byWeek = new Map(prev.weeklyMeasurements.map((row) => [row.weekStart, row]))
          incomingWeekly.forEach((row) => {
            if (!row?.weekStart) return
            if (!byWeek.has(row.weekStart)) {
              byWeek.set(row.weekStart, row)
            }
          })

          const nextDraftByWeek = { ...(prev.draftByWeek || {}), ...(incomingDraftByWeek as Record<string, WeeklyMeasurement>) }

          return {
            ...prev,
            logs: Array.from(byDate.values()),
            presets: nextPresets,
            exerciseCatalog: nextCatalog,
            weeklyMeasurements: Array.from(byWeek.values()),
            draftByDate: { ...(prev.draftByDate || {}), ...(incomingDrafts as Record<string, DailyLog>) },
            draftByWeek: nextDraftByWeek
          }
        })

        setMessage('Importado sin duplicados por fecha')
      } catch {
        setMessage('No se pudo importar el archivo')
      }
    }

    reader.readAsText(file)
    event.target.value = ''
  }

  const renderPlan = () => (
    <div className="section">
      <h2>Plan y reglas</h2>
      <div className="plan-banner">
        <span className={`kpi-status ${kpiDecisionTone}`}>
          Decision actual: {currentDecision}
        </span>
        <span className={`kpi-status ${kpi14Trend}`}>Adherencia 14d: {kpis.kpis14.adherence}%</span>
      </div>

      <div className="card">
        <h3>Objetivos</h3>
        <ul>
          <li>Cintura: 88 {'->'} 84-85</li>
          <li>Prioridad 1: Consistencia diaria de registro</li>
          <li>Peso ancla fase 1: ~70 kg (secundario)</li>
          <li>Adherencia objetivo semanal: 85%</li>
        </ul>
      </div>

      <div className="card">
        <h3>Medidas base</h3>
        <ul>
          <li>Altura: 174 cm</li>
          <li>Peso: 72.4 kg</li>
          <li>Grasa estimada: 19-22%</li>
          <li>Cintura: 88 cm</li>
          <li>Meta estética: más cintura estrecha y mayor anchura de espalda</li>
        </ul>
      </div>

      <div className="card">
        <h3>Plan nutricional</h3>
        <ul>
          <li>Dia gym: 2200 kcal | 150P | 60F | 250C</li>
          <li>Dia sin gym: 2000 kcal | 150P | 70F | 170C</li>
          <li>3 comidas al dia, registro visible en cada bloque</li>
        </ul>
      </div>

      <div className="card">
        <h3>Entrenamiento</h3>
        <h4>Día A</h4>
        <p>Press pecho máquina 3x6-10, remo 4x8-12, jalón 3x8-12, prensa 3x8-12, laterales 4x12-20, Pallof 3x10-12.</p>
        <h4>Día B</h4>
        <p>Jalón 4x8-12, remo 3x8-12, hip thrust 4x8-12, extensión cuádriceps 2-3x12-15, face pulls 3x12-15, dead bug 3x8-12, laterales 2x15-20.</p>
        <h4>Día C</h4>
        <p>Press inclinado 3x8-12, remo 3x8-12, hack squat 3x8-12, abductores 3x12-20, curl femoral 3x10-12, RKC 4x20-40s, farmer carry 5 min.</p>
      </div>

      <div className="card">
        <h3>Decision quincenal</h3>
        <p>Estado actual: <strong>{currentDecision}</strong></p>
        <p>{kpis.kpis14.reason}</p>
      </div>
    </div>
  )

  const renderHoy = () => {
    const mealCards = (['desayuno', 'comida', 'cena'] as MealName[]).map((meal) => {
      const rows = draftLog.meals.filter((entry) => entry.meal === meal)
      const target = mealTargetFor(draftLog.dayType, meal)
      const totals = rows.reduce(
        (acc, row) => ({
          p: acc.p + row.p,
          f: acc.f + row.f,
          c: acc.c + row.c,
          kcal: acc.kcal + row.kcal
        }),
        { p: 0, f: 0, c: 0, kcal: 0 }
      )
      const ratio = ((totals.p / target.p) + (totals.f / target.f) + (totals.c / target.c) + (totals.kcal / target.kcal)) / 4
      const tone = toTone(ratio)
      const isOpen = mealExpanded[meal]

      return (
        <div className="card task-card" key={meal}>
          <button type="button" className="task-card__header" onClick={() => {
            setMealExpanded((prev) => ({ ...prev, [meal]: !prev[meal] }))
          }}>
            <div>
              <p className="task-card__title">{meal.toUpperCase()}</p>
              <p className="task-card__meta">
                {totals.p.toFixed(0)}P · {totals.f.toFixed(0)}F · {totals.c.toFixed(0)}C · {totals.kcal.toFixed(0)}kcal
              </p>
            </div>
            <span className={`status-pill ${tone}`}>{rows.length ? 'Parcial' : 'Pendiente'}</span>
            <span className="task-card__toggle">{isOpen ? '−' : '+'}</span>
          </button>

          {isOpen ? (
            <div className="task-card__body">
              {rows.length ? (
                <ul className="history-list">
                  {rows.map((entry) => {
                    const label = entry.source === 'preset'
                      ? state.presets.find((preset) => preset.id === entry.presetId)?.name
                      : entry.notes

                    return (
                      <li className="meal-item" key={entry.id}>
                        <div>
                          {label ?? 'Comida'} · {entry.grams}g · {entry.p.toFixed(0)}P {entry.f.toFixed(0)}F {entry.c.toFixed(0)}C
                        </div>
                        <button type="button" className="remove-button" onClick={() => removeMeal(entry.id)}>
                          Quitar
                        </button>
                      </li>
                    )
                  })}
                </ul>
              ) : null}

              <div className="meal-form">
                <label>
                  Comida
                  <input
                    type="text"
                    value={mealDrafts[meal].name}
                    onChange={(event) => updateMealDraft(meal, { name: event.target.value })}
                    placeholder="Ej. Arroz, pechuga, yogur..."
                  />
                </label>

                <label>
                  Gramos
                  <input
                    type="number"
                    value={mealDrafts[meal].grams}
                    onChange={(event) => updateMealDraft(meal, { grams: Number(event.target.value) })}
                  />
                </label>

                <button type="button" className="ghost-link" onClick={() => toggleMealAdvanced(meal)}>
                  {mealAdvanced[meal] ? 'Ocultar macros' : 'Añadir P/F/C/Kcal'}
                </button>

                {mealAdvanced[meal] ? (
                  <div className="manual-grid">
                    <label>
                      P
                      <input
                        type="number"
                        value={mealDrafts[meal].p}
                        placeholder="P"
                        onChange={(event) => updateMealDraft(meal, { p: Number(event.target.value) })}
                      />
                    </label>
                    <label>
                      F
                      <input
                        type="number"
                        value={mealDrafts[meal].f}
                        placeholder="F"
                        onChange={(event) => updateMealDraft(meal, { f: Number(event.target.value) })}
                      />
                    </label>
                    <label>
                      C
                      <input
                        type="number"
                        value={mealDrafts[meal].c}
                        placeholder="C"
                        onChange={(event) => updateMealDraft(meal, { c: Number(event.target.value) })}
                      />
                    </label>
                    <label>
                      kcal
                      <input
                        type="number"
                        value={mealDrafts[meal].kcal}
                        placeholder="kcal"
                        onChange={(event) => updateMealDraft(meal, { kcal: Number(event.target.value) })}
                      />
                    </label>
                  </div>
                ) : null}

                <button type="button" className="add-button" onClick={() => addMeal(meal)}>
                  Añadir comida
                </button>
              </div>
            </div>
          ) : null}
        </div>
      )
    })

    const totalWorkout = getCurrentWorkoutEntries()
    const workoutDayKeys = Object.keys(WORKOUT_DAY_OPTIONS) as WorkoutDay[]
    const workoutOptions = getExerciseOptionsForDay(state, workoutDay)
    const expectedExercises = WORKOUT_DAY_EXERCISES[workoutDay]
    const completedSet = new Set(totalWorkout.map((entry) => getWorkoutSetId(entry)))
    const completedExpected = expectedExercises.filter((id) => completedSet.has(id)).length
    const mealSummaryCount = (['desayuno', 'comida', 'cena'] as MealName[]).reduce(
      (acc, meal) => acc + (draftLog.meals.some((entry) => entry.meal === meal) ? 1 : 0),
      0
    )
    const dayTarget = DAY_TARGETS[draftLog.dayType]
    const dayRatio = ((draftTotals.p / dayTarget.p) + (draftTotals.f / dayTarget.f) + (draftTotals.c / dayTarget.c) + (draftTotals.kcal / dayTarget.kcal)) / 4
    const dayTone = toTone(dayRatio)
    const activeIsDraft = Boolean(state.draftByDate?.[activeDate])
    const activeWeeklyIsDraft = Boolean(state.draftByWeek?.[toWeekStart(activeDate)])

    return (
      <div className="section">
        <div className="section-intro">
          <h2>Hoy</h2>
          <p className="muted">{activeDate}</p>
        </div>

        <div className="card task-card">
          <div className="task-card__header task-card__header--plain">
            <div>
              <p className="task-card__title">Estado del día</p>
              <p className="task-card__meta">
                Progreso: Comidas {mealSummaryCount}/3, entrenamiento {completedSet.size}/{expectedExercises.length}
              </p>
            </div>
            <span className={`status-pill ${mealSummaryCount >= 1 ? 'ok' : 'warn'}`}>
              {mealSummaryCount >= 1 ? 'Parcial' : 'Pendiente'}
            </span>
          </div>
          <div className="task-card__body task-grid">
            <span className={`status-pill ${activeIsDraft ? 'warn' : 'ok'}`}>
              {activeIsDraft ? 'Cambios sin guardar' : 'Sin cambios'}
            </span>
            <span className={`status-pill ${dayTone}`}>{activeWeeklyIsDraft ? 'Semana pendiente' : 'Semana ok'}</span>
          </div>
        </div>

        <div className="card task-card">
          <div className="task-card__header task-card__header--plain">
            <p className="task-card__title">Macros del día</p>
            <span className={`status-pill ${dayTone}`}>{dayTone.toUpperCase()}</span>
          </div>
          <div className="task-card__body stat-row">
            <div className="stat-value">{draftTotals.kcal.toFixed(0)} kcal</div>
            <div className="stat-value">{draftTotals.p.toFixed(0)}P</div>
            <div className="stat-value">{draftTotals.f.toFixed(0)}F</div>
            <div className="stat-value">{draftTotals.c.toFixed(0)}C</div>
          </div>
          <div className="task-card__body">
            <small>Objetivo {dayTarget.kcal} kcal · {dayTarget.p}P · {dayTarget.f}F · {dayTarget.c}C</small>
          </div>
        </div>

        <div className="section-title-row">
          <h3>Comidas</h3>
          <button
            type="button"
            className="ghost-link"
            onClick={() =>
              setMealExpanded({
                desayuno: !mealExpanded.desayuno,
                comida: !mealExpanded.comida,
                cena: !mealExpanded.cena
              })
            }
          >
            {mealExpanded.desayuno && mealExpanded.comida && mealExpanded.cena ? 'Colapsar' : 'Expandir'}
          </button>
        </div>
        {mealCards}

        <div className="card task-card">
          <div className="task-card__header">
            <div>
              <p className="task-card__title">Entrenamiento · Bloque {workoutDay}</p>
              <p className="task-card__meta">
                {completedExpected}/{expectedExercises.length} ejercicios del bloque
              </p>
            </div>
            <span className={`status-pill ${completedExpected >= expectedExercises.length ? 'ok' : 'warn'}`}>
              {completedExpected >= expectedExercises.length ? 'Completo' : 'Pendiente'}
            </span>
          </div>

          <label>
            Selecciona bloque A/B/C
            <select value={workoutDay} onChange={(event) => setWorkoutDay(event.target.value as WorkoutDay)}>
              {workoutDayKeys.map((key) => (
                <option key={key} value={key}>
                  {WORKOUT_DAY_OPTIONS[key]}
                </option>
              ))}
            </select>
          </label>

          <ul className="workout-plan-list">
            {expectedExercises.map((entry) => {
              const isDone = completedSet.has(entry)
              return (
                <li key={entry} className={isDone ? 'is-done' : ''}>
                  {isDone ? '✅' : '◻'} {getExerciseName(entry)}
                </li>
              )
            })}
          </ul>

          <div className="workout-form">
            <label>
              Ejercicio
              <select
                value={workoutDraft.exerciseId}
                onChange={(event) => setWorkoutDraft((prev) => ({ ...prev, exerciseId: event.target.value }))}
              >
                {workoutOptions.map((exercise) => (
                  <option key={exercise.id} value={exercise.id}>
                    {exercise.name}
                  </option>
                ))}
              </select>
            </label>

            <div className="split-row">
              <label>
                Series
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={workoutDraft.sets}
                  onChange={(event) => setWorkoutDraft((prev) => ({ ...prev, sets: event.target.value }))}
                />
              </label>
              <label>
                Reps
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={workoutDraft.reps}
                  onChange={(event) => setWorkoutDraft((prev) => ({ ...prev, reps: event.target.value }))}
                />
              </label>
            </div>
            <div className="split-row">
              <label>
                Kg
                <input
                  type="text"
                  inputMode="decimal"
                  pattern="[0-9]*[.,]?[0-9]*"
                  value={workoutDraft.weightKg}
                  onChange={(event) => setWorkoutDraft((prev) => ({ ...prev, weightKg: event.target.value }))}
                />
              </label>
              <label>
                RIR
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={workoutDraft.rir}
                  onChange={(event) => setWorkoutDraft((prev) => ({ ...prev, rir: event.target.value }))}
                />
              </label>
            </div>
            <button type="button" className="add-button" onClick={addOrUpdateWorkout}>
              Añadir / actualizar
            </button>

            <label className="inline-input">
              Nuevo ejercicio
              <div className="split-row">
                <input
                  type="text"
                  value={customExerciseName}
                  onChange={(event) => setCustomExerciseName(event.target.value)}
                  placeholder="Nombre del ejercicio"
                />
                <button type="button" className="add-button" onClick={addCustomExercise}>
                  Guardar
                </button>
              </div>
            </label>

            <button type="button" className="ghost-link" onClick={() => setWorkoutHistoryExpanded((prev) => !prev)}>
              {workoutHistoryExpanded ? 'Ocultar ejercicios registrados' : 'Ver ejercicios registrados'}
            </button>
          </div>

          {workoutHistoryExpanded ? (
            totalWorkout.length === 0 ? (
              <div className="warning">Aun no has registrado ejercicios hoy.</div>
            ) : (
              <ul className="history-list">
                {totalWorkout.map((entry) => {
                  const exerciseId = getWorkoutSetId(entry)
                  const rowKey = exerciseId || `sin-id-${entry.exerciseId || entry.exercise}`
                  const exerciseSet = getSetDraftForExercise(exerciseId)

                  return (
                    <li className="workout-list-item" key={rowKey}>
                      <strong>{getExerciseName(exerciseId)}</strong>
                      <div className="split-row">
                        <label>
                          Series
                          <input
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            value={exerciseSet.sets}
                            onChange={(event) =>
                              updateWorkoutSet(exerciseId, 'sets', toNumber(event.target.value))
                            }
                          />
                        </label>
                        <label>
                          Reps
                          <input
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            value={exerciseSet.reps}
                            onChange={(event) =>
                              updateWorkoutSet(exerciseId, 'reps', toNumber(event.target.value))
                            }
                          />
                        </label>
                      </div>
                      <div className="split-row">
                        <label>
                          Kg
                          <input
                            type="text"
                            inputMode="decimal"
                            pattern="[0-9]*[.,]?[0-9]*"
                            value={exerciseSet.weightKg}
                            onChange={(event) =>
                              updateWorkoutSet(exerciseId, 'weightKg', toNumber(event.target.value))
                            }
                          />
                        </label>
                        <label>
                          RIR
                          <input
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            value={exerciseSet.rir ?? ''}
                            onChange={(event) =>
                              updateWorkoutSet(
                                exerciseId,
                                'rir',
                                event.target.value === '' ? undefined : toNumber(event.target.value)
                              )
                            }
                          />
                        </label>
                      </div>
                      <button type="button" onClick={() => removeWorkoutSet(exerciseId)} className="remove-button">
                        Quitar
                      </button>
                    </li>
                  )
                })}
              </ul>
            )
          ) : null}
        </div>

        <div className="card task-card">
          <label className="split-row">
            <span>Dia con gym</span>
            <input
              type="checkbox"
              checked={draftLog.dayType === 'gym'}
              onChange={(event) => updateDraft('dayType', event.target.checked ? 'gym' : 'nogym')}
            />
          </label>
          <div className="task-card__summary">
            Totales del dia: {draftTotals.p.toFixed(0)}P · {draftTotals.f.toFixed(0)}F · {draftTotals.c.toFixed(0)}C ·{' '}
            {draftTotals.kcal.toFixed(0)} kcal
          </div>
          <button type="button" className="primary" onClick={saveDraft}>
            Guardar día
          </button>
        </div>
      </div>
    )
  }

  const renderHistorico = () => {
    const list = [...state.logs].sort((a, b) => b.date.localeCompare(a.date))
    const kpi7Trend = kpis.kpis7.adherence >= 85 ? 'ok' : kpis.kpis7.adherence >= 60 ? 'warn' : 'bad'
    const kpi14Trend = kpis.kpis14.adherence >= 80 ? 'ok' : kpis.kpis14.adherence >= 60 ? 'warn' : 'bad'

    return (
      <div className="section">
        <h2>Historico</h2>
        <button type="button" className="quick-plan-button" onClick={() => setActiveTab('Plan y reglas')}>
          Ver plan y reglas
        </button>

        <div className="kpi-grid">
          <div className="kpi-card">
            <div>7 dias</div>
            <div>Peso: {kpis.kpis7.avgWeight || '--'} kg</div>
            <div>Cintura: {kpis.kpis7.waist ?? '--'} cm</div>
            <div>Trend cintura: {kpis.kpis7.waistTrend ?? '--'} cm</div>
            <div>Dolor: {kpis.kpis7.lumbar.toFixed(2)}</div>
            <div className={`kpi-status ${kpi7Trend}`}>Adherencia: {kpis.kpis7.adherence}%</div>
          </div>

          <div className="kpi-card">
            <div>14 dias</div>
            <div>Rendimiento: {Math.round(kpis.kpis14.perfIndex * 100)}%</div>
            <div>Decision: {kpis.kpis14.decision}</div>
            <div className={`kpi-status ${kpi14Trend}`}>Adherencia: {kpis.kpis14.adherence}%</div>
            <div>Cintura: {kpis.kpis14.waist ?? '--'} cm</div>
          </div>
        </div>

          <div className="card">
          <h3>Entradas</h3>
          <ul className="history-list">
            {list.map((log) => {
              const totals = getDailyTotals(log)
              const adh = computeDayAdherence(log).nutritionPercent
              const c = adh >= 85 ? 'ok' : adh >= 60 ? 'warn' : 'bad'
              return (
              <li className={c} key={log.id}>
                  <button
                    className="link-like"
                    type="button"
                    onClick={() => {
                      setActiveDate(log.date)
                      setActiveTab('Hoy')
                    }}
                  >
                    {log.date}
                  </button>
                  <div>
                    Reg: {computeDayAdherence(log).nutritionPercent}% | Tipo:{' '}
                    {log.dayType === 'gym' ? 'gym' : 'nogym'}
                  </div>
                  <div>
                    {totals.p.toFixed(0)}P/{totals.f.toFixed(0)}F/{totals.c.toFixed(0)}C ({totals.kcal.toFixed(0)}kcal) adh:
                    {adh}%
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveDate(log.date)
                      setActiveTab('Hoy')
                    }}
                  >
                    Abrir
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      </div>
    )
  }

  const renderMedidasSemanales = () => (
    <div className="section">
      <h2>Medidas semanales</h2>
        <div className="card">
          <h3>Resumen semanal</h3>
          <p>Semana {toWeekStart(activeDate)} (promedios y medidas por semana)</p>
        <div className="split-row">
          <label>
            Peso medio (kg)
            <input
              type="number"
              step="0.1"
              value={weeklyDraft.avgWeightKg ?? ''}
              onChange={(event) =>
                updateWeeklyDraft('avgWeightKg', event.target.value ? Number(event.target.value) : undefined)
              }
            />
          </label>
          <label>
            Cintura media (cm)
            <input
              type="number"
              step="0.1"
              value={weeklyDraft.waistCm ?? ''}
              onChange={(event) =>
                updateWeeklyDraft('waistCm', event.target.value ? Number(event.target.value) : undefined)
              }
            />
          </label>
        </div>
        <div className="split-row">
          <label>
            Dolor lumbar promedio (0-10)
            <input
              type="number"
              min={0}
              max={10}
              value={weeklyDraft.avgLumbarPain ?? ''}
              onChange={(event) =>
                updateWeeklyDraft('avgLumbarPain', event.target.value ? clampPain(Number(event.target.value)) : undefined)
              }
            />
          </label>
          <label>
            Pasos promedio
            <input
              type="number"
              value={weeklyDraft.steps ?? ''}
              onChange={(event) =>
                updateWeeklyDraft('steps', event.target.value ? Number(event.target.value) : undefined)
              }
            />
          </label>
        </div>
        <div className="split-row">
          <label>
            Sueño medio (h)
            <input
              type="number"
              step="0.1"
              value={weeklyDraft.sleepHours ?? ''}
              onChange={(event) =>
                updateWeeklyDraft('sleepHours', event.target.value ? Number(event.target.value) : undefined)
              }
            />
          </label>
        </div>
      </div>

      <div className="card">
        <h3>Medidas complementarias</h3>
        <div className="split-row">
          <label>
            Pecho (cm)
            <input
              type="number"
              step="0.1"
              value={weeklyDraft.chestCm ?? ''}
              onChange={(event) =>
                updateWeeklyDraft('chestCm', event.target.value ? Number(event.target.value) : undefined)
              }
            />
          </label>
          <label>
            Hombros (cm)
            <input
              type="number"
              step="0.1"
              value={weeklyDraft.shouldersCm ?? ''}
              onChange={(event) =>
                updateWeeklyDraft('shouldersCm', event.target.value ? Number(event.target.value) : undefined)
              }
            />
          </label>
        </div>
        <div className="split-row">
          <label>
            Brazo (cm)
            <input
              type="number"
              step="0.1"
              value={weeklyDraft.armCm ?? ''}
              onChange={(event) =>
                updateWeeklyDraft('armCm', event.target.value ? Number(event.target.value) : undefined)
              }
            />
          </label>
          <label>
            Cadera (cm)
            <input
              type="number"
              step="0.1"
              value={weeklyDraft.hipsCm ?? ''}
              onChange={(event) =>
                updateWeeklyDraft('hipsCm', event.target.value ? Number(event.target.value) : undefined)
              }
            />
          </label>
        </div>
        <button className="primary" type="button" onClick={saveWeekly}>
          Guardar semana
        </button>
      </div>

      <div className="card">
        <h3>Resumen 14 días</h3>
        <p>
          Índice de rendimiento reciente: {Math.round(kpis.kpis14.perfIndex * 100)}%
          {kpis.kpis14.perfIndex > 0 ? ' mejora' : kpis.kpis14.perfIndex < 0 ? ' descenso' : ' estable'}
        </p>
        <p>
          Seguimiento semanal: {state.weeklyMeasurements.length} semanas registradas
          {state.draftByWeek && Object.keys(state.draftByWeek || {}).length
            ? ` (${Object.keys(state.draftByWeek || {}).length} borradores)`
            : ''}
        </p>
      </div>

      <div className="card">
        <h3>Semanas registradas</h3>
        <ul className="history-list">
          {[...state.weeklyMeasurements]
            .sort((a, b) => b.weekStart.localeCompare(a.weekStart))
            .map((row) => (
              <li key={row.id}>
                <button
                  className="link-like"
                  type="button"
                  onClick={() => {
                    setActiveDate(row.weekStart)
                    setActiveTab('Medidas semanales')
                  }}
                >
                  {row.weekStart}
                </button>
                <div>
                  peso: {row.avgWeightKg != null ? `${row.avgWeightKg} kg` : '--'} | cintura:{' '}
                  {row.waistCm != null ? `${row.waistCm} cm` : '--'} | dolor:{' '}
                  {row.avgLumbarPain != null ? `${row.avgLumbarPain}` : '--'}
                </div>
                <div>
                  pecho: {row.chestCm != null ? `${row.chestCm} cm` : '--'} | hombros:{' '}
                  {row.shouldersCm != null ? `${row.shouldersCm} cm` : '--'} | brazo:{' '}
                  {row.armCm != null ? `${row.armCm} cm` : '--'} | cadera:{' '}
                  {row.hipsCm != null ? `${row.hipsCm} cm` : '--'}
                </div>
              </li>
            ))}
        </ul>
      </div>
    </div>
  )

  const renderAjustes = () => {
    const notificationLabel = state.settings.notificationsEnabled ? 'Desactivar' : 'Activar'
    return (
      <div className="section">
        <h2>Exportar</h2>
        <div className="card">
          <h3>Notificaciones</h3>
          <button type="button" onClick={setNotificationPermission}>
            {notificationLabel} notificaciones
          </button>
          <div className={state.settings.notificationsEnabled ? 'ok' : 'warning'}>
            Estado: {state.settings.notificationsEnabled ? 'activadas' : 'detenidas'}
          </div>
        </div>

        <div className="card">
          <h3>Exportacion y backup</h3>
          <button className="primary" type="button" onClick={exportJson}>
            Exportar JSON
          </button>
          <button type="button" onClick={exportWeekly}>
            Exportar semana (JSON)
          </button>
          <button type="button" onClick={exportCsv}>
            Exportar CSV (ult 7 dias)
          </button>
          <label className="file-label">
            Importar backup JSON
            <input type="file" accept="application/json" onChange={importJson} />
          </label>
        </div>

        <div className="card">
          <h3>Resumen local</h3>
          <p>Registros: {state.logs.length}</p>
          <p>Registros semanales: {state.weeklyMeasurements.length}</p>
          <p>Borradores diarios: {Object.keys(state.draftByDate || {}).length}</p>
          <p>Borradores semanales: {Object.keys(state.draftByWeek || {}).length}</p>
          <p>Sincronizacion: 100% local (IndexedDB + localStorage fallback).</p>
          <p>Objetivo de export: revision manual semanal.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar__row">
          <h1>Health Tracker 2026</h1>
          <button type="button" className="ghost-link" onClick={() => setActiveTab('Plan y reglas')}>
            {activeTab === 'Plan y reglas' ? 'Inicio' : 'Plan'}
          </button>
        </div>
        <div className="topbar__row">
          <input type="date" value={activeDate} onChange={(event) => setActiveDate(event.target.value)} />
          {saveStatus !== 'idle' ? <span className={`save-indicator ${saveStatus}`}>{saveLabel}</span> : null}
        </div>
      </header>

      <main>
        {updateAvailable ? (
          <div className="update-banner">
            <strong>Nueva versión disponible</strong>
            <button type="button" onClick={applyAppUpdate}>
              Actualizar ahora
            </button>
          </div>
        ) : null}

        <div className="message">{message}</div>
        <div className="tap-hints">
          <span className="tap-hint">Toque amplio y simple para móvil</span>
        </div>

        {!state.settings.notificationsEnabled ? (
          <div className="warning">Recordatorio: activa notificaciones en Ajustes para alertas.</div>
        ) : null}

        {activeTab === 'Plan y reglas' ? renderPlan() : null}
        {activeTab === 'Hoy' ? renderHoy() : null}
        {activeTab === 'Historico' ? renderHistorico() : null}
        {activeTab === 'Medidas semanales' ? renderMedidasSemanales() : null}
        {activeTab === 'Exportar' ? renderAjustes() : null}
      </main>

      <nav className="bottom-nav">
        {TABS.map((tab) => (
          <button
            type="button"
            key={tab}
            className={activeTab === tab ? 'active' : ''}
            data-icon={TAB_ICON[tab]}
            aria-label={tab}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
          </button>
        ))}
      </nav>
    </div>
  )
}

function getNextReminder(
  now: Date,
  rule: { hour: number; minute: number; dayOfWeek: number | null; key: string; label: string }
) {
  const target = new Date(now)
  target.setHours(rule.hour, rule.minute, 0, 0)

  if (rule.dayOfWeek == null) {
    if (target.getTime() <= now.getTime()) {
      target.setDate(target.getDate() + 1)
    }
    return target
  }

  while (target.getDay() !== rule.dayOfWeek || target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1)
  }
  return target
}

function clampPain(value: number): number {
  if (Number.isNaN(value)) return 0
  return Math.min(10, Math.max(0, Math.round(value)))
}
