import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { DashboardTab } from './features/dashboard/DashboardTab'
import { ExportTab } from './features/export/ExportTab'
import { MeasurementsTab } from './features/measurements/MeasurementsTab'
import { PlanTab } from './features/plan/PlanTab'
import { WorkoutTab } from './features/workout/WorkoutTab'
import { appReducer } from './features/app/reducer'
import {
  defaultExportRange,
  downloadText,
  exportAnalyticsJson,
  exportBackupJson,
  exportMeasurementsCsv,
  exportWorkoutSessionsCsv,
  exportWorkoutSetsCsv
} from './utils/backup'
import {
  calculateDashboardSummary,
  createEmptySession,
  formatDateInputValue,
  getMeasurementForDate,
  getSessionForDate,
  uid
} from './utils/metrics'
import {
  getDefaultState,
  loadAppState,
  normalizeImportedState,
  safeSaveDebounced,
  StorageSaveResult
} from './utils/storage'
import {
  clearSheetsSyncToken,
  enqueueSyncRows,
  getSyncQueueSize,
  hasSheetsSyncToken,
  setSheetsSyncToken,
  syncNow,
  toSyncRowsFromMeasurement,
  toSyncRowsFromObjective,
  toSyncRowsFromSession,
  toSyncRowsFromTemplate,
  toSoftDeleteRowsFromSession,
  toSoftDeleteRowsFromSets
} from './utils/sheetsSync'
import { saveQueue } from './utils/syncQueue'
import {
  MeasurementEntry,
  Objective,
  SheetsSyncSettings,
  SyncQueueItemInput,
  TrainingTemplateDay,
  WorkoutSetLog,
  WorkoutSessionLog
} from './types'

const TABS = ['Dashboard', 'Entreno', 'Medidas', 'Plan', 'Exportar'] as const
type Tab = (typeof TABS)[number]

const SW_UPDATE_EVENT = 'health-tracker-sw-update'

