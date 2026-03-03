import {
  AppState,
  ExerciseCatalogItem,
  MeasurementEntry,
  Objective,
  SheetsSyncSettings,
  TrainingTemplateDay,
  WorkoutSessionLog
} from '../../types'
import { mergeAppStates } from '../../utils/storage'

const nowIso = () => new Date().toISOString()

const sortSessions = (sessions: WorkoutSessionLog[]): WorkoutSessionLog[] => {
  return [...sessions].sort((a, b) => {
    if (a.date === b.date) return b.updatedAt.localeCompare(a.updatedAt)
    return b.date.localeCompare(a.date)
  })
}

const sortTemplateExercises = (template: TrainingTemplateDay): TrainingTemplateDay => {
  return {
    ...template,
    exercises: [...template.exercises]
      .sort((a, b) => a.order - b.order)
      .map((exercise, index) => ({
        ...exercise,
        order: index + 1
      }))
  }
}

const withUpdatedAt = (state: AppState): AppState => ({
  ...state,
  updatedAt: nowIso()
})

export type AppAction =
  | { type: 'replace_state'; state: AppState }
  | { type: 'upsert_session'; session: WorkoutSessionLog; clearDraft?: boolean }
  | { type: 'delete_session'; sessionId: string; date: string }
  | { type: 'upsert_draft'; date: string; session: WorkoutSessionLog }
  | { type: 'clear_draft'; date: string }
  | { type: 'upsert_measurement'; measurement: MeasurementEntry }
  | { type: 'upsert_objective'; objective: Objective }
  | { type: 'delete_objective'; objectiveId: string }
  | { type: 'upsert_template'; template: TrainingTemplateDay }
  | { type: 'upsert_exercise'; exercise: ExerciseCatalogItem }
  | { type: 'merge_import'; incoming: AppState }
  | { type: 'set_notifications'; enabled: boolean }
  | { type: 'update_sheets_sync'; patch: Partial<SheetsSyncSettings> }

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'replace_state':
      return action.state

    case 'upsert_session': {
      const next = [...state.sessions]
      const index = next.findIndex((session) => session.id === action.session.id)
      if (index >= 0) {
        next[index] = action.session
      } else {
        const byDateIndex = next.findIndex((session) => session.date === action.session.date)
        if (byDateIndex >= 0) {
          next[byDateIndex] = action.session
        } else {
          next.push(action.session)
        }
      }

      const nextState: AppState = {
        ...state,
        sessions: sortSessions(next),
        draftByDate: action.clearDraft
          ? Object.fromEntries(
              Object.entries(state.draftByDate).filter(([date]) => date !== action.session.date)
            )
          : state.draftByDate
      }

      return withUpdatedAt(nextState)
    }

    case 'delete_session': {
      return withUpdatedAt({
        ...state,
        sessions: state.sessions.filter((session) => session.id !== action.sessionId),
        draftByDate: Object.fromEntries(Object.entries(state.draftByDate).filter(([date]) => date !== action.date))
      })
    }

    case 'upsert_draft': {
      return withUpdatedAt({
        ...state,
        draftByDate: {
          ...state.draftByDate,
          [action.date]: action.session
        }
      })
    }

    case 'clear_draft': {
      const nextDrafts = { ...state.draftByDate }
      delete nextDrafts[action.date]
      return withUpdatedAt({
        ...state,
        draftByDate: nextDrafts
      })
    }

    case 'upsert_measurement': {
      const existing = state.measurements.find((row) => row.date === action.measurement.date)
      const measurements = existing
        ? state.measurements.map((row) => (row.date === action.measurement.date ? action.measurement : row))
        : [...state.measurements, action.measurement]

      measurements.sort((a, b) => b.date.localeCompare(a.date))
      return withUpdatedAt({ ...state, measurements })
    }

    case 'upsert_objective': {
      const index = state.objectives.findIndex((objective) => objective.id === action.objective.id)
      const objectives = [...state.objectives]

      if (index >= 0) {
        objectives[index] = action.objective
      } else {
        objectives.push(action.objective)
      }

      return withUpdatedAt({ ...state, objectives })
    }

    case 'delete_objective': {
      return withUpdatedAt({
        ...state,
        objectives: state.objectives.filter((objective) => objective.id !== action.objectiveId)
      })
    }

    case 'upsert_template': {
      const index = state.trainingTemplates.findIndex((template) => template.id === action.template.id)
      const nextTemplate = sortTemplateExercises(action.template)
      const templates = [...state.trainingTemplates]

      if (index >= 0) {
        templates[index] = nextTemplate
      } else {
        templates.push(nextTemplate)
      }

      templates.sort((a, b) => a.id.localeCompare(b.id))
      return withUpdatedAt({ ...state, trainingTemplates: templates })
    }

    case 'upsert_exercise': {
      const index = state.exerciseCatalog.findIndex((exercise) => exercise.id === action.exercise.id)
      const exerciseCatalog = [...state.exerciseCatalog]

      if (index >= 0) {
        exerciseCatalog[index] = action.exercise
      } else {
        exerciseCatalog.push(action.exercise)
      }

      exerciseCatalog.sort((a, b) => a.name.localeCompare(b.name))
      return withUpdatedAt({ ...state, exerciseCatalog })
    }

    case 'merge_import': {
      const merged = mergeAppStates(state, action.incoming)
      return withUpdatedAt(merged)
    }

    case 'set_notifications': {
      return withUpdatedAt({
        ...state,
        settings: {
          ...state.settings,
          notificationsEnabled: action.enabled
        }
      })
    }

    case 'update_sheets_sync': {
      return withUpdatedAt({
        ...state,
        settings: {
          ...state.settings,
          sheetsSync: {
            ...state.settings.sheetsSync,
            ...action.patch
          }
        }
      })
    }

    default:
      return state
  }
}
