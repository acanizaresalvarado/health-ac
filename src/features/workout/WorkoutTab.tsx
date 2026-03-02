import { useEffect, useMemo, useState } from 'react'
import { ExerciseCatalogItem, TrainingTemplateDay, WorkoutSessionLog } from '../../types'
import { getSessionSummary, normalizeSetNumbers, uid } from '../../utils/metrics'

type WorkoutTabProps = {
  sessionDate: string
  onSessionDateChange: (date: string) => void
  sessionDraft: WorkoutSessionLog
  allSessions: WorkoutSessionLog[]
  templates: TrainingTemplateDay[]
  exerciseCatalog: ExerciseCatalogItem[]
  onSessionDraftChange: (session: WorkoutSessionLog) => void
  onSaveSession: (session: WorkoutSessionLog) => void
  onAddExercise: (exercise: ExerciseCatalogItem) => void
}

const toNumber = (value: string): number => {
  const parsed = Number(value.replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : 0
}

const slugify = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')

const workoutRowsSort = (a: { exerciseId: string; setNumber: number }, b: { exerciseId: string; setNumber: number }) => {
  if (a.exerciseId === b.exerciseId) return a.setNumber - b.setNumber
  return a.exerciseId.localeCompare(b.exerciseId)
}

export function WorkoutTab({
  sessionDate,
  onSessionDateChange,
  sessionDraft,
  allSessions,
  templates,
  exerciseCatalog,
  onSessionDraftChange,
  onSaveSession,
  onAddExercise
}: WorkoutTabProps) {
  const [exerciseId, setExerciseId] = useState('')
  const [reps, setReps] = useState('')
  const [weightKg, setWeightKg] = useState('')
  const [rir, setRir] = useState('')
  const [isWarmup, setIsWarmup] = useState(false)
  const [customExerciseName, setCustomExerciseName] = useState('')
  const [localMessage, setLocalMessage] = useState('')

  useEffect(() => {
    if (exerciseId) return
    const fallback = exerciseCatalog[0]?.id || ''
    setExerciseId(fallback)
  }, [exerciseCatalog, exerciseId])

  const activeTemplate = useMemo(
    () => templates.find((template) => template.id === sessionDraft.templateDayId) || templates[0],
    [templates, sessionDraft.templateDayId]
  )

  const summary = useMemo(() => getSessionSummary(sessionDraft), [sessionDraft])

  const updateSession = (next: WorkoutSessionLog) => {
    onSessionDraftChange({
      ...next,
      updatedAt: new Date().toISOString()
    })
  }

  const addSet = () => {
    if (!exerciseId) {
      setLocalMessage('Selecciona un ejercicio.')
      return
    }

    const repsValue = toNumber(reps)
    const weightValue = toNumber(weightKg)
    if (repsValue <= 0 || weightValue <= 0) {
      setLocalMessage('Reps y kg deben ser mayores que cero.')
      return
    }

    const setNumber = sessionDraft.sets.filter((set) => set.exerciseId === exerciseId).length + 1
    const next = {
      ...sessionDraft,
      sets: [
        ...sessionDraft.sets,
        {
          id: uid(),
          exerciseId,
          setNumber,
          reps: repsValue,
          weightKg: weightValue,
          rir: rir === '' ? undefined : toNumber(rir),
          isWarmup
        }
      ]
    }

    updateSession(next)
    setLocalMessage('Serie guardada en borrador.')
  }

  const copyLastSet = () => {
    if (!exerciseId) return

    const ordered = [...allSessions]
      .sort((a, b) => {
        if (a.date === b.date) return b.updatedAt.localeCompare(a.updatedAt)
        return b.date.localeCompare(a.date)
      })
      .flatMap((session) => session.sets)
      .filter((set) => set.exerciseId === exerciseId)

    const candidate = ordered[0]
    if (!candidate) {
      setLocalMessage('No hay series previas para este ejercicio.')
      return
    }

    setReps(String(candidate.reps))
    setWeightKg(String(candidate.weightKg))
    setRir(candidate.rir == null ? '' : String(candidate.rir))
    setIsWarmup(Boolean(candidate.isWarmup))
    setLocalMessage('Ultima serie copiada en el formulario.')
  }

  const updateSetField = (setId: string, field: 'reps' | 'weightKg' | 'rir' | 'isWarmup', value: string | boolean) => {
    const sets = sessionDraft.sets.map((set) => {
      if (set.id !== setId) return set

      if (field === 'isWarmup') {
        return { ...set, isWarmup: Boolean(value) }
      }

      if (field === 'rir') {
        const text = String(value)
        return { ...set, rir: text === '' ? undefined : toNumber(text) }
      }

      return { ...set, [field]: toNumber(String(value)) }
    })

    updateSession({
      ...sessionDraft,
      sets: normalizeSetNumbers(sets)
    })
  }

  const removeSet = (setId: string) => {
    const sets = sessionDraft.sets.filter((set) => set.id !== setId)
    updateSession({
      ...sessionDraft,
      sets: normalizeSetNumbers(sets)
    })
  }

  const addCustomExercise = () => {
    const name = customExerciseName.trim()
    if (!name) {
      setLocalMessage('Escribe el nombre del ejercicio.')
      return
    }

    const existingByName = exerciseCatalog.find(
      (exercise) => exercise.name.trim().toLowerCase() === name.toLowerCase()
    )

    if (existingByName) {
      setExerciseId(existingByName.id)
      setCustomExerciseName('')
      setLocalMessage('Ese ejercicio ya existia. Lo seleccionamos para ti.')
      return
    }

    const baseId = slugify(name)
    const candidate = baseId ? `custom_${baseId}` : `custom_${uid()}`
    let nextId = candidate
    let suffix = 2
    const usedIds = new Set(exerciseCatalog.map((exercise) => exercise.id))

    while (usedIds.has(nextId)) {
      nextId = `${candidate}_${suffix}`
      suffix += 1
    }

    onAddExercise({
      id: nextId,
      name,
      isCore: false
    })

    setExerciseId(nextId)
    setCustomExerciseName('')
    setLocalMessage('Ejercicio añadido al catalogo y seleccionado.')
  }

  const templateExercises = activeTemplate?.exercises || []
  const plannedIds = new Set(templateExercises.map((exercise) => exercise.exerciseId))
  const doneIds = new Set(sessionDraft.sets.map((set) => set.exerciseId))

  return (
    <div className="section">
      <div className="section-intro">
        <h2>Entreno</h2>
        <p className="muted">Registro por serie con foco en progresion real</p>
      </div>

      <div className="card">
        <div className="split-row">
          <label>
            Fecha
            <input type="date" value={sessionDate} onChange={(event) => onSessionDateChange(event.target.value)} />
          </label>
          <label>
            Bloque
            <select
              value={sessionDraft.templateDayId}
              onChange={(event) =>
                updateSession({
                  ...sessionDraft,
                  templateDayId: event.target.value
                })
              }
            >
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label>
          Nota de sesion
          <textarea
            value={sessionDraft.notes || ''}
            onChange={(event) => updateSession({ ...sessionDraft, notes: event.target.value })}
            placeholder="Objetivo de hoy, sensaciones, ajustes..."
          />
        </label>
      </div>

      <div className="card">
        <h3>Plan del bloque</h3>
        {templateExercises.length ? (
          <ul className="history-list">
            {templateExercises
              .sort((a, b) => a.order - b.order)
              .map((exercise) => (
                <li key={exercise.exerciseId} className={doneIds.has(exercise.exerciseId) ? 'ok-border' : ''}>
                  <strong>{exercise.name}</strong>
                  <div>
                    {doneIds.has(exercise.exerciseId) ? 'Completado hoy' : 'Pendiente'}
                    {exercise.targetSets ? ` · ${exercise.targetSets} sets` : ''}
                    {exercise.repRange ? ` · ${exercise.repRange} reps` : ''}
                    {exercise.rirRange ? ` · RIR ${exercise.rirRange}` : ''}
                  </div>
                </li>
              ))}
          </ul>
        ) : (
          <div className="empty">No hay ejercicios en este bloque. Añadelos en la pestaña Plan.</div>
        )}
      </div>

      <div className="card">
        <h3>Nueva serie</h3>
        <label>
          Ejercicio
          <select value={exerciseId} onChange={(event) => setExerciseId(event.target.value)}>
            {exerciseCatalog.map((exercise) => (
              <option key={exercise.id} value={exercise.id}>
                {exercise.name}{plannedIds.has(exercise.id) ? ' (plan)' : ''}
              </option>
            ))}
          </select>
        </label>

        <label>
          Nuevo ejercicio rapido
          <div className="button-row">
            <input
              type="text"
              value={customExerciseName}
              onChange={(event) => setCustomExerciseName(event.target.value)}
              placeholder="Ej. Press militar mancuernas"
            />
            <button type="button" className="ghost" onClick={addCustomExercise}>
              Guardar
            </button>
          </div>
        </label>

        <div className="split-row">
          <label>
            Reps
            <input type="number" min="0" value={reps} onChange={(event) => setReps(event.target.value)} />
          </label>
          <label>
            Kg
            <input type="number" min="0" step="0.1" value={weightKg} onChange={(event) => setWeightKg(event.target.value)} />
          </label>
        </div>

        <div className="split-row">
          <label>
            RIR
            <input type="number" min="0" step="1" value={rir} onChange={(event) => setRir(event.target.value)} />
          </label>
          <label className="checkbox-row">
            <span>Warmup</span>
            <input type="checkbox" checked={isWarmup} onChange={(event) => setIsWarmup(event.target.checked)} />
          </label>
        </div>

        <div className="button-row">
          <button type="button" className="primary" onClick={addSet}>
            Guardar serie
          </button>
          <button type="button" className="ghost" onClick={copyLastSet}>
            Copiar ultimo set
          </button>
        </div>
        {localMessage ? <div className="message">{localMessage}</div> : null}
      </div>

      <div className="card">
        <h3>Series registradas</h3>
        {sessionDraft.sets.length ? (
          <ul className="history-list">
            {[...sessionDraft.sets].sort(workoutRowsSort).map((set) => (
              <li key={set.id}>
                <strong>
                  {exerciseCatalog.find((exercise) => exercise.id === set.exerciseId)?.name || set.exerciseId} · Serie {set.setNumber}
                </strong>

                <div className="split-row">
                  <label>
                    Reps
                    <input
                      type="number"
                      min="0"
                      value={set.reps}
                      onChange={(event) => updateSetField(set.id, 'reps', event.target.value)}
                    />
                  </label>
                  <label>
                    Kg
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      value={set.weightKg}
                      onChange={(event) => updateSetField(set.id, 'weightKg', event.target.value)}
                    />
                  </label>
                </div>

                <div className="split-row">
                  <label>
                    RIR
                    <input
                      type="number"
                      min="0"
                      value={set.rir ?? ''}
                      onChange={(event) => updateSetField(set.id, 'rir', event.target.value)}
                    />
                  </label>
                  <label className="checkbox-row">
                    <span>Warmup</span>
                    <input
                      type="checkbox"
                      checked={set.isWarmup}
                      onChange={(event) => updateSetField(set.id, 'isWarmup', event.target.checked)}
                    />
                  </label>
                </div>

                <button type="button" className="remove-button" onClick={() => removeSet(set.id)}>
                  Quitar serie
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="empty">Sin series aun para esta fecha.</div>
        )}
      </div>

      <div className="card">
        <h3>Resumen de sesion</h3>
        <div className="grid grid-3">
          <div className="stat-item">
            <span>Sets efectivos</span>
            <strong>{summary.totalSets}</strong>
          </div>
          <div className="stat-item">
            <span>Volumen</span>
            <strong>{summary.totalVolume.toFixed(2)} kg</strong>
          </div>
          <div className="stat-item">
            <span>Top set</span>
            <strong>
              {summary.topSet
                ? `${summary.topSet.weightKg}x${summary.topSet.reps} (e1RM ${summary.topSet.estimated1Rm.toFixed(2)})`
                : '--'}
            </strong>
          </div>
        </div>

        <button type="button" className="primary" onClick={() => onSaveSession(sessionDraft)}>
          Guardar sesion
        </button>
      </div>
    </div>
  )
}
