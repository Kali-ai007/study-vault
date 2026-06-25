import { useEffect, useMemo, useState } from 'react'

const FILTERS = [
  { id: 'today', label: 'Today' },
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'planned', label: 'Planned' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'all', label: 'All' },
  { id: 'completed', label: 'Done' }
]

const KINDS = ['study', 'read', 'review', 'quiz', 'practice']

const WEEKDAYS = [
  { id: 1, label: 'M' },
  { id: 2, label: 'T' },
  { id: 3, label: 'W' },
  { id: 4, label: 'T' },
  { id: 5, label: 'F' },
  { id: 6, label: 'S' },
  { id: 0, label: 'S' }
]

function todayKey(offset = 0) {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return d.toISOString().slice(0, 10)
}

function parseQuickTask(raw, courses) {
  const tokens = raw.trim().split(/\s+/)
  let dueDate = todayKey()
  let priority = 3
  let estimateMinutes = 30
  let kind = 'study'
  let courseId = ''

  const kept = tokens.filter(token => {
    const lower = token.toLowerCase()
    if (lower === 'today') {
      dueDate = todayKey()
      return false
    }
    if (lower === 'tomorrow' || lower === 'tmr') {
      dueDate = todayKey(1)
      return false
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(lower)) {
      dueDate = lower
      return false
    }
    if (/^p[1-4]$/.test(lower)) {
      priority = Number(lower.slice(1))
      return false
    }
    if (/^\d+(m|min)$/.test(lower)) {
      estimateMinutes = Number(lower.replace(/\D/g, ''))
      return false
    }
    if (/^\d+h$/.test(lower)) {
      estimateMinutes = Number(lower.replace(/\D/g, '')) * 60
      return false
    }
    if (lower.startsWith('@')) {
      const possible = lower.slice(1)
      if (KINDS.includes(possible)) kind = possible
      return false
    }
    if (lower.startsWith('#')) {
      const courseSlug = lower.slice(1)
      const match = courses.find(c => c.name.toLowerCase().replace(/\s+/g, '-') === courseSlug || c.name.toLowerCase() === courseSlug)
      if (match) courseId = String(match.id)
      return false
    }
    return true
  })

  return {
    title: kept.join(' ').trim() || raw.trim(),
    dueDate,
    priority,
    estimateMinutes,
    kind,
    courseId
  }
}

function minutesLabel(minutes) {
  if (!minutes) return 'No estimate'
  if (minutes < 60) return `${minutes}m`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m ? `${h}h ${m}m` : `${h}h`
}

function dueLabel(date) {
  if (!date) return 'Inbox'
  if (date === todayKey()) return 'Today'
  if (date === todayKey(1)) return 'Tomorrow'
  return date
}

function hoursLabel(minutes) {
  const sign = minutes < 0 ? '-' : ''
  const abs = Math.abs(Math.round(minutes || 0))
  const h = Math.floor(abs / 60)
  const m = abs % 60
  if (!h) return `${sign}${m}m`
  return m ? `${sign}${h}h ${m}m` : `${sign}${h}h`
}

