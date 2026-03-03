import { ChangeEvent, useState } from 'react'
import { AppState, SheetsSyncSettings } from '../../types'

type SyncRunResult = {
  ok: boolean
  pending: number
  sent: number
  failed: number
  error?: string
}

type ExportTabProps = {
  state: AppState
  fromDate: string
  toDate: string
  syncQueueSize: number
  hasSyncToken: boolean
  onFromDateChange: (date: string) => void
  onToDateChange: (date: string) => void
  onExportBackupJson: () => void
  onExportAnalyticsJson: () => void
  onExportWorkoutSetsCsv: () => void
  onExportWorkoutSessionsCsv: () => void
  onExportMeasurementsCsv: () => void
  onImportJson: (file: File) => Promise<void>
  onUpdateSheetsSync: (patch: Partial<SheetsSyncSettings>) => void
  onSaveSheetsToken: (token: string) => void
  onClearSheetsToken: () => void
  onSyncNow: () => Promise<SyncRunResult>
  onRetryPendingSync: () => Promise<SyncRunResult>
  onEnqueueBackfillSync: () => void
  onClearSyncQueue: () => void
}

export function ExportTab({
  state,
  fromDate,
  toDate,
  syncQueueSize,
  hasSyncToken,
  onFromDateChange,
  onToDateChange,
  onExportBackupJson,
  onExportAnalyticsJson,
  onExportWorkoutSetsCsv,
  onExportWorkoutSessionsCsv,
  onExportMeasurementsCsv,
  onImportJson,
  onUpdateSheetsSync,
  onSaveSheetsToken,
  onClearSheetsToken,
  onSyncNow,
  onRetryPendingSync,
  onEnqueueBackfillSync,
  onClearSyncQueue
}: ExportTabProps) {
  const [message, setMessage] = useState('')
  const [syncBusy, setSyncBusy] = useState(false)
  const [tokenDraft, setTokenDraft] = useState('')
  const sheetsSync = state.settings.sheetsSync
  const baseUrl = (import.meta.env.BASE_URL || '/') as string
  const baseNoTrailingSlash = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl
  const defaultBackendEndpoint = `${baseNoTrailingSlash}/api/sheets-sync`.replace(/\/{2,}/g, '/')

  const handleSync = async (mode: 'normal' | 'retry') => {
    setSyncBusy(true)
    try {
      const result = mode === 'retry' ? await onRetryPendingSync() : await onSyncNow()
      if (result.ok) {
        setMessage(
          result.sent > 0
            ? `Sync OK: ${result.sent} enviados, ${result.pending} pendientes.`
            : `Sync sin envios: ${result.pending} pendientes.`
        )
      } else {
        setMessage(result.error || 'No se pudo completar la sincronizacion.')
      }
    } finally {
      setSyncBusy(false)
    }
  }

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    try {
      await onImportJson(file)
      setMessage('Importacion completada.')
    } catch {
      setMessage('No se pudo importar el archivo.')
    } finally {
      event.target.value = ''
    }
  }

  const saveToken = () => {
    if (sheetsSync.mode !== 'direct_webhook') {
      setMessage('En modo backend no necesitas token en frontend.')
      return
    }

    const token = tokenDraft.trim()
    if (!token) {
      setMessage('Pega el token de escritura antes de guardar.')
      return
    }
    onSaveSheetsToken(token)
    setTokenDraft('')
    setMessage('Token guardado localmente (oculto).')
  }

  const clearToken = () => {
    if (sheetsSync.mode !== 'direct_webhook') {
      setMessage('No hay token local en modo backend.')
      return
    }

    onClearSheetsToken()
    setTokenDraft('')
    setMessage('Token eliminado.')
  }

  const statusLabel =
    sheetsSync.lastSyncStatus === 'syncing'
      ? 'Sincronizando'
      : sheetsSync.lastSyncStatus === 'success'
        ? 'OK'
        : sheetsSync.lastSyncStatus === 'error'
          ? 'Error'
          : 'Idle'

  return (
    <div className="section">
      <div className="section-intro">
        <h2>Exportar</h2>
        <p className="muted">Datos listos para backup y dashboard futuro</p>
      </div>

      <div className="card">
        <h3>Rango de export analitico</h3>
        <div className="split-row">
          <label>
            Desde
            <input type="date" value={fromDate} onChange={(event) => onFromDateChange(event.target.value)} />
          </label>
          <label>
            Hasta
            <input type="date" value={toDate} onChange={(event) => onToDateChange(event.target.value)} />
          </label>
        </div>
      </div>

      <div className="card">
        <h3>Exportaciones</h3>
        <div className="button-col">
          <button type="button" className="primary" onClick={onExportBackupJson}>
            Exportar backup JSON completo
          </button>
          <button type="button" className="ghost" onClick={onExportAnalyticsJson}>
            Exportar JSON analitico (rango)
          </button>
          <button type="button" className="ghost" onClick={onExportWorkoutSetsCsv}>
            Exportar CSV workout_sets
          </button>
          <button type="button" className="ghost" onClick={onExportWorkoutSessionsCsv}>
            Exportar CSV workout_sessions
          </button>
          <button type="button" className="ghost" onClick={onExportMeasurementsCsv}>
            Exportar CSV measurements
          </button>
        </div>
      </div>

      <div className="card">
        <h3>Importar backup JSON</h3>
        <label className="file-label">
          Seleccionar archivo
          <input type="file" accept="application/json" onChange={handleImport} />
        </label>
      </div>

      <div className="card">
        <h3>Google Sheets Sync</h3>

        <label>
          Modo de sync
          <select
            value={sheetsSync.mode}
            onChange={(event) => {
              const mode = event.target.value as SheetsSyncSettings['mode']
              const patch: Partial<SheetsSyncSettings> = { mode }

              if (mode === 'backend_proxy') {
                const looksDirectWebhook = sheetsSync.endpointUrl.includes('script.google.com/macros')
                if (!sheetsSync.endpointUrl.trim() || looksDirectWebhook) {
                  patch.endpointUrl = defaultBackendEndpoint
                }
              } else {
                const looksLocalApi =
                  sheetsSync.endpointUrl.trim() === '/api/sheets-sync' ||
                  sheetsSync.endpointUrl.trim() === defaultBackendEndpoint
                if (looksLocalApi) {
                  patch.endpointUrl = ''
                }
              }

              onUpdateSheetsSync(patch)
            }}
          >
            <option value="backend_proxy">Backend proxy (recomendado)</option>
            <option value="direct_webhook">Directo a Apps Script (avanzado)</option>
          </select>
        </label>

        <label className="checkbox-row">
          <span>Habilitar sync</span>
          <input
            type="checkbox"
            checked={sheetsSync.enabled}
            onChange={(event) => onUpdateSheetsSync({ enabled: event.target.checked })}
          />
        </label>

        <label className="checkbox-row">
          <span>Auto-sync al guardar</span>
          <input
            type="checkbox"
            checked={sheetsSync.autoSyncOnSave}
            onChange={(event) => onUpdateSheetsSync({ autoSyncOnSave: event.target.checked })}
            disabled={!sheetsSync.enabled}
          />
        </label>

        <label>
          {sheetsSync.mode === 'backend_proxy' ? 'Endpoint backend' : 'Endpoint Webhook'}
          <input
            type="text"
            value={sheetsSync.endpointUrl}
            onChange={(event) => onUpdateSheetsSync({ endpointUrl: event.target.value })}
            placeholder={
              sheetsSync.mode === 'backend_proxy'
                ? `${defaultBackendEndpoint} o https://tu-backend.com/api/sheets-sync`
                : 'https://script.google.com/macros/s/.../exec'
            }
          />
        </label>

        {sheetsSync.mode === 'direct_webhook' ? (
          <>
            <label>
              Token de escritura
              <input
                type="password"
                value={tokenDraft}
                onChange={(event) => setTokenDraft(event.target.value)}
                placeholder={hasSyncToken ? 'Token guardado (oculto)' : 'Pega token y guarda'}
              />
            </label>

            <div className="button-row">
              <button type="button" className="ghost" onClick={saveToken}>
                Guardar token
              </button>
              <button type="button" className="ghost" onClick={clearToken} disabled={!hasSyncToken}>
                Borrar token
              </button>
            </div>
          </>
        ) : (
          <p className="muted">El token se gestiona en el backend. No necesitas guardarlo en el navegador.</p>
        )}

        <div className="button-col">
          <button type="button" className="primary" onClick={() => void handleSync('normal')} disabled={syncBusy}>
            Sincronizar ahora
          </button>
          <button type="button" className="ghost" onClick={() => void handleSync('retry')} disabled={syncBusy}>
            Reintentar pendientes
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => {
              onEnqueueBackfillSync()
              setMessage('Backfill encolado.')
            }}
          >
            Encolar backfill completo
          </button>
          <button
            type="button"
            className="remove-button"
            onClick={() => {
              onClearSyncQueue()
              setMessage('Cola de sincronizacion limpiada.')
            }}
          >
            Limpiar cola sync
          </button>
        </div>

        <p>Pendientes: {syncQueueSize}</p>
        <p>Token: {sheetsSync.mode === 'backend_proxy' ? 'Gestionado por backend' : hasSyncToken ? 'Configurado' : 'No configurado'}</p>
        <p>Estado: {statusLabel}</p>
        <p>Ultimo sync: {sheetsSync.lastSyncAt ? sheetsSync.lastSyncAt : 'Nunca'}</p>
        {sheetsSync.lastSyncError ? <p className="muted">Error: {sheetsSync.lastSyncError}</p> : null}
      </div>

      <div className="card">
        <h3>Resumen local</h3>
        <p>Schema: v{state.version}</p>
        <p>Sesiones: {state.sessions.length}</p>
        <p>Series totales: {state.sessions.reduce((sum, session) => sum + session.sets.length, 0)}</p>
        <p>Medidas: {state.measurements.length}</p>
        <p>Objetivos: {state.objectives.length}</p>
        <p>Borradores diarios: {Object.keys(state.draftByDate || {}).length}</p>
      </div>

      {message ? <div className="message">{message}</div> : null}
    </div>
  )
}
