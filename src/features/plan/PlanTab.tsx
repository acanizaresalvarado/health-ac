import { useMemo, useState } from 'react'
import { ExerciseCatalogItem, Objective, TrainingTemplateDay } from '../../types'
import { uid } from '../../utils/metrics'

type PlanTabProps = {
  objectives: Objective[]
  templates: TrainingTemplateDay[]
  exerciseCatalog: ExerciseCatalogItem[]
  onUpsertObjective: (objective: Objective) => void
  onDeleteObjective: (objectiveId: string) => void
  onUpsertTemplate: (template: TrainingTemplateDay) => void
  onUpsertExercise: (exercise: ExerciseCatalogItem) => void
}

const slugify = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')

export function PlanTab({
  objectives,
  templates,
  exerciseCatalog,
  onUpsertObjective,
  onDeleteObjective,
  onUpsertTemplate,
  onUpsertExercise
}: PlanTabProps) {
  const [activeTemplateId, setActiveTemplateId] = useState<TrainingTemplateDay['id']>('A')

  const [objectiveTitle, setObjectiveTitle] = useState('')
  const [objectiveMetric, setObjectiveMetric] = useState<Objective['metric']>('strength')
  const [objectiveTarget, setObjectiveTarget] = useState('')
  const [objectiveUnit, setObjectiveUnit] = useState<Objective['unit']>('kg')
  const [objectiveDeadline, setObjectiveDeadline] = useState('')
  const [objectiveNotes, setObjectiveNotes] = useState('')

  const [exerciseToAdd, setExerciseToAdd] = useState('')
  const [targetSets, setTargetSets] = useState('')
  const [repRange, setRepRange] = useState('')
  const [rirRange, setRirRange] = useState('')
  const [exerciseNotes, setExerciseNotes] = useState('')

  const [newExerciseName, setNewExerciseName] = useState('')
  const [message, setMessage] = useState('')

  const activeTemplate = useMemo(
    () => templates.find((template) => template.id === activeTemplateId) || templates[0],
    [activeTemplateId, templates]
  )

  const createObjective = () => {
    const title = objectiveTitle.trim()
    if (!title) {
      setMessage('El objetivo necesita un titulo.')
      return
    }

    const targetValue = objectiveTarget === '' ? undefined : Number(objectiveTarget)
    const now = new Date().toISOString()
    const objective: Objective = {
      id: uid(),
      title,
      metric: objectiveMetric,
      targetValue: Number.isFinite(targetValue) ? targetValue : undefined,
      unit: objectiveUnit,
      deadline: objectiveDeadline || undefined,
      status: 'active',
      notes: objectiveNotes || undefined,
      createdAt: now,
      updatedAt: now
    }

    onUpsertObjective(objective)
    setObjectiveTitle('')
    setObjectiveTarget('')
    setObjectiveDeadline('')
    setObjectiveNotes('')
    setMessage('Objetivo creado.')
  }

  const updateObjectiveStatus = (objective: Objective, status: Objective['status']) => {
    onUpsertObjective({
      ...objective,
      status,
      updatedAt: new Date().toISOString()
    })
  }

  const updateTemplateLabel = (label: string) => {
    if (!activeTemplate) return
    onUpsertTemplate({
      ...activeTemplate,
      label
    })
  }

  const addExerciseToTemplate = () => {
    if (!activeTemplate) return
    if (!exerciseToAdd) {
      setMessage('Selecciona un ejercicio para el bloque.')
      return
    }

    const existing = activeTemplate.exercises.some((exercise) => exercise.exerciseId === exerciseToAdd)
    if (existing) {
      setMessage('Ese ejercicio ya esta en el bloque seleccionado.')
      return
    }

    const exerciseName = exerciseCatalog.find((exercise) => exercise.id === exerciseToAdd)?.name || exerciseToAdd
    const parsedSets = Number(targetSets)

    onUpsertTemplate({
      ...activeTemplate,
      exercises: [
        ...activeTemplate.exercises,
        {
          exerciseId: exerciseToAdd,
          name: exerciseName,
          order: activeTemplate.exercises.length + 1,
          targetSets: Number.isFinite(parsedSets) && parsedSets > 0 ? parsedSets : undefined,
          repRange: repRange || undefined,
          rirRange: rirRange || undefined,
          notes: exerciseNotes || undefined
        }
      ]
    })

    setTargetSets('')
    setRepRange('')
    setRirRange('')
    setExerciseNotes('')
    setMessage('Ejercicio anadido al bloque.')
  }

  const removeTemplateExercise = (exerciseId: string) => {
    if (!activeTemplate) return

    onUpsertTemplate({
      ...activeTemplate,
      exercises: activeTemplate.exercises.filter((exercise) => exercise.exerciseId !== exerciseId)
    })
  }

  const addExerciseToCatalog = () => {
    const name = newExerciseName.trim()
    if (!name) {
      setMessage('Escribe el nombre del ejercicio.')
      return
    }

    const exists = exerciseCatalog.some((exercise) => exercise.name.toLowerCase() === name.toLowerCase())
    if (exists) {
      setMessage('Ese ejercicio ya existe en el catalogo.')
      return
    }

    const baseId = slugify(name)
    const id = baseId ? `custom_${baseId}` : `custom_${uid()}`

    onUpsertExercise({
      id,
      name,
      isCore: false
    })

    setNewExerciseName('')
    setExerciseToAdd(id)
    setMessage('Ejercicio anadido al catalogo.')
  }

  return (
    <div className="section">
      <div className="section-intro">
        <h2>Plan</h2>
        <p className="muted">Configura objetivos, bloques y catalogo desde la app</p>
      </div>

      <div className="card">
        <h3>Objetivos</h3>

        <div className="grid grid-2">
          <label>
            Titulo
            <input value={objectiveTitle} onChange={(event) => setObjectiveTitle(event.target.value)} />
          </label>
          <label>
            Metrica
            <select
              value={objectiveMetric}
              onChange={(event) => setObjectiveMetric(event.target.value as Objective['metric'])}
            >
              <option value="strength">strength</option>
              <option value="waist">waist</option>
              <option value="weight">weight</option>
              <option value="consistency">consistency</option>
              <option value="custom">custom</option>
            </select>
          </label>
        </div>

        <div className="grid grid-3">
          <label>
            Target
            <input type="number" step="0.1" value={objectiveTarget} onChange={(event) => setObjectiveTarget(event.target.value)} />
          </label>
          <label>
            Unidad
            <select value={objectiveUnit} onChange={(event) => setObjectiveUnit(event.target.value as Objective['unit'])}>
              <option value="kg">kg</option>
              <option value="cm">cm</option>
              <option value="%">%</option>
              <option value="sessions">sessions</option>
              <option value="custom">custom</option>
            </select>
          </label>
          <label>
            Fecha limite
            <input type="date" value={objectiveDeadline} onChange={(event) => setObjectiveDeadline(event.target.value)} />
          </label>
        </div>

        <label>
          Notas
          <textarea value={objectiveNotes} onChange={(event) => setObjectiveNotes(event.target.value)} />
        </label>

        <button type="button" className="primary" onClick={createObjective}>
          Crear objetivo
        </button>

        {objectives.length ? (
          <ul className="history-list">
            {objectives.map((objective) => (
              <li key={objective.id}>
                <strong>{objective.title}</strong>
                <div>
                  {objective.metric}
                  {objective.targetValue != null ? ` · ${objective.targetValue} ${objective.unit || ''}` : ''}
                  {objective.deadline ? ` · ${objective.deadline}` : ''}
                </div>

                <div className="button-row">
                  <button type="button" className="ghost" onClick={() => updateObjectiveStatus(objective, 'active')}>
                    active
                  </button>
                  <button type="button" className="ghost" onClick={() => updateObjectiveStatus(objective, 'paused')}>
                    paused
                  </button>
                  <button type="button" className="ghost" onClick={() => updateObjectiveStatus(objective, 'done')}>
                    done
                  </button>
                  <button type="button" className="remove-button" onClick={() => onDeleteObjective(objective.id)}>
                    borrar
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="empty">No hay objetivos creados.</div>
        )}
      </div>

      <div className="card">
        <h3>Bloques de entrenamiento</h3>

        <div className="split-row">
          <label>
            Bloque
            <select
              value={activeTemplateId}
              onChange={(event) => setActiveTemplateId(event.target.value as TrainingTemplateDay['id'])}
            >
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.id} - {template.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Nombre del bloque
            <input value={activeTemplate?.label || ''} onChange={(event) => updateTemplateLabel(event.target.value)} />
          </label>
        </div>

        <h4>Ejercicios del bloque</h4>
        {activeTemplate?.exercises.length ? (
          <ul className="history-list">
            {activeTemplate.exercises
              .sort((a, b) => a.order - b.order)
              .map((exercise) => (
                <li key={exercise.exerciseId}>
                  <strong>{exercise.name}</strong>
                  <div>
                    {exercise.targetSets ? `${exercise.targetSets} sets` : 'sets libres'}
                    {exercise.repRange ? ` · reps ${exercise.repRange}` : ''}
                    {exercise.rirRange ? ` · RIR ${exercise.rirRange}` : ''}
                  </div>
                  <button type="button" className="remove-button" onClick={() => removeTemplateExercise(exercise.exerciseId)}>
                    Quitar
                  </button>
                </li>
              ))}
          </ul>
        ) : (
          <div className="empty">Este bloque aun no tiene ejercicios.</div>
        )}

        <h4>Anadir ejercicio al bloque</h4>
        <label>
          Ejercicio
          <select value={exerciseToAdd} onChange={(event) => setExerciseToAdd(event.target.value)}>
            <option value="">Seleccionar...</option>
            {exerciseCatalog.map((exercise) => (
              <option key={exercise.id} value={exercise.id}>
                {exercise.name}
              </option>
            ))}
          </select>
        </label>

        <div className="grid grid-3">
          <label>
            Sets objetivo
            <input type="number" min="0" value={targetSets} onChange={(event) => setTargetSets(event.target.value)} />
          </label>
          <label>
            Rango reps
            <input value={repRange} onChange={(event) => setRepRange(event.target.value)} placeholder="6-10" />
          </label>
          <label>
            Rango RIR
            <input value={rirRange} onChange={(event) => setRirRange(event.target.value)} placeholder="1-3" />
          </label>
        </div>

        <label>
          Notas
          <textarea value={exerciseNotes} onChange={(event) => setExerciseNotes(event.target.value)} />
        </label>

        <button type="button" className="primary" onClick={addExerciseToTemplate}>
          Anadir al bloque
        </button>
      </div>

      <div className="card">
        <h3>Catalogo de ejercicios</h3>

        <div className="split-row">
          <label>
            Nuevo ejercicio
            <input value={newExerciseName} onChange={(event) => setNewExerciseName(event.target.value)} />
          </label>
          <button type="button" className="primary" onClick={addExerciseToCatalog}>
            Guardar en catalogo
          </button>
        </div>

        <ul className="history-list">
          {exerciseCatalog.map((exercise) => (
            <li key={exercise.id}>
              <strong>{exercise.name}</strong>
              <div>{exercise.id}</div>
            </li>
          ))}
        </ul>
      </div>

      {message ? <div className="message">{message}</div> : null}
    </div>
  )
}