function timerLabel(seconds) {
  const safeSeconds = Math.max(0, Math.floor(seconds || 0))
  const h = Math.floor(safeSeconds / 3600)
  const m = Math.floor((safeSeconds % 3600) / 60)
  const s = safeSeconds % 60
  return h
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`
}

function dayLabel(date) {
  const d = new Date(`${date}T12:00:00`)
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

function timestampLabel(value) {
  if (!value) return 'Not calculated yet'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return 'Not calculated yet'
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function TaskRow({ task, onOpen, onComplete, onReschedule, onDelete }) {
  const priorityClass = `priority p${task.priority || 3}`
  const remaining = task.remaining_minutes ?? task.estimate_minutes
  const logged = task.logged_minutes || 0
  const subtasks = Array.isArray(task.subtasks) ? task.subtasks : []
  const doneSubtasks = subtasks.filter(item => item.completed).length
  return (
    <div className={`task-row ${task.completed ? 'completed' : ''}`}>
      <button className={priorityClass} onClick={() => onComplete(task)} aria-label="Complete task" />
      <button className="task-body open-task" onClick={() => onOpen(task)}>
        <div className="task-title">{task.title}</div>
        <div className="task-meta">
          <span>{task.kind || 'study'}</span>
          <span>{dueLabel(task.due_date)}</span>
          {task.plan_label && <span>{task.plan_label}</span>}
          <span>{minutesLabel(remaining)} left</span>
          {subtasks.length > 0 && <span>{doneSubtasks}/{subtasks.length} steps</span>}
          {logged > 0 && <span>{minutesLabel(logged)} logged</span>}
          {task.course_name && <span>{task.course_name}</span>}
          {task.topic_title && <span>{task.topic_title}</span>}
        </div>
      </button>
      {!task.completed && (
        <div className="task-actions">
          <button onClick={() => onReschedule(task, todayKey())}>Today</button>
          <button onClick={() => onReschedule(task, todayKey(1))}>Tomorrow</button>
        </div>
      )}
      <button className="ghost-icon" onClick={() => onDelete(task.id)} aria-label="Delete task">x</button>
    </div>
  )
}

function TaskDetailModal({ task, draft, setDraft, onClose, onSave, onComplete, onReschedule, onDelete, onLogTime }) {
  const [subtaskText, setSubtaskText] = useState('')
  const [timerStartedAt, setTimerStartedAt] = useState(null)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)

  useEffect(() => {
    setTimerStartedAt(null)
    setElapsedSeconds(0)
  }, [task?.id])

  useEffect(() => {
    if (!timerStartedAt) return undefined
    const interval = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - timerStartedAt) / 1000))
    }, 1000)
    return () => clearInterval(interval)
  }, [timerStartedAt])

  if (!task || !draft) return null
  const logged = Number(task.logged_minutes || 0)
  const estimate = Number(task.estimate_minutes || 0)
  const remaining = Number(task.remaining_minutes ?? estimate)
  const pct = estimate > 0 ? Math.min(100, Math.round((logged / estimate) * 100)) : 0
  const subtasks = Array.isArray(draft.subtasks) ? draft.subtasks : []
  const doneSubtasks = subtasks.filter(item => item.completed).length

  function updateSubtasks(next) {
    setDraft({ ...draft, subtasks: next })
  }

  function addSubtask() {
    const title = subtaskText.trim()
    if (!title) return
    updateSubtasks([...subtasks, { id: `manual-${Date.now()}`, title, completed: 0 }])
    setSubtaskText('')
  }

  function startTimer() {
    setTimerStartedAt(Date.now() - elapsedSeconds * 1000)
  }

  async function stopAndLogTimer() {
    const seconds = timerStartedAt ? Math.max(elapsedSeconds, Math.floor((Date.now() - timerStartedAt) / 1000)) : elapsedSeconds
    const minutes = Math.max(1, Math.round(seconds / 60))
    setTimerStartedAt(null)
    setElapsedSeconds(0)
    await onLogTime(task, minutes, `Timer logged ${minutesLabel(minutes)} from task details.`)
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="task-modal" role="dialog" aria-modal="true" aria-label="Task details" onMouseDown={e => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <span>{task.course_name || 'Study task'}</span>
            <h2>{task.title}</h2>
          </div>
          <button className="ghost-icon big" onClick={onClose} aria-label="Close task details">x</button>
        </div>

        <div className="task-progress-card">
          <div>
            <span>Remaining</span>
            <strong>{minutesLabel(remaining)}</strong>
          </div>
          <div>
            <span>Logged</span>
            <strong>{minutesLabel(logged)}</strong>
          </div>
          <div>
            <span>Estimate</span>
            <strong>{minutesLabel(estimate)}</strong>
          </div>
          <div className="progress wide"><span style={{ width: `${pct}%` }} /></div>
        </div>

        <div className="quick-log-panel">
          <div>
            <h3>Track progress</h3>
            <p className="muted">
              Add focused time directly to this task.
              {task.kind === 'study' && task.topic_id ? ' Completing it schedules 1-day, 3-day, and 7-day reviews.' : ''}
            </p>
          </div>
          <div className="quick-log-actions">
            <button className="secondary-btn compact" onClick={() => onLogTime(task, 15)}>+15m</button>
            <button className="secondary-btn compact" onClick={() => onLogTime(task, 30)}>+30m</button>
            <button className="secondary-btn compact" onClick={() => onLogTime(task, 60)}>+1h</button>
            <button className="primary-btn compact" onClick={() => onLogTime(task, Math.max(5, remaining))}>Log remaining</button>
          </div>
          <div className="timer-card">
            <div>
              <span>Live timer</span>
              <strong>{timerLabel(elapsedSeconds)}</strong>
            </div>
            <div className="timer-actions">
              {!timerStartedAt ? (
                <button className="secondary-btn compact" onClick={startTimer}>Start</button>
              ) : (
                <button className="secondary-btn compact" onClick={() => setTimerStartedAt(null)}>Pause</button>
              )}
              <button className="primary-btn compact" onClick={stopAndLogTimer} disabled={elapsedSeconds < 1}>Stop & log</button>
              <button className="ghost-icon" onClick={() => { setTimerStartedAt(null); setElapsedSeconds(0) }} aria-label="Reset timer">x</button>
            </div>
          </div>
        </div>

        <div className="modal-form">
          <label>
            Title
            <input className="field" value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} />
          </label>
          <label>
            Due date
            <input className="field" type="date" value={draft.due_date || ''} onChange={e => setDraft({ ...draft, due_date: e.target.value || null })} />
          </label>
          <label>
            Estimate minutes
            <input className="field" type="number" min="5" step="5" value={draft.estimate_minutes} onChange={e => setDraft({ ...draft, estimate_minutes: Number(e.target.value || 0) })} />
          </label>
          <label>
            Priority
            <select className="field" value={draft.priority} onChange={e => setDraft({ ...draft, priority: Number(e.target.value) })}>
              <option value={1}>P1 urgent</option>
              <option value={2}>P2 high</option>
              <option value={3}>P3 normal</option>
              <option value={4}>P4 low</option>
            </select>
          </label>
          <label className="span-2">
            Notes / content preview
            <textarea className="field" rows="5" value={draft.notes || ''} onChange={e => setDraft({ ...draft, notes: e.target.value })} />
          </label>
        </div>

        <div className="subtask-panel">
          <div className="panel-title-row">
            <div>
              <h3>Subtasks</h3>
              <p className="muted">{doneSubtasks}/{subtasks.length} complete</p>
            </div>
            <button
              className="secondary-btn compact"
              onClick={() => updateSubtasks([
                { id: `suggest-${Date.now()}-1`, title: 'Preview the section', completed: 0 },
                { id: `suggest-${Date.now()}-2`, title: 'Read carefully and take notes', completed: 0 },
                { id: `suggest-${Date.now()}-3`, title: 'Answer recall questions without looking', completed: 0 },
                { id: `suggest-${Date.now()}-4`, title: 'Review weak points tomorrow', completed: 0 }
              ])}
            >
              Use study steps
            </button>
          </div>
          <div className="subtask-list">
            {subtasks.map((item, index) => (
              <div key={item.id || index} className="subtask-row">
                <input
                  type="checkbox"
                  checked={!!item.completed}
                  onChange={e => updateSubtasks(subtasks.map((subtask, i) => i === index ? { ...subtask, completed: e.target.checked ? 1 : 0 } : subtask))}
                />
                <input
                  value={item.title}
                  onChange={e => updateSubtasks(subtasks.map((subtask, i) => i === index ? { ...subtask, title: e.target.value } : subtask))}
                />
                <button className="ghost-icon" onClick={() => updateSubtasks(subtasks.filter((_, i) => i !== index))}>x</button>
              </div>
            ))}
          </div>
          <div className="subtask-add">
            <input
              className="field"
              value={subtaskText}
              onChange={e => setSubtaskText(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addSubtask()
                }
              }}
              placeholder="Add a smaller study step..."
            />
            <button className="secondary-btn" onClick={addSubtask}>Add step</button>
          </div>
        </div>

        <div className="modal-actions">
          <button className="secondary-btn" onClick={() => onReschedule(task, todayKey())}>Do today</button>
          <button className="secondary-btn" onClick={() => onReschedule(task, todayKey(1))}>Move tomorrow</button>
          <button className="secondary-btn" onClick={() => onComplete(task)}>{task.completed ? 'Reopen' : 'Mark complete'}</button>
          <button className="danger-btn" onClick={() => onDelete(task.id)}>Delete</button>
          <button className="primary-btn" onClick={onSave}>Save changes</button>
        </div>
      </section>
    </div>
  )
}

export default function StudyTracker({ examDate: appExamDate, onExamDateChange, onDataChange }) {
  const [filter, setFilter] = useState('today')
  const [taskQuery, setTaskQuery] = useState('')
  const [taskKindFilter, setTaskKindFilter] = useState('all')
  const [taskCourseFilter, setTaskCourseFilter] = useState('all')
  const [tasks, setTasks] = useState([])
  const [allTasks, setAllTasks] = useState([])
  const [stats, setStats] = useState(null)
  const [courses, setCourses] = useState([])
  const [log, setLog] = useState([])
  const [totalHours, setTotalHours] = useState(0)
  const [quick, setQuick] = useState('')
  const [hours, setHours] = useState(1)
  const [logDate, setLogDate] = useState(todayKey())
  const [selectedTask, setSelectedTask] = useState('')
  const [selectedCourse, setSelectedCourse] = useState('')
  const [note, setNote] = useState('')
  const [msg, setMsg] = useState(null)
  const [examDate, setExamDate] = useState(appExamDate || '2026-07-15')
  const [plan, setPlan] = useState(null)
  const [planSettings, setPlanSettings] = useState(null)
  const [fixedEvents, setFixedEvents] = useState([])
  const [eventDraft, setEventDraft] = useState({ title: '', start: '09:00', end: '10:00', days: [1, 2, 3, 4, 5] })
  const [editingEventId, setEditingEventId] = useState(null)
  const [exceptions, setExceptions] = useState([])
  const [exceptionDraft, setExceptionDraft] = useState({ title: '', date: todayKey(), start: '13:00', end: '14:00' })
  const [editingExceptionId, setEditingExceptionId] = useState(null)
  const [planning, setPlanning] = useState(false)
  const [activeTaskId, setActiveTaskId] = useState(null)
  const [taskDraft, setTaskDraft] = useState(null)

  const daysLeft = Math.max(0, Math.ceil((new Date(`${examDate}T12:00:00`) - new Date()) / 86400000))
  const target = 160
  const pct = Math.min(100, Math.round((totalHours / target) * 100))
  const logTasks = useMemo(() =>
    allTasks
      .filter(t => !t.completed)
      .sort((a, b) => {
        if ((a.due_date || '') !== (b.due_date || '')) return (a.due_date || '9999').localeCompare(b.due_date || '9999')
        return a.title.localeCompare(b.title)
      }),
    [allTasks]
  )
  const activeTask = useMemo(() =>
    allTasks.find(t => t.id === Number(activeTaskId)) || tasks.find(t => t.id === Number(activeTaskId)) || null,
    [activeTaskId, allTasks, tasks]
  )
  const plannedTodayTasks = useMemo(() => {
    const todayPlan = (plan?.days || []).find(day => day.date === todayKey())
    if (!todayPlan?.blocks?.length) return []

    const byId = new Map(allTasks.map(task => [task.id, task]))
    const seen = new Set()
    const rows = []

    for (const block of todayPlan.blocks) {
      if (seen.has(block.task_id)) continue
      const task = byId.get(block.task_id)
      if (!task || task.completed) continue
      const taskBlocks = todayPlan.blocks.filter(item => item.task_id === block.task_id)
      const first = taskBlocks[0]
      const last = taskBlocks[taskBlocks.length - 1]
      rows.push({
        ...task,
        plan_label: `Planned ${first.start_label}-${last.end_label}`
      })
      seen.add(block.task_id)
    }

    return rows
  }, [plan, allTasks])
  const plannedTasks = useMemo(() => {
    const byId = new Map(allTasks.map(task => [task.id, task]))
    const firstBlockByTask = new Map()
    for (const day of plan?.days || []) {
      for (const block of day.blocks || []) {
        if (!firstBlockByTask.has(block.task_id)) {
          firstBlockByTask.set(block.task_id, { ...block, date: day.date })
        }
      }
    }

    return Array.from(firstBlockByTask.values())
      .map(block => {
        const task = byId.get(block.task_id)
        if (!task || task.completed) return null
        return {
          ...task,
          plan_label: `${dayLabel(block.date)} ${block.start_label}-${block.end_label}`
        }
      })
      .filter(Boolean)
      .sort((a, b) => (a.plan_label || '').localeCompare(b.plan_label || ''))
  }, [plan, allTasks])
  const visibleTasks = useMemo(() => {
    if (filter === 'today') return plannedTodayTasks
    if (filter === 'planned') return plannedTasks
    if (filter === 'overdue') return allTasks.filter(task => !task.completed && task.due_date && task.due_date < todayKey())
    return tasks
  }, [filter, plannedTodayTasks, plannedTasks, allTasks, tasks])
  const filteredTasks = useMemo(() => {
    const query = taskQuery.trim().toLowerCase()
    return visibleTasks.filter(task => {
      if (taskKindFilter !== 'all' && (task.kind || 'study') !== taskKindFilter) return false
      if (taskCourseFilter !== 'all' && String(task.course_id || '') !== taskCourseFilter) return false
      if (!query) return true
      return [
        task.title,
        task.notes,
        task.kind,
        task.course_name,
        task.topic_title,
        task.due_date,
        task.plan_label
      ].some(value => String(value || '').toLowerCase().includes(query))
    })
  }, [visibleTasks, taskQuery, taskKindFilter, taskCourseFilter])

  useEffect(() => { load() }, [filter])
  useEffect(() => {
    if (appExamDate) setExamDate(appExamDate)
  }, [appExamDate])
  useEffect(() => {
    if (!activeTask) {
      setTaskDraft(null)
      return
    }
    setTaskDraft({
      title: activeTask.title || '',
      due_date: activeTask.due_date || '',
      estimate_minutes: Number(activeTask.estimate_minutes || 30),
      priority: Number(activeTask.priority || 3),
      notes: activeTask.notes || '',
      subtasks: Array.isArray(activeTask.subtasks) ? activeTask.subtasks : []
    })
  }, [activeTask?.id])

  async function load() {
    const [taskData, allTaskData, statData, logData, totalData, courseData, dateVal, fixedEventData, exceptionData] = await Promise.all([
      window.api.getTasks(filter),
      window.api.getTasks('all'),
      window.api.getTaskStats(),
      window.api.getStudyLog(),
      window.api.getTotalHours(),
      window.api.getCourses(),
      window.api.getSetting('exam_date'),
      window.api.getFixedEvents(),
      window.api.getScheduleExceptions()
    ])
    const [planData, plannerSettings] = await Promise.all([
      window.api.getStudyPlan(),
      window.api.getStudyPlanSettings()
    ])
    setTasks(taskData)
    setAllTasks(allTaskData)
    setStats(statData)
    setLog(logData)
    setTotalHours(totalData.total)
    setCourses(courseData)
    setFixedEvents(fixedEventData)
    setExceptions(exceptionData)
    setPlan(planData)
    setPlanSettings(plannerSettings)
    if (dateVal) setExamDate(dateVal)
    onDataChange?.()
  }

  async function saveExamDate(e) {
    e.preventDefault()
    if (!examDate) return
    await window.api.setSetting('exam_date', examDate)
    onExamDateChange?.(examDate)
    setMsg('Exam date updated. Plan and cushion recalculated.')
    setTimeout(() => setMsg(null), 2500)
    await load()
  }

  async function addTask(e) {
    e.preventDefault()
    if (!quick.trim()) return
    await window.api.createTask(parseQuickTask(quick, courses))
    setQuick('')
    setFilter('today')
    await load()
  }

  async function generatePlan() {
    setPlanning(true)
    const generated = await window.api.generateStudyPlan()
    setPlan(generated)
    setPlanning(false)
  }

  async function savePlanSettings(patch) {
    const next = { ...planSettings, ...patch }
    setPlanSettings(next)
    await window.api.setStudyPlanSettings(next)
    await load()
  }

  async function completeTask(task) {
    const result = await window.api.completeTask({ id: task.id, completed: !task.completed })
    if (!task.completed) {
      setMsg(result?.reviewTasksCreated
        ? `Completed "${task.title}" and scheduled ${result.reviewTasksCreated} review tasks.`
        : `Completed "${task.title}".`)
      setTimeout(() => setMsg(null), 2600)
    }
    await load()
  }

  async function reschedule(task, dueDate) {
    await window.api.updateTask({ id: task.id, patch: { due_date: dueDate } })
    await load()
  }

  async function deleteTask(id) {
    await window.api.deleteTask(id)
    if (Number(activeTaskId) === Number(id)) setActiveTaskId(null)
    await load()
  }

  async function saveTaskDraft() {
    if (!activeTask || !taskDraft?.title.trim()) return
    await window.api.updateTask({
      id: activeTask.id,
      patch: {
        title: taskDraft.title.trim(),
        due_date: taskDraft.due_date || null,
        estimate_minutes: Number(taskDraft.estimate_minutes || 30),
        priority: Number(taskDraft.priority || 3),
        notes: taskDraft.notes || '',
        subtasks: Array.isArray(taskDraft.subtasks)
          ? taskDraft.subtasks
              .map((item, index) => ({
                id: item.id || `subtask-${Date.now()}-${index}`,
                title: String(item.title || '').trim(),
                completed: item.completed ? 1 : 0
              }))
              .filter(item => item.title)
          : []
      }
    })
    setMsg('Task updated.')
    setTimeout(() => setMsg(null), 2200)
    await load()
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
    setSelectedTask('')
    setSelectedCourse('')
    await load()
  }

  async function addFixedEvent(e) {
    e.preventDefault()
    if (!eventDraft.title.trim() || eventDraft.days.length === 0 || eventDraft.start >= eventDraft.end) return
    if (editingEventId) {
      await window.api.updateFixedEvent({ id: editingEventId, patch: eventDraft })
      setEditingEventId(null)
      setMsg('Fixed block updated. Plan availability recalculated.')
    } else {
      await window.api.createFixedEvent(eventDraft)
      setMsg('Fixed block added. Plan availability updated.')
    }
    setEventDraft({ title: '', start: eventDraft.start, end: eventDraft.end, days: eventDraft.days })
    setTimeout(() => setMsg(null), 2500)
    await load()
  }

  async function removeFixedEvent(id) {
    await window.api.deleteFixedEvent(id)
    if (Number(editingEventId) === Number(id)) {
      setEditingEventId(null)
      setEventDraft({ title: '', start: '09:00', end: '10:00', days: [1, 2, 3, 4, 5] })
    }
    setMsg('Fixed block removed. Plan availability updated.')
    setTimeout(() => setMsg(null), 2500)
    await load()
  }

  function editFixedEvent(event) {
    setEditingEventId(event.id)
    setEventDraft({
      title: event.title || '',
      start: event.start || '09:00',
      end: event.end || '10:00',
      days: Array.isArray(event.days) ? event.days : [1, 2, 3, 4, 5]
    })
  }

  function cancelFixedEventEdit() {
    setEditingEventId(null)
    setEventDraft({ title: '', start: '09:00', end: '10:00', days: [1, 2, 3, 4, 5] })
  }

  async function saveScheduleException(e) {
    e.preventDefault()
    if (!exceptionDraft.title.trim() || !exceptionDraft.date || exceptionDraft.start >= exceptionDraft.end) return
    if (editingExceptionId) {
      await window.api.updateScheduleException({ id: editingExceptionId, patch: exceptionDraft })
      setEditingExceptionId(null)
      setMsg('One-off exception updated. Plan availability recalculated.')
    } else {
      await window.api.createScheduleException(exceptionDraft)
      setMsg('One-off exception added. Plan availability updated.')
    }
    setExceptionDraft({ title: '', date: exceptionDraft.date, start: exceptionDraft.start, end: exceptionDraft.end })
    setTimeout(() => setMsg(null), 2500)
    await load()
  }

  function editScheduleException(event) {
    setEditingExceptionId(event.id)
    setExceptionDraft({
      title: event.title || '',
      date: event.date || todayKey(),
      start: event.start || '13:00',
      end: event.end || '14:00'
    })
  }

  function cancelExceptionEdit() {
    setEditingExceptionId(null)
    setExceptionDraft({ title: '', date: todayKey(), start: '13:00', end: '14:00' })
  }

  async function removeScheduleException(id) {
    await window.api.deleteScheduleException(id)
    if (Number(editingExceptionId) === Number(id)) cancelExceptionEdit()
    setMsg('One-off exception removed. Plan availability updated.')
    setTimeout(() => setMsg(null), 2500)
    await load()
  }

  function toggleEventDay(id) {
    const days = eventDraft.days.includes(id)
      ? eventDraft.days.filter(day => day !== id)
      : [...eventDraft.days, id]
    setEventDraft({ ...eventDraft, days })
  }

  async function logSession() {
    if (hours <= 0) return
    const task = selectedTask ? allTasks.find(t => t.id === Number(selectedTask)) : null
    const result = await window.api.logStudy({
      date: logDate || todayKey(),
      hours,
      taskId: selectedTask || null,
      courseId: task?.course_id || selectedCourse || null,
      notes: note
    })
    setMsg(result?.completedTask
      ? `${hours}h logged and "${task.title}" is complete.${result.reviewTasksCreated ? ` Scheduled ${result.reviewTasksCreated} review tasks.` : ''}`
      : task
        ? `${hours}h logged toward "${task.title}"`
        : `${hours}h logged`)
    setTimeout(() => setMsg(null), 2500)
    setHours(1)
    setSelectedTask('')
    setNote('')
    await load()
  }

  async function logTaskMinutes(task, minutes, logNote = null) {
    if (!task || minutes <= 0) return
    const hoursToLog = Number((minutes / 60).toFixed(2))
    const result = await window.api.logStudy({
      date: todayKey(),
      hours: hoursToLog,
      taskId: task.id,
      courseId: task.course_id || null,
      notes: logNote || `Quick logged ${minutesLabel(minutes)} from task details.`
    })
    setMsg(result?.completedTask
      ? `${minutesLabel(minutes)} logged and "${task.title}" is complete.${result.reviewTasksCreated ? ` Scheduled ${result.reviewTasksCreated} review tasks.` : ''}`
      : `${minutesLabel(minutes)} logged toward "${task.title}".`)
    setTimeout(() => setMsg(null), 2500)
    await load()
  }

  const heatmap = useMemo(() => {
    const byDate = {}
    log.forEach(r => { byDate[r.date] = (byDate[r.date] || 0) + r.hours })
    return Array.from({ length: 35 }, (_, i) => {
      const d = new Date()
      d.setDate(d.getDate() - 34 + i)
      const key = d.toISOString().slice(0, 10)
      return { key, day: d.getDate(), hours: byDate[key] || 0 }
    })
  }, [log])

  const todayPlanMinutes = (plan?.days || [])
    .find(day => day.date === todayKey())
    ?.blocks
    ?.reduce((sum, block) => sum + (block.end_minute - block.start_minute), 0) || 0
  const plannedHours = (todayPlanMinutes / 60).toFixed(1)
  const cushion = plan?.summary?.cushionMinutes ?? 0
  const cushionState = cushion < 0 ? 'danger' : cushion < 120 ? 'tight' : 'good'
  const planMeta = plan?.meta || {}

  return (
    <div className="page wide">
      <div className="page-header split">
        <div>
          <h1>Today</h1>
          <p>{daysLeft} days until exam. {plannedTodayTasks.length} study tasks assigned today.</p>
        </div>
        <div className="exam-card">
          <form onSubmit={saveExamDate} className="exam-date-form">
            <label>
              Exam date
              <input type="date" value={examDate} onChange={e => setExamDate(e.target.value)} />
            </label>
            <button className="secondary-btn compact">Save</button>
          </form>
          <div className="exam-progress">
            <span>Total progress</span>
            <strong>{totalHours.toFixed(1)}h / {target}h</strong>
            <div className="progress"><span style={{ width: `${pct}%` }} /></div>
          </div>
        </div>
      </div>

      <section className="quick-add-card">
        <form onSubmit={addTask} className="quick-add">
          <input
            value={quick}
            onChange={e => setQuick(e.target.value)}
            placeholder="Add study task: Review ports p1 45m tomorrow @review #comptia"
          />
          <button className="primary-btn">Add</button>
        </form>
        <div className="quick-hints">
          Use <code>today</code>, <code>tomorrow</code>, <code>p1</code>-<code>p4</code>, <code>30m</code>, <code>2h</code>, <code>@quiz</code>, <code>@review</code>, and <code>#course-name</code>.
        </div>
      </section>

      <div className="metric-grid">
        <div className="metric-card"><span>Assigned today</span><strong>{plannedTodayTasks.length}</strong></div>
        <div className="metric-card"><span>Planned focus</span><strong>{plannedHours}h</strong></div>
        <div className="metric-card"><span>Upcoming</span><strong>{stats?.upcoming || 0}</strong></div>
        <div className={`metric-card cushion ${cushionState}`}><span>Cushion</span><strong>{hoursLabel(cushion)}</strong></div>
      </div>

      <section className="panel shovel-planner">
        <div className="planner-head">
          <div>
            <h2>Shovel-style plan</h2>
            <p>Turns due dates into do dates by fitting your tasks into study windows.</p>
          </div>
          <div className="planner-controls">
            <div className="reset-actions">
              <button className="secondary-btn compact" onClick={() => resetStudyData('tasks')}>Clear tasks</button>
              <button className="secondary-btn compact" onClick={() => resetStudyData('logs')}>Clear logs</button>
              <button className="secondary-btn compact" onClick={() => resetStudyData('progress')}>Reset progress</button>
              <button className="danger-btn compact" onClick={() => resetStudyData('full')}>Full reset</button>
            </div>
            <label>
              Weekdays
              <span>
                <input type="time" value={planSettings?.weekday_start || '18:00'} onChange={e => savePlanSettings({ weekday_start: e.target.value })} />
                <input type="time" value={planSettings?.weekday_end || '22:00'} onChange={e => savePlanSettings({ weekday_end: e.target.value })} />
              </span>
            </label>
            <label>
              Weekends
              <span>
                <input type="time" value={planSettings?.weekend_start || '09:00'} onChange={e => savePlanSettings({ weekend_start: e.target.value })} />
                <input type="time" value={planSettings?.weekend_end || '13:00'} onChange={e => savePlanSettings({ weekend_end: e.target.value })} />
              </span>
            </label>
            <label className="planner-toggle">
              <input
                type="checkbox"
                checked={Boolean(planSettings?.use_calibrated_estimates)}
                onChange={e => savePlanSettings({ use_calibrated_estimates: e.target.checked })}
              />
              Use estimate calibration
            </label>
            <button className="primary-btn" onClick={generatePlan} disabled={planning}>
              {planning ? 'Planning...' : 'Auto-plan'}
            </button>
          </div>
        </div>

        <div className="plan-meta-strip">
          <span>Calculated {timestampLabel(planMeta.generatedAt || plan?.generated_at)}</span>
          <span>{planMeta.openTasks || 0} open tasks</span>
          <span>{planMeta.plannedBlocks || 0} planned blocks</span>
          <span>{planMeta.fixedEventCount || 0} recurring blocks</span>
          <span>{planMeta.exceptionCount || 0} one-off exceptions</span>
          <span>{planMeta.calibratedEstimates ? `${planMeta.estimateMultiplier}x calibrated estimates` : 'Raw estimates'}</span>
          <span>{planMeta.inputs?.weekday || '18:00-22:00'} weekdays</span>
          <span>{planMeta.inputs?.weekend || '09:00-13:00'} weekends</span>
        </div>

        <div className="cushion-strip">
          <div>
            <span>Available</span>
            <strong>{hoursLabel(plan?.summary?.totalAvailable || 0)}</strong>
          </div>
          <div>
            <span>Busy blocks</span>
            <strong>{hoursLabel(plan?.summary?.totalBusy || 0)}</strong>
          </div>
          <div>
            <span>Needed</span>
            <strong>{hoursLabel(plan?.summary?.totalNeeded || 0)}</strong>
          </div>
          <div>
            <span>Planned</span>
            <strong>{hoursLabel(plan?.summary?.plannedMinutes || 0)}</strong>
          </div>
          <div>
            <span>Unplanned</span>
            <strong>{hoursLabel(plan?.summary?.unplannedMinutes || 0)}</strong>
          </div>
        </div>

        <div className="fixed-events-panel">
          <form className="fixed-event-form" onSubmit={addFixedEvent}>
            <label>
              {editingEventId ? 'Editing block' : 'Fixed block'}
              <input
                value={eventDraft.title}
                onChange={e => setEventDraft({ ...eventDraft, title: e.target.value })}
                placeholder="Class, work, commute..."
              />
            </label>
            <label>
              Start
              <input type="time" value={eventDraft.start} onChange={e => setEventDraft({ ...eventDraft, start: e.target.value })} />
            </label>
            <label>
              End
              <input type="time" value={eventDraft.end} onChange={e => setEventDraft({ ...eventDraft, end: e.target.value })} />
            </label>
            <div className="weekday-picker" aria-label="Repeat days">
              {WEEKDAYS.map(day => (
                <button
                  key={day.id}
                  type="button"
                  className={eventDraft.days.includes(day.id) ? 'active' : ''}
                  onClick={() => toggleEventDay(day.id)}
                >
                  {day.label}
                </button>
              ))}
            </div>
            <button className="secondary-btn compact" disabled={!eventDraft.title.trim() || eventDraft.days.length === 0 || eventDraft.start >= eventDraft.end}>
              {editingEventId ? 'Save block' : 'Add fixed block'}
            </button>
            {editingEventId && (
              <button type="button" className="ghost-btn compact" onClick={cancelFixedEventEdit}>Cancel</button>
            )}
          </form>

          {fixedEvents.length > 0 && (
            <div className="fixed-event-list">
              {fixedEvents.map(event => (
                <span key={event.id} className={`fixed-event-chip ${editingEventId === event.id ? 'active' : ''}`}>
                  <button className="chip-main" onClick={() => editFixedEvent(event)}>
                    {event.title} {event.start}-{event.end}
                  </button>
                  <button onClick={() => removeFixedEvent(event.id)} aria-label={`Delete ${event.title}`}>x</button>
                </span>
              ))}
            </div>
          )}

          <form className="exception-form" onSubmit={saveScheduleException}>
            <label>
              One-off exception
              <input
                value={exceptionDraft.title}
                onChange={e => setExceptionDraft({ ...exceptionDraft, title: e.target.value })}
                placeholder="Doctor, family event, extra work..."
              />
            </label>
            <label>
              Date
              <input type="date" value={exceptionDraft.date} onChange={e => setExceptionDraft({ ...exceptionDraft, date: e.target.value })} />
            </label>
            <label>
              Start
              <input type="time" value={exceptionDraft.start} onChange={e => setExceptionDraft({ ...exceptionDraft, start: e.target.value })} />
            </label>
            <label>
              End
              <input type="time" value={exceptionDraft.end} onChange={e => setExceptionDraft({ ...exceptionDraft, end: e.target.value })} />
            </label>
            <button className="secondary-btn compact" disabled={!exceptionDraft.title.trim() || !exceptionDraft.date || exceptionDraft.start >= exceptionDraft.end}>
              {editingExceptionId ? 'Save exception' : 'Add exception'}
            </button>
            {editingExceptionId && (
              <button type="button" className="ghost-btn compact" onClick={cancelExceptionEdit}>Cancel</button>
            )}
          </form>

          {exceptions.length > 0 && (
            <div className="fixed-event-list">
              {exceptions.slice(0, 8).map(event => (
                <span key={event.id} className={`exception-chip ${editingExceptionId === event.id ? 'active' : ''}`}>
                  <button className="chip-main" onClick={() => editScheduleException(event)}>
                    {event.date}: {event.title} {event.start}-{event.end}
                  </button>
                  <button onClick={() => removeScheduleException(event.id)} aria-label={`Delete ${event.title}`}>x</button>
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="week-plan">
          {(plan?.days || []).slice(0, 7).map(day => (
            <div key={day.date} className="plan-day">
              <div className="plan-day-head">
                <strong>{dayLabel(day.date)}</strong>
                <span>{hoursLabel(day.available)} available</span>
              </div>
              <div className="plan-blocks">
                {(day.fixed_events || []).map(event => (
                  <div key={`fixed-${event.id}`} className="fixed-block">
                    <span>{event.start_label} - {event.end_label}</span>
                    <strong>{event.title}</strong>
                  </div>
                ))}
                {(day.exceptions || []).map(event => (
                  <div key={`exception-${event.id}`} className="exception-block">
                    <span>{event.start_label} - {event.end_label}</span>
                    <strong>{event.title}</strong>
                  </div>
                ))}
                {day.blocks.length === 0 ? (
                  <div className="free-block">Free study time</div>
                ) : day.blocks.map(block => (
                  <button key={block.id} className="planned-block" onClick={() => setActiveTaskId(block.task_id)}>
                    <span>{block.start_label} - {block.end_label}</span>
                    <strong>{block.title}</strong>
                    {block.course_name && <em>{block.course_name}</em>}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="planner-grid">
        <section className="panel task-panel">
          <div className="filter-row">
            {FILTERS.map(item => (
              <button key={item.id} onClick={() => setFilter(item.id)} className={filter === item.id ? 'active' : ''}>
                {item.label}
              </button>
            ))}
          </div>

          <div className="task-search-tools">
            <input
              className="field"
              value={taskQuery}
              onChange={e => setTaskQuery(e.target.value)}
              placeholder="Search task, topic, notes, course..."
            />
            <select className="field" value={taskKindFilter} onChange={e => setTaskKindFilter(e.target.value)}>
              <option value="all">All types</option>
              {KINDS.map(kind => <option key={kind} value={kind}>{kind}</option>)}
            </select>
            <select className="field" value={taskCourseFilter} onChange={e => setTaskCourseFilter(e.target.value)}>
              <option value="all">All courses</option>
              {courses.map(course => <option key={course.id} value={course.id}>{course.name}</option>)}
            </select>
            {(taskQuery || taskKindFilter !== 'all' || taskCourseFilter !== 'all') && (
              <button
                className="ghost-btn compact"
                onClick={() => {
                  setTaskQuery('')
                  setTaskKindFilter('all')
                  setTaskCourseFilter('all')
                }}
              >
                Clear
              </button>
            )}
            <span>{filteredTasks.length}/{visibleTasks.length}</span>
          </div>

          {filteredTasks.length === 0 ? (
            <div className="empty-state">
              <h2>No tasks here.</h2>
              <p>{visibleTasks.length === 0 ? (filter === 'today' ? "No tasks are assigned in today's plan." : 'Capture the next thing you need to read, review, quiz, or practice.') : 'No tasks match the current search and filters.'}</p>
            </div>
          ) : (
            <div className="task-list">
              {filteredTasks.map(task => (
                <TaskRow
                  key={task.id}
                  task={task}
                  onOpen={() => setActiveTaskId(task.id)}
                  onComplete={completeTask}
                  onReschedule={reschedule}
                  onDelete={deleteTask}
                />
              ))}
            </div>
          )}
        </section>

        <aside className="right-rail">
          <section className="panel">
            <h2>Log session</h2>
            <label>Date</label>
            <input className="field" type="date" value={logDate} onChange={e => setLogDate(e.target.value)} />
            <label>Hours</label>
            <input className="field" type="number" min="0.25" max="12" step="0.25" value={hours} onChange={e => setHours(parseFloat(e.target.value) || 0)} />
            <label>Apply to task</label>
            <select
              className="field"
              value={selectedTask}
              onChange={e => {
                const id = e.target.value
                const task = id ? allTasks.find(t => t.id === Number(id)) : null
                setSelectedTask(id)
                if (task?.course_id) setSelectedCourse(String(task.course_id))
              }}
            >
              <option value="">Manual time only</option>
              {logTasks.map(t => (
                <option key={t.id} value={t.id}>
                  {t.title} ({minutesLabel(t.remaining_minutes ?? t.estimate_minutes)} left)
                </option>
              ))}
            </select>
            <label>Course</label>
            <select className="field" value={selectedCourse} onChange={e => setSelectedCourse(e.target.value)}>
              <option value="">No course</option>
              {courses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <label>Note</label>
            <input className="field" value={note} onChange={e => setNote(e.target.value)} placeholder="What did you work on?" />
            <button className="primary-btn full" onClick={logSession} disabled={hours <= 0}>Log study time</button>
            {msg && <div className="success-msg">{msg}</div>}
          </section>

          <section className="panel">
            <h2>Last 35 days</h2>
            <div className="heatmap">
              {heatmap.map(d => (
                <span
                  key={d.key}
                  title={`${d.key}: ${d.hours}h`}
                  className={`heat h${Math.min(4, Math.ceil(d.hours))}`}
                >
                  {d.day}
                </span>
              ))}
            </div>
          </section>

          {log.length > 0 && (
            <section className="panel">
              <h2>Recent sessions</h2>
              <div className="session-list">
                {log.slice(0, 5).map(r => (
                  <div key={r.id} className="session-row">
                    <span>
                      {r.date}
                      {r.task_title && <em>{r.task_title}</em>}
                    </span>
                    <strong>{r.hours}h</strong>
                  </div>
                ))}
              </div>
            </section>
          )}
        </aside>
      </div>

      <TaskDetailModal
        task={activeTask}
        draft={taskDraft}
        setDraft={setTaskDraft}
        onClose={() => setActiveTaskId(null)}
        onSave={saveTaskDraft}
        onComplete={completeTask}
        onReschedule={reschedule}
        onDelete={deleteTask}
        onLogTime={logTaskMinutes}
      />
    </div>
  )
}
