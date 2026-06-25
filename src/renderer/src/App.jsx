import { useEffect, useState } from 'react'
import StudyTracker from './components/StudyTracker'
import CourseUploader from './components/CourseUploader'
import QuizGenerator from './components/QuizGenerator'
import StatsDashboard from './components/StatsDashboard'

const NAV = [
  { id: 'tracker', label: 'Today', hint: 'Plan and log' },
  { id: 'courses', label: 'Courses', hint: 'Content library' },
  { id: 'stats', label: 'Stats', hint: 'Graphs and cushion' },
  { id: 'quiz', label: 'Quiz', hint: 'AI practice' }
]

export default function App() {
  const [view, setView] = useState('tracker')
  const [updateMsg, setUpdateMsg] = useState(null)
  const [examDate, setExamDate] = useState('2026-07-15')
  const [daysLeft, setDaysLeft] = useState(0)
  const [taskStats, setTaskStats] = useState(null)

  function applyExamDate(date) {
    const next = date || '2026-07-15'
    const diff = Math.ceil((new Date(`${next}T12:00:00`) - new Date()) / 86400000)
    setExamDate(next)
    setDaysLeft(Math.max(0, diff))
  }

  async function refreshStats() {
    const stats = await window.api?.getTaskStats?.()
    if (stats) setTaskStats(stats)
  }

  useEffect(() => {
    window.api?.onUpdateStatus?.((msg) => setUpdateMsg(msg))
    window.api?.getSetting('exam_date').then(applyExamDate)
    refreshStats()
  }, [])

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-title">Study Vault</div>
          <div className="brand-subtitle">Exam in {daysLeft} days</div>
        </div>

        <div className="nav-list">
          {NAV.map(n => (
            <button key={n.id} onClick={() => setView(n.id)} className={`nav-item ${view === n.id ? 'active' : ''}`}>
              <span className="nav-dot" />
              <span>
                <span className="nav-label">{n.label}</span>
                <span className="nav-hint">{n.hint}</span>
              </span>
            </button>
          ))}
        </div>

        <div className="sidebar-panel">
          <div className="panel-label">Study queue</div>
          <div className="sidebar-metric">
            <span>Today</span>
            <strong>{taskStats?.today ?? 0}</strong>
          </div>
          <div className="sidebar-metric">
            <span>Upcoming</span>
            <strong>{taskStats?.upcoming ?? 0}</strong>
          </div>
          <div className="sidebar-metric">
            <span>Open</span>
            <strong>{taskStats?.open ?? 0}</strong>
          </div>
        </div>

        {updateMsg && (
          <div className="update-card">
            <div>{updateMsg}</div>
            {updateMsg.includes('ready') && (
              <button onClick={() => window.api?.installUpdate()} className="primary-btn compact">
                Restart to update
              </button>
            )}
          </div>
        )}
      </aside>

      <main className="main-pane">
        {view === 'tracker' && <StudyTracker examDate={examDate} onExamDateChange={applyExamDate} onDataChange={refreshStats} />}
        {view === 'courses' && <CourseUploader onDataChange={refreshStats} />}
        {view === 'stats' && <StatsDashboard onDataChange={refreshStats} />}
        {view === 'quiz' && <QuizGenerator />}
      </main>
    </div>
  )
}
