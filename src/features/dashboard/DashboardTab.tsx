import { AppState } from '../../types'
import { DashboardSummary } from '../../utils/metrics'

type DashboardTabProps = {
  state: AppState
  summary: DashboardSummary
}

const trendLabel = (value: number | null, metric: string) => {
  if (value == null) return '--'
  const sign = value > 0 ? '+' : ''
  return `${sign}${value} ${metric}`
}

export function DashboardTab({ state, summary }: DashboardTabProps) {
  return (
    <div className="section">
      <div className="section-intro">
        <h2>Dashboard</h2>
        <p className="muted">Vision rapida de progreso y consistencia</p>
      </div>

      <div className="grid grid-2">
        <div className="card metric-card">
          <p className="metric-label">Sesiones 7d</p>
          <p className="metric-value">{summary.cards.weeklySessions}</p>
        </div>
        <div className="card metric-card">
          <p className="metric-label">Volumen 7d</p>
          <p className="metric-value">{summary.cards.weeklyVolume.toFixed(0)} kg</p>
        </div>
        <div className="card metric-card">
          <p className="metric-label">Consistencia (4 semanas)</p>
          <p className="metric-value">{summary.cards.consistency4Weeks.toFixed(2)} sesiones/semana</p>
        </div>
        <div className="card metric-card">
          <p className="metric-label">Objetivos activos</p>
          <p className="metric-value">{summary.cards.activeObjectives}</p>
        </div>
      </div>

      <div className="card">
        <h3>Tendencias 14 dias</h3>
        <div className="grid grid-3">
          <div className="stat-item">
            <span>Peso</span>
            <strong>{trendLabel(summary.trends.weight14d, 'kg')}</strong>
          </div>
          <div className="stat-item">
            <span>Cintura</span>
            <strong>{trendLabel(summary.trends.waist14d, 'cm')}</strong>
          </div>
          <div className="stat-item">
            <span>Sesiones</span>
            <strong>{summary.trends.sessions14d}</strong>
          </div>
        </div>
      </div>

      <div className="card">
        <h3>Top fuerza (e1RM estimado)</h3>
        {summary.topStrength.length ? (
          <ul className="history-list">
            {summary.topStrength.map((row) => (
              <li key={row.exerciseId}>
                <strong>{row.exerciseName}</strong>
                <div>
                  e1RM: {row.bestE1Rm.toFixed(2)} kg · Mejor set: {row.bestWeightKg} x {row.bestReps}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="empty">Aun no hay series registradas para calcular fuerza.</div>
        )}
      </div>

      <div className="card">
        <h3>Objetivos</h3>
        {state.objectives.length ? (
          <ul className="history-list">
            {state.objectives.map((objective) => (
              <li key={objective.id}>
                <strong>{objective.title}</strong>
                <div>
                  Estado: <span className={`status status-${objective.status}`}>{objective.status}</span>
                </div>
                {objective.targetValue != null ? (
                  <div>
                    Target: {objective.targetValue} {objective.unit || ''}
                  </div>
                ) : null}
                {objective.deadline ? <div>Fecha objetivo: {objective.deadline}</div> : null}
              </li>
            ))}
          </ul>
        ) : (
          <div className="empty">No hay objetivos definidos.</div>
        )}
      </div>
    </div>
  )
}
