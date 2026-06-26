import { useEffect, useMemo, useRef, useState } from 'react'

function hoursLabel(minutes) {
  const h = Math.floor(Math.abs(minutes || 0) / 60)
  const m = Math.abs(minutes || 0) % 60
  return h ? `${h}h ${m ? `${m}m` : ''}`.trim() : `${m}m`
}

function signedHoursLabel(minutes) {
  const sign = minutes > 0 ? '+' : minutes < 0 ? '-' : ''
  return `${sign}${hoursLabel(minutes)}`
}

function dayKey(offset = 0) {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return d.toISOString().slice(0, 10)
}

function dayLabel(date) {
  const d = new Date(`${date}T12:00:00`)
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

function estimateBiasText(bias, multiplier) {
  if (bias === 'underestimating') return `You usually need about ${multiplier}x your estimate. Add more cushion to new tasks.`
  if (bias === 'overestimating') return `Your estimates are generous. You may be able to plan future tasks at about ${multiplier}x.`
  if (bias === 'accurate') return 'Your estimates are close to actual study time. Keep using this style of estimation.'
  return 'Log time against completed tasks to learn your personal estimate accuracy.'
}

export default function StatsDashboard({ onDataChange }) {
  const [courses, setCourses] = useState([])
  const [courseRows, setCourseRows] = useState([])
  const [tasks, setTasks] = useState([])
  const [log, setLog] = useState([])
  const [plan, setPlan] = useState(null)
  const [analytics, setAnalytics] = useState(null)
  const [analysis, setAnalysis] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [ollama, setOllama] = useState(null)
  const [msg, setMsg] = useState(null)
  const restoreInputRef = useRef(null)

  useEffect(() => { load() }, [])

  async function load() {
    const [courseData, taskData, logData, planData, analyticsData, ollamaStatus] = await Promise.all([
      window.api.getCourses(),
      window.api.getTasks('all'),
      window.api.getStudyLog(),
      window.api.getStudyPlan(),
      window.api.getStudyAnalytics(),
      window.api.getOllamaStatus()
    ])

    const rows = []
    for (const course of courseData) {
      const topics = await window.api.getTopics(course.id)
      const done = topics.filter(t => t.completed).length
      rows.push({
        ...course,
        total: topics.length,
        done,
        percent: topics.length ? Math.round((done / topics.length) * 100) : 0
      })
    }

    setCourses(courseData)
    setCourseRows(rows)
    setTasks(taskData)
    setLog(logData)
    setPlan(planData)
    setAnalytics(analyticsData)
    setOllama(ollamaStatus)
  }

  async function resetStudyData(mode) {
    const actions = {
      tasks: {
        confirm: 'Clear all study tasks? Courses, sections, logs, and fixed schedule blocks stay.',
        run: () => window.api.deleteAllTasks(),
        message: result => `Cleared ${result.deleted || 0} tasks.`
      },
      logs: {
        confirm: 'Clear study logs and time history? Completed sections stay marked.',
        run: () => window.api.clearStudyLogs(),
        message: result => `Cleared ${result.deleted || 0} study sessions.`
      },
      progress: {
        confirm: 'Reset section completion progress? Tasks and study logs stay.',
        run: () => window.api.resetSectionProgress(),
        message: result => `Reset ${result.reset || 0} completed sections.`
      },
      full: {
        confirm: 'Full fresh start? This clears tasks, study logs, quiz history, planned blocks, and section completion. Courses, imported content, exam date, and schedule blocks stay.',
        run: () => window.api.freshStartStudy(),
        message: result => `Fresh start complete: cleared ${result.counts.tasks} tasks and ${result.counts.sessions} sessions.`
      }
    }
    const action = actions[mode]
    if (!action || !confirm(action.confirm)) return
    const result = await action.run()
    setMsg(action.message(result))
    setTimeout(() => setMsg(null), 3000)
    await load()
    onDataChange?.()
  }

  async function exportBackup() {
    const backup = await window.api.exportBackup()
    const date = new Date().toISOString().slice(0, 10)
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `study-vault-backup-${date}.json`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
    setMsg(`Backup exported: ${backup.counts.courses} courses, ${backup.counts.tasks} tasks, ${backup.counts.sessions} sessions.`)
    setTimeout(() => setMsg(null), 3000)
  }

  async function restoreBackup(file) {
    if (!file) return
    if (!confirm('Restore this Study Vault backup? This replaces current courses, tasks, logs, quizzes, settings, and plan data.')) return
    try {
      const text = await file.text()
      const backup = JSON.parse(text)
      const result = await window.api.importBackup(backup)
      setMsg(`Backup restored: ${result.counts.courses} courses, ${result.counts.tasks} tasks, ${result.counts.sessions} sessions.`)
      setTimeout(() => setMsg(null), 3500)
      await load()
      onDataChange?.()
    } catch (err) {
      setMsg(`Restore failed: ${err.message || err}`)
      setTimeout(() => setMsg(null), 4500)
    } finally {
      if (restoreInputRef.current) restoreInputRef.current.value = ''
    }
  }

  async function analyzeStats() {
    if (!analytics) return
    setAnalyzing(true)
    try {
      const result = await window.api.analyzeStudyStats(analytics)
      setAnalysis(result.analysis || result.error || 'No analysis returned.')
    } catch (err) {
      setAnalysis(`AI analysis failed: ${err.message || err}`)
    } finally {
      setAnalyzing(false)
    }
  }

  async function createWeakTopicReview(topic) {
    const task = await window.api.createTask({
      title: `Review weak quiz topic: ${topic.topicTitle}`,
      notes: `Quiz accuracy is ${topic.accuracyPercent || 0}% (${topic.correct}/${topic.attempts}). Review the topic, fix notes, then retry questions.`,
      kind: 'review',
      courseId: topic.courseId || '',
      topicId: topic.topicId,
      dueDate: dayKey(),
      priority: 1,
      estimateMinutes: 30,
      subtasks: [
        { title: 'Review missed concepts' },
        { title: 'Rewrite confusing notes' },
        { title: 'Retry practice questions' }
      ]
    })
    await window.api.generateStudyPlan()
    setMsg(`Review task ready: ${task.title}`)
    setTimeout(() => setMsg(null), 3000)
    await load()
    onDataChange?.()
  }

  const taskBreakdown = useMemo(() => {
    const total = tasks.length || 1
    const done = tasks.filter(t => t.completed).length
    const open = tasks.filter(t => !t.completed).length
    const overdue = tasks.filter(t => !t.completed && t.due_date && t.due_date < dayKey()).length
    return { total, done, open, overdue }
  }, [tasks])

  const studyBars = useMemo(() => {
    const byDate = {}
    log.forEach(row => { byDate[row.date] = (byDate[row.date] || 0) + Number(row.hours || 0) })
    return Array.from({ length: 14 }, (_, i) => {
      const date = dayKey(-13 + i)
      return { date, label: date.slice(5), hours: byDate[date] || 0 }
    })
  }, [log])

  const maxHours = Math.max(1, ...studyBars.map(d => d.hours))
  const cushion = plan?.summary?.cushionMinutes || 0
  const totals = analytics?.totals || {}
  const pace = analytics?.pace || {}
  const readiness = analytics?.readiness || {}
  const forecastDays = useMemo(() => {
    const days = plan?.days || []
    const maxMinutes = Math.max(60, ...days.map(day => Math.max(
      Number(day.available || 0),
      (day.blocks || []).reduce((sum, block) => sum + (Number(block.end_minute || 0) - Number(block.start_minute || 0)), 0)
    )))
    return days.map(day => {
      const planned = (day.blocks || []).reduce((sum, block) => sum + (Number(block.end_minute || 0) - Number(block.start_minute || 0)), 0)
      const available = Number(day.available || 0)
      const free = Number(day.free_after_plan ?? Math.max(0, available - planned))
      const busy = Number(day.busy || 0)
      const loadPercent = Math.min(140, Math.round((planned / maxMinutes) * 100))
      const availablePercent = Math.min(100, Math.round((available / maxMinutes) * 100))
      const status = planned > available ? 'overloaded' : free < 60 && planned > 0 ? 'tight' : planned > 0 ? 'ok' : 'open'
      return { ...day, planned, available, free, busy, loadPercent, availablePercent, status }
    })
  }, [plan])

  return (
    <div className="page wide stats-page">
      <div className="page-header split">
        <div>
          <h1>Stats</h1>
          <p>Progress, workload, cushion, and study consistency in one place.</p>
        </div>
        <div className="stats-management">
          <span>Data controls</span>
          <div className="reset-actions">
            <button className="secondary-btn compact" onClick={exportBackup}>Export backup</button>
            <button className="secondary-btn compact" onClick={() => restoreInputRef.current?.click()}>Restore</button>
            <input
              ref={restoreInputRef}
              className="hidden-file-input"
              type="file"
              accept="application/json,.json"
              onChange={e => restoreBackup(e.target.files?.[0])}
            />
            <button className="secondary-btn compact" onClick={() => resetStudyData('tasks')}>Clear tasks</button>
            <button className="secondary-btn compact" onClick={() => resetStudyData('logs')}>Clear logs</button>
            <button className="secondary-btn compact" onClick={() => resetStudyData('progress')}>Reset progress</button>
            <button className="danger-btn compact" onClick={() => resetStudyData('full')}>Full reset</button>
          </div>
        </div>
      </div>
      {msg && <div className="info-msg page-msg">{msg}</div>}

      <div className="metric-grid key-metrics">
        <div className="metric-card"><span>Courses</span><strong>{courses.length}</strong></div>
        <div className="metric-card"><span>Open tasks</span><strong>{taskBreakdown.open}</strong></div>
        <div className="metric-card"><span>Completed tasks</span><strong>{taskBreakdown.done}</strong></div>
        <div className={`metric-card cushion ${cushion < 0 ? 'danger' : cushion < 120 ? 'tight' : 'good'}`}><span>Cushion</span><strong>{cushion < 0 ? '-' : ''}{hoursLabel(cushion)}</strong></div>
        <div className="metric-card readiness-mini"><span>Readiness</span><strong>{totals.readinessScore || 0}%</strong></div>
      </div>

      <div className="metric-grid analytics-metrics detail-metrics">
        <div className="metric-card"><span>Completion rate</span><strong>{totals.completionRate || 0}%</strong></div>
        <div className="metric-card"><span>Linked sessions</span><strong>{totals.linkedSessions || 0}/{totals.sessions || 0}</strong></div>
        <div className="metric-card"><span>Avg session</span><strong>{hoursLabel(totals.averageSessionMinutes || 0)}</strong></div>
        <div className="metric-card"><span>Remaining workload</span><strong>{hoursLabel(totals.remainingMinutes || 0)}</strong></div>
        <div className="metric-card"><span>Quiz accuracy</span><strong>{totals.quizAccuracyPercent || 0}%</strong></div>
        <div className="metric-card"><span>Quiz attempts</span><strong>{totals.quizCorrect || 0}/{totals.quizAttempts || 0}</strong></div>
        <div className="metric-card"><span>Study streak</span><strong>{totals.currentStreakDays || 0}d</strong></div>
        <div className="metric-card"><span>Daily pace</span><strong>{hoursLabel(totals.requiredDailyMinutes || 0)}</strong></div>
      </div>

      <div className="stats-grid">
        <section className={`panel span-2 readiness-panel ${totals.readinessScore >= 70 ? 'good' : totals.readinessScore >= 50 ? 'tight' : 'danger'}`}>
          <div className="readiness-score">
            <div>
              <span>Exam readiness</span>
              <strong>{readiness.score || 0}%</strong>
              <em>{readiness.label || 'Not calculated'}</em>
            </div>
            <p>{readiness.note || 'Readiness blends progress, task completion, pace, workload, and quiz accuracy.'}</p>
          </div>
          <div className="readiness-factors">
            {[
              ['sectionProgress', 'Sections'],
              ['taskCompletion', 'Tasks'],
              ['pace', 'Pace'],
              ['workload', 'Workload'],
              ['quiz', 'Quiz']
            ].map(([key, label]) => (
              <div key={key} className="readiness-factor">
                <div>
                  <span>{label}</span>
                  <em>{readiness.weights?.[key] || 0}% weight</em>
                </div>
                <div className="readiness-meter">
                  <span style={{ width: `${readiness.factors?.[key] || 0}%` }} />
                </div>
                <strong>{readiness.factors?.[key] || 0}%</strong>
              </div>
            ))}
          </div>
        </section>

        <section className="panel span-2 ai-analysis-panel">
          <div className="panel-title-row">
            <div>
              <h2>AI study analysis</h2>
              <p className="muted">Uses readiness, pace, workload, quiz accuracy, and logged timing to recommend what to change next.</p>
            </div>
            <div className="ai-actions">
              <span className={`ai-status ${ollama?.ok ? 'online' : 'offline'}`}>
                {ollama?.message || (ollama?.ok ? `Ollama connected: ${ollama.model}` : 'Ollama not connected')}
              </span>
              {ollama?.action && <span className="ai-action-hint">{ollama.action}</span>}
              <button className="primary-btn" onClick={analyzeStats} disabled={analyzing || !analytics || !ollama?.ok}>
                {analyzing ? 'Analyzing...' : 'Analyze stats'}
              </button>
            </div>
          </div>
          {analysis ? (
            <pre className="analysis-output">{analysis}</pre>
          ) : (
            <div className="analysis-empty">Run analysis for a coach-style report. It works best after you have linked study sessions and a few quiz attempts.</div>
          )}
        </section>

        <section className="panel span-2 estimate-panel">
          <div className="panel-title-row">
            <div>
              <h2>Estimate calibration</h2>
              <p className="muted">Compares estimated task time against actual linked study time after completion.</p>
            </div>
            <span>{totals.timedCompletions || 0} timed completions</span>
          </div>
          <div className="calibration-grid">
            <div>
              <span>Estimated</span>
              <strong>{hoursLabel(totals.completedEstimateMinutes || 0)}</strong>
            </div>
            <div>
              <span>Actual</span>
              <strong>{hoursLabel(totals.completedLoggedMinutes || 0)}</strong>
            </div>
            <div>
              <span>Accuracy</span>
              <strong>{totals.estimateAccuracyPercent || 0}%</strong>
            </div>
            <div>
              <span>Plan multiplier</span>
              <strong>{totals.estimateMultiplier || 1}x</strong>
            </div>
          </div>
          <p className="calibration-note">{estimateBiasText(totals.estimateBias, totals.estimateMultiplier || 1)}</p>
        </section>

        <section className="panel span-2 pace-panel">
          <div className="panel-title-row">
            <div>
              <h2>Pace check</h2>
              <p className="muted">Compares your recent study rhythm against what remains before the exam.</p>
            </div>
            <span className={(totals.paceDeltaMinutes || 0) >= 0 ? 'pace-good' : 'pace-danger'}>
              {(totals.paceDeltaMinutes || 0) >= 0 ? 'Ahead' : 'Behind'} {signedHoursLabel(totals.paceDeltaMinutes || 0)}/day
            </span>
          </div>
          <div className="pace-grid">
            <div>
              <span>Days until exam</span>
              <strong>{pace.daysUntilExam || 0}</strong>
            </div>
            <div>
              <span>Needed each day</span>
              <strong>{hoursLabel(pace.requiredDailyMinutes || 0)}</strong>
            </div>
            <div>
              <span>Recent daily avg</span>
              <strong>{hoursLabel(pace.recentDailyAverageMinutes || 0)}</strong>
            </div>
            <div>
              <span>This week logged</span>
              <strong>{hoursLabel(pace.weeklyLoggedMinutes || 0)}</strong>
            </div>
            <div>
              <span>Best study day</span>
              <strong>{pace.bestStudyDay ? hoursLabel(pace.bestStudyDay.minutes) : '0m'}</strong>
              <small>{pace.bestStudyDay?.date || 'No logs yet'}</small>
            </div>
            <div>
              <span>Best study hour</span>
              <strong>{pace.bestStudyHour?.label || 'n/a'}</strong>
              <small>{pace.bestStudyHour ? hoursLabel(pace.bestStudyHour.minutes) : 'New logs track this'}</small>
            </div>
          </div>
        </section>

        <section className="panel span-2 forecast-panel">
          <div className="panel-title-row">
            <div>
              <h2>Workload forecast</h2>
              <p className="muted">Planned study time compared with available study windows for each day.</p>
            </div>
            <span>{forecastDays.length} days</span>
          </div>
          <div className="forecast-grid">
            {forecastDays.map(day => (
              <div key={day.date} className={`forecast-day ${day.status}`}>
                <div className="forecast-top">
                  <strong>{dayLabel(day.date)}</strong>
                  <span>{day.status === 'overloaded' ? 'Over' : day.status === 'tight' ? 'Tight' : day.status === 'ok' ? 'Ready' : 'Open'}</span>
                </div>
                <div className="forecast-meter">
                  <span className="available" style={{ width: `${day.availablePercent}%` }} />
                  <span className="planned" style={{ width: `${day.loadPercent}%` }} />
                </div>
                <div className="forecast-meta">
                  <span>{hoursLabel(day.planned)} planned</span>
                  <span>{hoursLabel(day.free)} free</span>
                  {day.busy > 0 && <span>{hoursLabel(day.busy)} busy</span>}
                </div>
              </div>
            ))}
          </div>
          <div className="legend-row forecast-legend">
            <span><i className="available" /> Available</span>
            <span><i className="planned" /> Planned</span>
            <span><i className="late" /> Overloaded</span>
          </div>
        </section>

        <section className="panel">
          <div className="panel-title-row">
            <h2>Course progress</h2>
            <span>{courseRows.length}</span>
          </div>
          <div className="bar-list">
            {courseRows.map(course => (
              <div key={course.id} className="stat-bar-row">
                <div>
                  <strong>{course.name}</strong>
                  <span>{course.done}/{course.total} sections</span>
                </div>
                <div className="wide-bar"><span style={{ width: `${course.percent}%` }} /></div>
                <em>{course.percent}%</em>
              </div>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panel-title-row">
            <h2>Course time</h2>
            <span>{analytics?.courseRows?.length || 0}</span>
          </div>
          <div className="bar-list">
            {(analytics?.courseRows || []).map(course => (
              <div key={course.id} className="stat-bar-row">
                <div>
                  <strong>{course.name}</strong>
                  <span>{hoursLabel(course.loggedMinutes)} logged · {hoursLabel(course.remainingMinutes)} left</span>
                </div>
                <div className="wide-bar">
                  <span style={{ width: `${Math.min(100, course.taskLoggedMinutes && (course.taskLoggedMinutes + course.remainingMinutes) ? (course.taskLoggedMinutes / (course.taskLoggedMinutes + course.remainingMinutes)) * 100 : 0)}%` }} />
                </div>
                <em>{course.avgMinutesPerCompletedTask ? hoursLabel(course.avgMinutesPerCompletedTask) : '0m'}</em>
              </div>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panel-title-row">
            <h2>Task pile</h2>
            <span>{tasks.length}</span>
          </div>
          <div className="stacked-bar">
            <span className="done" style={{ width: `${(taskBreakdown.done / taskBreakdown.total) * 100}%` }} />
            <span className="open" style={{ width: `${(taskBreakdown.open / taskBreakdown.total) * 100}%` }} />
            <span className="late" style={{ width: `${(taskBreakdown.overdue / taskBreakdown.total) * 100}%` }} />
          </div>
          <div className="legend-row">
            <span><i className="done" /> Done</span>
            <span><i className="open" /> Open</span>
            <span><i className="late" /> Overdue</span>
          </div>
        </section>

        <section className="panel">
          <div className="panel-title-row">
            <h2>Weak quiz topics</h2>
            <span>{totals.weakQuizTopics || 0}</span>
          </div>
          {(analytics?.weakQuizTopics || []).length === 0 ? (
            <p className="muted">No weak quiz topics yet. Answer AI-generated or saved questions to collect accuracy by topic.</p>
          ) : (
            <div className="weak-topic-list">
              {(analytics?.weakQuizTopics || []).map(topic => (
                <div key={topic.topicId} className="weak-topic-row">
                  <div>
                    <strong>{topic.topicTitle}</strong>
                    <span>{topic.courseName} - {topic.questions} questions</span>
                  </div>
                  <div className="mini-meter">
                    <span style={{ width: `${topic.accuracyPercent || 0}%` }} />
                  </div>
                  <em>{topic.accuracyPercent || 0}%</em>
                  <small>{topic.correct}/{topic.attempts}</small>
                  <button className="secondary-btn compact" onClick={() => createWeakTopicReview(topic)}>Review today</button>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="panel span-2">
          <div className="panel-title-row">
            <h2>Completed topic timing</h2>
            <span>{analytics?.completions?.length || 0}</span>
          </div>
          {(analytics?.completions || []).length === 0 ? (
            <p className="muted">No linked completed tasks yet. Log study time against tasks to collect completion timing.</p>
          ) : (
            <div className="completion-table">
              {(analytics?.completions || []).slice(0, 10).map(item => (
                <div key={item.id} className="completion-row">
                  <strong>{item.topicTitle || item.title}</strong>
                  <span>{item.courseName || 'No course'}</span>
                  <span>{hoursLabel(item.loggedMinutes)} actual</span>
                  <span>{hoursLabel(item.estimateMinutes)} estimated</span>
                  <span>{item.calendarDays === null ? 'n/a' : `${item.calendarDays}d elapsed`}</span>
                  <em>{item.efficiencyPercent ? `${item.efficiencyPercent}%` : 'n/a'}</em>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="panel span-2">
          <div className="panel-title-row">
            <h2>Study hours</h2>
            <span>Last 14 days</span>
          </div>
          <div className="hours-chart">
            {studyBars.map(day => (
              <div key={day.date} className="hours-bar">
                <span style={{ height: `${Math.max(6, (day.hours / maxHours) * 120)}px` }} />
                <strong>{day.hours ? `${day.hours}h` : '0'}</strong>
                <em>{day.label}</em>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
