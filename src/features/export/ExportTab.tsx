import { ChangeEvent, useState } from 'react'
import { AppState } from '../../types'

type ExportTabProps = {
  state: AppState
  fromDate: string
  toDate: string
  onFromDateChange: (date: string) => void
  onToDateChange: (date: string) => void
  onExportBackupJson: () => void
  onExportAnalyticsJson: () => void
  onExportWorkoutSetsCsv: () => void
  onExportWorkoutSessionsCsv: () => void
  onExportMeasurementsCsv: () => void
  onImportJson: (file: File) => Promise<void>
}

export function ExportTab({
  state,
  fromDate,
  toDate,
  onFromDateChange,
  onToDateChange,
  onExportBackupJson,
  onExportAnalyticsJson,
  onExportWorkoutSetsCsv,
  onExportWorkoutSessionsCsv,
  onExportMeasurementsCsv,
  onImportJson
}: ExportTabProps) {
  const [message, setMessage] = useState('')

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
