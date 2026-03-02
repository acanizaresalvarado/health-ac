import { WorkoutSessionLog, WorkoutSetLog } from '../types'

export type TopSetSummary = {
  exerciseId: string
  reps: number
  weightKg: number
  rir?: number
  estimated1Rm: number
}

export const estimateE1Rm = (weightKg: number, reps: number): number => {
  if (!Number.isFinite(weightKg) || !Number.isFinite(reps) || weightKg <= 0 || reps <= 0) {
    return 0
  }

  // Epley formula. For very high reps this is still only indicative.
  const e1rm = weightKg * (1 + reps / 30)
  return Number(e1rm.toFixed(2))
}

export const getSetVolume = (set: WorkoutSetLog): number => {
  if (!Number.isFinite(set.reps) || !Number.isFinite(set.weightKg)) return 0
  const volume = set.reps * set.weightKg
  return Number(volume.toFixed(2))
}

export const getSessionVolume = (session: WorkoutSessionLog, includeWarmups = false): number => {
  const volume = session.sets.reduce((sum, set) => {
    if (!includeWarmups && set.isWarmup) return sum
    return sum + getSetVolume(set)
  }, 0)

  return Number(volume.toFixed(2))
}

export const getSessionTopSet = (session: WorkoutSessionLog): TopSetSummary | null => {
  const workingSets = session.sets.filter((set) => !set.isWarmup)
  if (!workingSets.length) return null

  let top: TopSetSummary | null = null
  workingSets.forEach((set) => {
    const estimate = estimateE1Rm(set.weightKg, set.reps)
    if (!top || estimate > top.estimated1Rm) {
      top = {
        exerciseId: set.exerciseId,
        reps: set.reps,
        weightKg: set.weightKg,
        rir: set.rir,
        estimated1Rm: estimate
      }
    }
  })

  return top
}

export const getExerciseBestE1Rm = (sessions: WorkoutSessionLog[], exerciseId: string): number => {
  let best = 0
  sessions.forEach((session) => {
    session.sets.forEach((set) => {
      if (set.exerciseId !== exerciseId || set.isWarmup) return
      best = Math.max(best, estimateE1Rm(set.weightKg, set.reps))
    })
  })
  return Number(best.toFixed(2))
}

export const getExerciseWeeklyVolume = (
  sessions: WorkoutSessionLog[],
  exerciseId: string,
  fromDate: string,
  toDate: string
): number => {
  const volume = sessions
    .filter((session) => session.date >= fromDate && session.date <= toDate)
    .flatMap((session) => session.sets)
    .filter((set) => set.exerciseId === exerciseId && !set.isWarmup)
    .reduce((sum, set) => sum + getSetVolume(set), 0)

  return Number(volume.toFixed(2))
}
