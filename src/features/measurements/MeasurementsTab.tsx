import { useEffect, useState } from 'react'
import { MeasurementEntry } from '../../types'

type MeasurementsTabProps = {
  measurementDate: string
  onMeasurementDateChange: (date: string) => void
  measurement: MeasurementEntry
  history: MeasurementEntry[]
  onSaveMeasurement: (measurement: MeasurementEntry) => void
}

type MeasurementField = keyof Omit<MeasurementEntry, 'id' | 'date'>
type MeasurementForm = Record<MeasurementField, string>

const emptyForm: MeasurementForm = {
  weightKg: '',
  waistCm: '',
  lumbarPain: '',
  steps: '',
  sleepHours: '',
  chestCm: '',
  shouldersCm: '',
  armCm: '',
  hipsCm: ''
}

const toForm = (entry: MeasurementEntry): MeasurementForm => ({
  weightKg: entry.weightKg == null ? '' : String(entry.weightKg),
  waistCm: entry.waistCm == null ? '' : String(entry.waistCm),
  lumbarPain: entry.lumbarPain == null ? '' : String(entry.lumbarPain),
  steps: entry.steps == null ? '' : String(entry.steps),
  sleepHours: entry.sleepHours == null ? '' : String(entry.sleepHours),
  chestCm: entry.chestCm == null ? '' : String(entry.chestCm),
  shouldersCm: entry.shouldersCm == null ? '' : String(entry.shouldersCm),
  armCm: entry.armCm == null ? '' : String(entry.armCm),
  hipsCm: entry.hipsCm == null ? '' : String(entry.hipsCm)
})

const parseDecimalInput = (value: string): number | undefined => {
  const normalized = value.trim().replace(',', '.')
  if (!normalized) return undefined
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : undefined
}

const isValidDecimalInput = (value: string): boolean => {
  if (value === '') return true
  return /^\d*([.,]\d*)?$/.test(value)
}

const clampPain = (value: number | undefined): number | undefined => {
  if (value == null || Number.isNaN(value)) return undefined
  return Math.min(10, Math.max(0, value))
}

export function MeasurementsTab({
  measurementDate,
  onMeasurementDateChange,
  measurement,
  history,
  onSaveMeasurement
}: MeasurementsTabProps) {
  const [form, setForm] = useState<MeasurementForm>(emptyForm)
  const [message, setMessage] = useState('')

  useEffect(() => {
    setForm(toForm(measurement))
  }, [measurement])

  const updateField = (field: MeasurementField, value: string) => {
    if (!isValidDecimalInput(value)) return
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  const save = () => {
    const payload: MeasurementEntry = {
      ...measurement,
      date: measurementDate,
      weightKg: parseDecimalInput(form.weightKg),
      waistCm: parseDecimalInput(form.waistCm),
      lumbarPain: clampPain(parseDecimalInput(form.lumbarPain)),
      steps: parseDecimalInput(form.steps),
      sleepHours: parseDecimalInput(form.sleepHours),
      chestCm: parseDecimalInput(form.chestCm),
      shouldersCm: parseDecimalInput(form.shouldersCm),
      armCm: parseDecimalInput(form.armCm),
      hipsCm: parseDecimalInput(form.hipsCm)
    }

    onSaveMeasurement(payload)
    setMessage('Medidas guardadas.')
  }

  return (
    <div className="section">
      <div className="section-intro">
        <h2>Medidas</h2>
        <p className="muted">Registro por fecha para comparativas reales</p>
      </div>

      <div className="card">
        <label>
          Fecha de medicion
          <input type="date" value={measurementDate} onChange={(event) => onMeasurementDateChange(event.target.value)} />
        </label>

        <div className="split-row">
          <label>
            Peso (kg)
            <input type="text" inputMode="decimal" value={form.weightKg} onChange={(event) => updateField('weightKg', event.target.value)} />
          </label>
          <label>
            Cintura (cm)
            <input type="text" inputMode="decimal" value={form.waistCm} onChange={(event) => updateField('waistCm', event.target.value)} />
          </label>
        </div>

        <div className="split-row">
          <label>
            Dolor lumbar (0-10)
            <input
              type="text"
              inputMode="decimal"
              value={form.lumbarPain}
              onChange={(event) => updateField('lumbarPain', event.target.value)}
            />
          </label>
          <label>
            Pasos
            <input type="text" inputMode="decimal" value={form.steps} onChange={(event) => updateField('steps', event.target.value)} />
          </label>
        </div>

        <div className="split-row">
          <label>
            Sueno (h)
            <input
              type="text"
              inputMode="decimal"
              value={form.sleepHours}
              onChange={(event) => updateField('sleepHours', event.target.value)}
            />
          </label>
          <label>
            Pecho (cm)
            <input type="text" inputMode="decimal" value={form.chestCm} onChange={(event) => updateField('chestCm', event.target.value)} />
          </label>
        </div>

        <div className="split-row">
          <label>
            Hombros (cm)
            <input
              type="text"
              inputMode="decimal"
              value={form.shouldersCm}
              onChange={(event) => updateField('shouldersCm', event.target.value)}
            />
          </label>
          <label>
            Brazo (cm)
            <input type="text" inputMode="decimal" value={form.armCm} onChange={(event) => updateField('armCm', event.target.value)} />
          </label>
        </div>

        <div className="split-row">
          <label>
            Cadera (cm)
            <input type="text" inputMode="decimal" value={form.hipsCm} onChange={(event) => updateField('hipsCm', event.target.value)} />
          </label>
        </div>

        <button type="button" className="primary" onClick={save}>
          Guardar medidas
        </button>
        {message ? <div className="message">{message}</div> : null}
      </div>

      <div className="card">
        <h3>Historial</h3>
        {history.length ? (
          <ul className="history-list">
            {history.map((row) => (
              <li key={row.id}>
                <strong>{row.date}</strong>
                <div>
                  peso: {row.weightKg != null ? `${row.weightKg} kg` : '--'} · cintura:{' '}
                  {row.waistCm != null ? `${row.waistCm} cm` : '--'} · dolor:{' '}
                  {row.lumbarPain != null ? row.lumbarPain : '--'}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="empty">No hay medidas registradas.</div>
        )}
      </div>
    </div>
  )
}