type UpdateEventDetail = {
  registration?: ServiceWorkerRegistration
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'offline'

const TAB_ICON: Record<Tab, string> = {
  Dashboard: '📈',
  Entreno: '🏋️',
  Medidas: '📏',
  Plan: '🧭',
  Exportar: '💾'
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

function getLatestSessionForDate(sessions: WorkoutSessionLog[], date: string): WorkoutSessionLog | null {
  const found = sessions
    .filter((session) => session.date === date)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]

  return found || null
}

function normalizeComparableSet(set: WorkoutSetLog) {
  return {
    id: set.id,
    exerciseId: set.exerciseId,
    setNumber: set.setNumber,
    reps: set.reps,
    weightKg: set.weightKg,
    rir: set.rir ?? null,
    isWarmup: Boolean(set.isWarmup)
  }
}

function buildComparableSession(session: WorkoutSessionLog | null) {
  if (!session) return null
  return {
    date: session.date,
    templateDayId: session.templateDayId,
    notes: session.notes || '',
    sets: [...session.sets]
      .sort((a, b) => {
        if (a.exerciseId === b.exerciseId) return a.setNumber - b.setNumber
        return a.exerciseId.localeCompare(b.exerciseId)
      })
      .map(normalizeComparableSet)
  }
}

function hasSessionChanges(draft: WorkoutSessionLog, saved: WorkoutSessionLog | null): boolean {
  if (!saved) {
    return Boolean(draft.sets.length || (draft.notes || '').trim())
  }

  return JSON.stringify(buildComparableSession(draft)) !== JSON.stringify(buildComparableSession(saved))
}

export default function App() {
  const [state, dispatch] = useReducer(appReducer, getDefaultState())
  const [loaded, setLoaded] = useState(false)
  const [activeTab, setActiveTab] = useState<Tab>('Dashboard')

  const [workoutDate, setWorkoutDate] = useState(formatDateInputValue())
  const [measurementDate, setMeasurementDate] = useState(formatDateInputValue())

  const [exportFromDate, setExportFromDate] = useState(formatDateInputValue())
  const [exportToDate, setExportToDate] = useState(formatDateInputValue())

  const [message, setMessage] = useState('')
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const [syncQueueSize, setSyncQueueSize] = useState(0)
  const [hasSyncToken, setHasSyncToken] = useState(false)

  const timers = useRef<number[]>([])
  const saveStatusTimer = useRef<number | null>(null)
  const swUpdateRegistration = useRef<ServiceWorkerRegistration | null>(null)
  const swReloadTimer = useRef<number | null>(null)

  const dashboardSummary = useMemo(() => calculateDashboardSummary(state, formatDateInputValue()), [state])

  const sessionDraft = useMemo(() => {
    const found = getSessionForDate(state, workoutDate)
    if (found) {
      return {
        ...found,
        date: workoutDate
      }
    }

    return createEmptySession(workoutDate, 'A')
  }, [state, workoutDate])

  const savedSessionForWorkoutDate = useMemo(
    () => getLatestSessionForDate(state.sessions, workoutDate),
    [state.sessions, workoutDate]
  )

  const hasUnsavedWorkoutChanges = useMemo(
    () => hasSessionChanges(sessionDraft, savedSessionForWorkoutDate),
    [sessionDraft, savedSessionForWorkoutDate]
  )

  const measurementDraft = useMemo(() => {
    const found = getMeasurementForDate(state.measurements, measurementDate)
    if (found) return found

    return {
      id: uid(),
      date: measurementDate,
      weightKg: undefined,
      waistCm: undefined,
      lumbarPain: undefined,
      steps: undefined,
      sleepHours: undefined,
      chestCm: undefined,
      shouldersCm: undefined,
      armCm: undefined,
      hipsCm: undefined
    }
  }, [state.measurements, measurementDate])

  const saveLabel =
    saveStatus === 'saving'
      ? 'Guardando...'
      : saveStatus === 'offline'
        ? 'Sin guardar (fallback local)'
        : 'Guardado'

  useEffect(() => {
    ;(async () => {
      const loadedState = await loadAppState()
      dispatch({ type: 'replace_state', state: loadedState })

      const range = defaultExportRange(loadedState)
      setExportFromDate(range.fromDate)
      setExportToDate(range.toDate)
      setSyncQueueSize(getSyncQueueSize())
      setHasSyncToken(hasSheetsSyncToken())
      setLoaded(true)
    })()
  }, [])

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

    const reminders = [
      { key: 'workout', label: 'Registro de entrenamiento', hour: 20, minute: 30, dayOfWeek: null as number | null },
      { key: 'review', label: 'Revision semanal de progreso', hour: 19, minute: 0, dayOfWeek: 0 as number }
    ]

    const now = new Date()
    reminders.forEach((rule) => {
      const target = getNextReminder(now, rule)
      const delay = target.getTime() - now.getTime()
      if (delay <= 0) return

      const timer = window.setTimeout(() => {
        new Notification(rule.label, {
          body:
            rule.key === 'review'
              ? 'Revisa volumen, e1RM, medidas y ajusta el plan.'
              : 'Registra tu sesion de entrenamiento de hoy.',
          icon: `${import.meta.env.BASE_URL}icon.svg`,
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
      setMessage('Nueva version disponible')
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

  const runSheetsSync = async (
    options: { force?: boolean; silent?: boolean } = {}
  ): Promise<{ ok: boolean; pending: number; sent: number; failed: number; error?: string }> => {
    const syncSettings = state.settings.sheetsSync

    if (!syncSettings.enabled) {
      const pending = getSyncQueueSize()
      if (!options.silent) {
        setMessage('Activa Google Sheets Sync para sincronizar.')
      }
      return { ok: false, pending, sent: 0, failed: 0, error: 'Sync desactivado' }
    }

    dispatch({
      type: 'update_sheets_sync',
      patch: {
        lastSyncStatus: 'syncing',
        lastSyncError: undefined
      }
    })

    const result = await syncNow({
      endpointUrl: syncSettings.endpointUrl,
      schemaVersion: state.version,
      deviceId: state.meta.deviceId,
      force: options.force,
      mode: syncSettings.mode
    })

    setSyncQueueSize(result.pending)

    if (result.ok) {
      dispatch({
        type: 'update_sheets_sync',
        patch: {
          lastSyncStatus: 'success',
          lastSyncAt: result.syncedAt || new Date().toISOString(),
          lastSyncError: undefined
        }
      })

      if (!options.silent) {
        setMessage(result.sent ? `Sincronizacion completada (${result.sent} registros).` : 'Sin pendientes para sincronizar.')
      }
      return result
    }

    dispatch({
      type: 'update_sheets_sync',
      patch: {
        lastSyncStatus: 'error',
        lastSyncError: result.error
      }
    })

    if (!options.silent) {
      setMessage(result.error || 'No se pudo sincronizar con Google Sheets.')
    }

    return result
  }

  const queueForSync = (items: SyncQueueItemInput[]) => {
    if (!items.length) return

    const queueLength = enqueueSyncRows(items)
    setSyncQueueSize(queueLength)

    if (state.settings.sheetsSync.enabled && state.settings.sheetsSync.autoSyncOnSave) {
      void runSheetsSync({ silent: true })
    }
  }

  const updateSheetsSyncSettings = (patch: Partial<SheetsSyncSettings>) => {
    dispatch({ type: 'update_sheets_sync', patch })
  }

  const saveSheetsToken = (token: string) => {
    if (state.settings.sheetsSync.mode !== 'direct_webhook') {
      setMessage('En modo backend el token se guarda en servidor, no en frontend.')
      return
    }

    setSheetsSyncToken(token)
    setHasSyncToken(hasSheetsSyncToken())
    setMessage('Token de Google Sheets guardado localmente.')
  }

  const clearSavedSheetsToken = () => {
    if (state.settings.sheetsSync.mode !== 'direct_webhook') {
      setMessage('No hay token local en modo backend.')
      return
    }

    clearSheetsSyncToken()
    setHasSyncToken(false)
    setMessage('Token local eliminado.')
  }

  const enqueueBackfillForSheets = () => {
    const items: SyncQueueItemInput[] = [
      ...state.sessions.flatMap((session) => toSyncRowsFromSession(session)),
      ...state.measurements.flatMap((measurement) => toSyncRowsFromMeasurement(measurement)),
      ...state.objectives.flatMap((objective) => toSyncRowsFromObjective(objective)),
      ...state.trainingTemplates.flatMap((template) => toSyncRowsFromTemplate(template))
    ]

    const queueLength = enqueueSyncRows(items)
    setSyncQueueSize(queueLength)
    setMessage(`${items.length} registros encolados para backfill.`)
  }

  const clearSyncQueue = () => {
    saveQueue([])
    setSyncQueueSize(0)
    dispatch({
      type: 'update_sheets_sync',
      patch: {
        lastSyncStatus: 'idle',
        lastSyncError: undefined
      }
    })
    setMessage('Cola de sincronizacion limpiada.')
  }

  useEffect(() => {
    if (!loaded) return

    const syncSettings = state.settings.sheetsSync
    const hasEndpoint = Boolean(syncSettings.endpointUrl.trim())
    const hasAuth = syncSettings.mode === 'direct_webhook' ? hasSheetsSyncToken() : true

    const canRetry =
      syncSettings.enabled &&
      hasEndpoint &&
      hasAuth

    if (!canRetry) return

    void runSheetsSync({ silent: true })

    const handleOnline = () => {
      void runSheetsSync({ silent: true })
    }

    window.addEventListener('online', handleOnline)
    return () => {
      window.removeEventListener('online', handleOnline)
    }
  }, [
    loaded,
    state.settings.sheetsSync.enabled,
    state.settings.sheetsSync.mode,
    state.settings.sheetsSync.endpointUrl,
    state.settings.sheetsSync.autoSyncOnSave
  ])

  const updateSessionDraft = (session: WorkoutSessionLog) => {
    dispatch({ type: 'upsert_draft', date: workoutDate, session: { ...session, date: workoutDate } })
  }

  const saveSession = (session: WorkoutSessionLog) => {
    const previousSavedSession = getLatestSessionForDate(state.sessions, workoutDate)
    const normalizedSession: WorkoutSessionLog = {
      ...session,
      date: workoutDate,
      createdAt: session.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }

    dispatch({
      type: 'upsert_session',
      session: normalizedSession,
      clearDraft: true
    })

    const removedSets =
      previousSavedSession && previousSavedSession.id === normalizedSession.id
        ? previousSavedSession.sets.filter(
            (savedSet) => !normalizedSession.sets.some((nextSet) => nextSet.id === savedSet.id)
          )
        : []

    const syncRows: SyncQueueItemInput[] = [
      ...toSyncRowsFromSession(normalizedSession),
      ...toSoftDeleteRowsFromSets(previousSavedSession || normalizedSession, removedSets, normalizedSession.updatedAt)
    ]

    if (previousSavedSession && previousSavedSession.id !== normalizedSession.id) {
      syncRows.push(...toSoftDeleteRowsFromSession(previousSavedSession, normalizedSession.updatedAt))
    }

    queueForSync(syncRows)

    if (workoutDate < exportFromDate) {
      setExportFromDate(workoutDate)
    }
    if (workoutDate > exportToDate) {
      setExportToDate(workoutDate)
    }

    setMessage('Sesion guardada')
  }

  const deleteSessionForWorkoutDate = () => {
    const sessionToDelete = getLatestSessionForDate(state.sessions, workoutDate)
    if (!sessionToDelete) {
      dispatch({ type: 'clear_draft', date: workoutDate })
      setMessage('No habia sesion guardada para borrar.')
      return
    }

    dispatch({ type: 'delete_session', sessionId: sessionToDelete.id, date: workoutDate })
    queueForSync(toSoftDeleteRowsFromSession(sessionToDelete))
    setMessage('Sesion del dia eliminada.')
  }

  const saveMeasurement = (measurement: MeasurementEntry) => {
    const normalizedMeasurement: MeasurementEntry = {
      ...measurement,
      id: measurement.id || uid(),
      date: measurementDate
    }

    dispatch({
      type: 'upsert_measurement',
      measurement: normalizedMeasurement
    })

    queueForSync(toSyncRowsFromMeasurement(normalizedMeasurement))

    if (measurementDate < exportFromDate) {
      setExportFromDate(measurementDate)
    }
    if (measurementDate > exportToDate) {
      setExportToDate(measurementDate)
    }

    setMessage('Medidas guardadas')
  }

  const upsertObjective = (objective: Objective) => {
    const now = new Date().toISOString()
    const normalizedObjective: Objective = {
      ...objective,
      createdAt: objective.createdAt || now,
      updatedAt: objective.updatedAt || now
    }

    dispatch({ type: 'upsert_objective', objective: normalizedObjective })
    queueForSync(toSyncRowsFromObjective(normalizedObjective))
    setMessage('Objetivo actualizado')
  }

  const upsertTemplate = (template: TrainingTemplateDay) => {
    dispatch({ type: 'upsert_template', template })
    queueForSync(toSyncRowsFromTemplate(template))
    setMessage('Plantilla de entrenamiento actualizada')
  }

  const upsertExercise = (exercise: { id: string; name: string; isCore: boolean }) => {
    dispatch({ type: 'upsert_exercise', exercise })
    setMessage('Catalogo actualizado')
  }

  const isRangeValid = () => {
    if (!exportFromDate || !exportToDate) {
      setMessage('Selecciona un rango valido para exportar.')
      return false
    }

    if (exportFromDate > exportToDate) {
      setMessage('La fecha inicio no puede ser posterior a la fecha fin.')
      return false
    }

    return true
  }

  const onExportBackupJson = () => {
    const result = exportBackupJson(state)
    downloadText(result.content, result.fileName, 'application/json')
    setMessage('Backup JSON exportado')
  }

  const onExportAnalyticsJson = () => {
    if (!isRangeValid()) return

    const result = exportAnalyticsJson(state, exportFromDate, exportToDate)
    downloadText(result.content, result.fileName, 'application/json')
    setMessage('JSON analitico exportado')
  }

  const onExportWorkoutSetsCsv = () => {
    if (!isRangeValid()) return
    const csv = exportWorkoutSetsCsv(state, exportFromDate, exportToDate)
    downloadText(csv, `workout_sets-${exportFromDate}-to-${exportToDate}.csv`, 'text/csv')
    setMessage('CSV workout_sets exportado')
  }

  const onExportWorkoutSessionsCsv = () => {
    if (!isRangeValid()) return
    const csv = exportWorkoutSessionsCsv(state, exportFromDate, exportToDate)
    downloadText(csv, `workout_sessions-${exportFromDate}-to-${exportToDate}.csv`, 'text/csv')
    setMessage('CSV workout_sessions exportado')
  }

  const onExportMeasurementsCsv = () => {
    if (!isRangeValid()) return
    const csv = exportMeasurementsCsv(state, exportFromDate, exportToDate)
    downloadText(csv, `measurements-${exportFromDate}-to-${exportToDate}.csv`, 'text/csv')
    setMessage('CSV measurements exportado')
  }

  const importJson = async (file: File) => {
    const text = await file.text()
    const parsed = JSON.parse(text)
    const imported = normalizeImportedState(parsed)
    dispatch({ type: 'merge_import', incoming: imported })

    if (imported.sessions.length || imported.measurements.length) {
      const range = defaultExportRange(imported)
      setExportFromDate(range.fromDate)
      setExportToDate(range.toDate)
    }

    setMessage('Archivo importado sin duplicados por id y clave compuesta')
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
    dispatch({ type: 'set_notifications', enabled: permission === 'granted' })
    setMessage(permission === 'granted' ? 'Notificaciones activadas' : 'Notificaciones desactivadas')
  }

  const renderActiveTab = () => {
    if (activeTab === 'Dashboard') {
      return <DashboardTab state={state} summary={dashboardSummary} />
    }

    if (activeTab === 'Entreno') {
      return (
        <WorkoutTab
          sessionDate={workoutDate}
          onSessionDateChange={setWorkoutDate}
          sessionDraft={sessionDraft}
          hasSavedSession={Boolean(savedSessionForWorkoutDate)}
          hasUnsavedChanges={hasUnsavedWorkoutChanges}
          allSessions={state.sessions}
          templates={state.trainingTemplates}
          exerciseCatalog={state.exerciseCatalog}
          onSessionDraftChange={updateSessionDraft}
          onSaveSession={saveSession}
          onDeleteSession={deleteSessionForWorkoutDate}
          onAddExercise={upsertExercise}
        />
      )
    }

    if (activeTab === 'Medidas') {
      return (
        <MeasurementsTab
          measurementDate={measurementDate}
          onMeasurementDateChange={setMeasurementDate}
          measurement={measurementDraft}
          history={state.measurements}
          onSaveMeasurement={saveMeasurement}
        />
      )
    }

    if (activeTab === 'Plan') {
      return (
        <PlanTab
          objectives={state.objectives}
          templates={state.trainingTemplates}
          exerciseCatalog={state.exerciseCatalog}
          onUpsertObjective={upsertObjective}
          onDeleteObjective={(objectiveId) => dispatch({ type: 'delete_objective', objectiveId })}
          onUpsertTemplate={upsertTemplate}
          onUpsertExercise={upsertExercise}
        />
      )
    }

    return (
      <ExportTab
        state={state}
        fromDate={exportFromDate}
        toDate={exportToDate}
        syncQueueSize={syncQueueSize}
        hasSyncToken={hasSyncToken}
        onFromDateChange={setExportFromDate}
        onToDateChange={setExportToDate}
        onExportBackupJson={onExportBackupJson}
        onExportAnalyticsJson={onExportAnalyticsJson}
        onExportWorkoutSetsCsv={onExportWorkoutSetsCsv}
        onExportWorkoutSessionsCsv={onExportWorkoutSessionsCsv}
        onExportMeasurementsCsv={onExportMeasurementsCsv}
        onImportJson={importJson}
        onUpdateSheetsSync={updateSheetsSyncSettings}
        onSaveSheetsToken={saveSheetsToken}
        onClearSheetsToken={clearSavedSheetsToken}
        onSyncNow={() => runSheetsSync({ force: false })}
        onRetryPendingSync={() => runSheetsSync({ force: true })}
        onEnqueueBackfillSync={enqueueBackfillForSheets}
        onClearSyncQueue={clearSyncQueue}
      />
    )
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar__row">
          <h1>Health Tracker Pro</h1>
          <button type="button" className="ghost" onClick={setNotificationPermission}>
            {state.settings.notificationsEnabled ? 'Notificaciones on' : 'Notificaciones off'}
          </button>
        </div>

        <div className="topbar__row">
          <span className="status status-info">Schema v{state.version}</span>
          {saveStatus !== 'idle' ? <span className={`save-indicator ${saveStatus}`}>{saveLabel}</span> : null}
        </div>
      </header>

      <main>
        {updateAvailable ? (
          <div className="update-banner">
            <strong>Nueva version disponible</strong>
            <button type="button" onClick={applyAppUpdate}>
              Actualizar ahora
            </button>
          </div>
        ) : null}

        {message ? <div className="message">{message}</div> : null}
        {!loaded ? <div className="card">Cargando estado local...</div> : renderActiveTab()}
      </main>

      <nav className="bottom-nav" aria-label="Navegacion principal">
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
