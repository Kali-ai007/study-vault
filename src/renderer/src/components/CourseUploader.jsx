import { useEffect, useMemo, useState } from 'react'

function todayKey(offset = 0) {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return d.toISOString().slice(0, 10)
}

function minutesLabel(minutes) {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (!h) return `${m}m`
  return m ? `${h}h ${m}m` : `${h}h`
}

function wordCount(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean).length
}

function estimateTopic(topic) {
  const content = String(topic.content || '')
  const title = String(topic.title || '')
  const words = wordCount(content)
  const bulletSignals = (content.match(/[•\n-]/g) || []).length
  const objectiveSignals = (content.match(/\b\d+\.\d+\b/g) || []).length
  const continued = /\bcontinued\b/i.test(title)
  const denseWords = /\b(configur|implement|compare|analyz|troubleshoot|attack|protocol|crypt|architecture|framework|policy)\b/i.test(`${title} ${content}`)

  let estimate = 20
  estimate += Math.ceil(words / 110) * 10
  estimate += Math.min(20, Math.ceil(bulletSignals / 8) * 5)
  estimate += Math.min(20, Math.ceil(objectiveSignals / 4) * 5)
  if (continued) estimate += 10
  if (denseWords) estimate += 15

  estimate = Math.min(120, Math.max(25, Math.round(estimate / 5) * 5))
  const complexityScore = estimate + (denseWords ? 10 : 0) + (continued ? 5 : 0)
  const complexity = complexityScore >= 80 ? 'heavy' : complexityScore >= 50 ? 'medium' : 'light'

  return { minutes: estimate, words, complexity }
}

function defaultStudySubtasks(topic, estimate) {
  const title = topic.title || 'section'
  const steps = [
    `Preview ${title}`,
    'Read and mark confusing points',
    'Write 3-5 recall questions',
    'Do a quick self-quiz',
    estimate.complexity === 'heavy' ? 'Schedule a second review pass' : 'Summarize the key idea'
  ]

  return steps.map((step, index) => ({
    id: `${topic.id || title}-${index}`,
    title: step,
    completed: 0
  }))
}

export default function CourseUploader({ onDataChange }) {
  const [courses, setCourses] = useState([])
  const [selected, setSelected] = useState(null)
  const [topics, setTopics] = useState([])
  const [uploading, setUploading] = useState(false)
  const [msg, setMsg] = useState(null)
  const [newName, setNewName] = useState('')
  const [useAi, setUseAi] = useState(true)
  const [progressInput, setProgressInput] = useState(0)

  useEffect(() => { loadCourses() }, [])
  useEffect(() => { if (selected) loadTopics(selected.id) }, [selected])

  async function loadCourses() {
    const data = await window.api.getCourses()
    setCourses(data)
    if (data.length > 0 && !selected) setSelected(data[0])
  }

  async function loadTopics(id) {
    const data = await window.api.getTopics(id)
    setTopics(data)
    const done = data.filter(t => t.completed).length
    setProgressInput(data.length ? Math.round((done / data.length) * 100) : 0)
  }

  async function upload() {
    if (!selected) return
    setUploading(true)
    setMsg('Choose a file to import.')
    const file = await window.api.openFile()
    if (!file) { setUploading(false); return }
    if (file.error) { setMsg('Error: ' + file.error); setUploading(false); return }
    if (!file.content || file.content.trim().length < 10) {
      setMsg('File appears empty or could not be read.')
      setUploading(false)
      return
    }

    setMsg('Organizing sections...')
    const structured = await window.api.structureCourse({ name: file.name, content: file.content, useAi })
    if (!structured?.ok || !structured.topics?.length) {
      setMsg(structured?.error || 'Could not find study sections in this file.')
      setUploading(false)
      return
    }

    const replace = topics.length > 0
      ? confirm(`Replace the existing ${topics.length} sections in "${selected.name}" with ${structured.topics.length} newly organized sections?`)
      : false

    if (replace) {
      await window.api.replaceTopics({ courseId: selected.id, topics: structured.topics })
    } else {
      await window.api.insertTopics({ courseId: selected.id, topics: structured.topics })
    }

    setMsg(`${replace ? 'Replaced' : 'Imported'} ${structured.topics.length} sections from "${file.name}" using ${structured.method}.`)
    await loadTopics(selected.id)
    setUploading(false)
  }

  async function createCourse() {
    if (!newName.trim()) return
    const course = await window.api.createCourse({ name: newName.trim(), description: '' })
    setNewName('')
    await loadCourses()
    setSelected(course)
  }

  async function deleteCourse(id) {
    if (!confirm('Delete this course and all its topics?')) return
    await window.api.deleteCourse(id)
    setSelected(null)
    setTopics([])
    await loadCourses()
    onDataChange?.()
  }

  async function toggleTopic(id, completed) {
    await window.api.toggleTopic({ id, completed: !completed })
    await loadTopics(selected.id)
    onDataChange?.()
  }

  async function planTopic(topic, kind, dueDate) {
    await window.api.createTask({
      title: `${kind === 'quiz' ? 'Quiz' : kind === 'read' ? 'Read' : 'Review'} ${topic.title}`,
      kind,
      courseId: selected.id,
      topicId: topic.id,
      dueDate,
      priority: kind === 'quiz' ? 2 : 3,
      estimateMinutes: kind === 'quiz' ? 20 : 35,
      notes: topic.content?.slice(0, 300) || ''
    })
    setMsg(`Added "${topic.title}" to ${dueDate === todayKey() ? 'today' : 'tomorrow'}`)
    onDataChange?.()
  }

  async function buildTasksFromSections() {
    if (!selected || topics.length === 0) return
    const allTasks = await window.api.getTasks('all')
    const courseTasks = allTasks.filter(t => t.course_id === selected.id)
    if (courseTasks.length > 0) {
      const replace = confirm(`This course already has ${courseTasks.length} tasks. Replace them with a clean set from the current unfinished sections?`)
      if (replace) {
        await window.api.deleteCourseTasks(selected.id)
      } else {
        setMsg('Kept existing tasks. No new clean plan was built.')
        return
      }
    }

    const openTopics = topics.filter(t => !t.completed)
    const examDate = await window.api.getSetting('exam_date')
    const deadline = examDate || todayKey(14)
    const today = new Date(`${todayKey()}T12:00:00`)
    const last = new Date(`${deadline}T12:00:00`)
    const spanDays = Math.max(1, Math.ceil((last - today) / 86400000))

    const builtTasks = []
    for (let i = 0; i < openTopics.length; i++) {
      const topic = openTopics[i]
      const dueOffset = Math.min(spanDays, Math.floor((i / Math.max(1, openTopics.length - 1)) * spanDays))
      const estimate = estimateTopic(topic)

      builtTasks.push({
        title: `Study ${topic.title}`,
        kind: 'study',
        courseId: selected.id,
        topicId: topic.id,
        dueDate: todayKey(dueOffset),
        priority: dueOffset <= 2 ? 2 : 3,
        estimateMinutes: estimate.minutes,
        subtasks: defaultStudySubtasks(topic, estimate),
        notes: [
          `Auto-estimate: ${estimate.complexity} section, ${estimate.words} words, ${estimate.minutes} minutes.`,
          topic.content?.slice(0, 300) || ''
        ].filter(Boolean).join('\n\n')
      })
    }

    const result = await window.api.bulkCreateStudyTasks({ courseId: selected.id, tasks: builtTasks })
    setMsg(`Created ${result.created} clean study tasks from unfinished sections. Go to Today and click Auto-plan.`)
    onDataChange?.()
  }

  async function applyProgress() {
    if (!selected) return
    const result = await window.api.setCourseProgress({ courseId: selected.id, percent: progressInput })
    setMsg(`Marked ${result.completed}/${result.total} sections complete. Linked tasks were synced.`)
    await loadTopics(selected.id)
    onDataChange?.()
  }

  async function deleteCourseTasks() {
    if (!selected) return
    if (!confirm(`Delete all study tasks for "${selected.name}"? Course sections stay intact.`)) return
    const result = await window.api.deleteCourseTasks(selected.id)
    setMsg(`Deleted ${result.deleted} tasks for this course.`)
    onDataChange?.()
  }

  const done = topics.filter(t => t.completed).length
  const pct = topics.length ? Math.round((done / topics.length) * 100) : 0
  const taskPreview = useMemo(() => {
    const openTopics = topics.filter(t => !t.completed)
    const rows = openTopics.map(topic => ({ topic, estimate: estimateTopic(topic) }))
    const totalMinutes = rows.reduce((sum, row) => sum + row.estimate.minutes, 0)
    const heavy = rows.filter(row => row.estimate.complexity === 'heavy').length
    const medium = rows.filter(row => row.estimate.complexity === 'medium').length
    const light = rows.filter(row => row.estimate.complexity === 'light').length
    const biggest = [...rows].sort((a, b) => b.estimate.minutes - a.estimate.minutes).slice(0, 3)
    return {
      open: openTopics.length,
      totalMinutes,
      averageMinutes: rows.length ? Math.round(totalMinutes / rows.length) : 0,
      heavy,
      medium,
      light,
      biggest
    }
  }, [topics])

  return (
    <div className="page">
      <div className="page-header">
        <h1>Courses</h1>
        <p>Upload material, split it into sections, and turn sections into study tasks.</p>
      </div>

      <div className="courses-layout">
        <aside className="panel course-sidebar">
          <div className="panel-title-row">
            <h2>Courses</h2>
            <span>{courses.length}</span>
          </div>
          {courses.length === 0 && <p className="muted">No courses yet.</p>}
          {courses.map(c => (
            <button key={c.id} onClick={() => setSelected(c)} className={`course-item ${selected?.id === c.id ? 'active' : ''}`}>
              <span>{c.name}</span>
              <span onClick={e => { e.stopPropagation(); deleteCourse(c.id) }}>x</span>
            </button>
          ))}

          <div className="course-create">
            <label>New course</label>
            <input className="field" value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === 'Enter' && createCourse()} placeholder="Course name" />
            <button className="primary-btn full" onClick={createCourse}>Create</button>
          </div>
        </aside>

        <section className="course-main">
          {!selected ? (
            <div className="panel empty-state">
              <h2>Select or create a course.</h2>
              <p>Your uploaded PDFs, Markdown, JSON, and text files will be organized here.</p>
            </div>
          ) : (
            <>
              <div className="panel course-hero">
                <div>
                  <h2>{selected.name}</h2>
                  <p>{done}/{topics.length} sections complete. {pct}% finished.</p>
                </div>
                <div className="course-import-actions">
                  <label className="ai-toggle">
                    <input type="checkbox" checked={useAi} onChange={e => setUseAi(e.target.checked)} />
                    <span>Use AI fallback</span>
                  </label>
                  {topics.length > 0 && (
                    <button className="secondary-btn" onClick={buildTasksFromSections}>
                      Build study tasks
                    </button>
                  )}
                  <button className="primary-btn" onClick={upload} disabled={uploading}>
                    {uploading ? 'Organizing...' : topics.length ? 'Re-import content' : 'Upload content'}
                  </button>
                </div>
                <div className="progress wide"><span style={{ width: `${pct}%` }} /></div>
                {msg && <div className="info-msg">{msg}</div>}
              </div>

              <div className="panel course-progress-tools">
                <div>
                  <h2>Already studied some?</h2>
                  <p>Set your real progress and Study Vault will mark those sections complete and sync linked tasks.</p>
                </div>
                <div className="progress-control">
                  <input type="range" min="0" max="100" value={progressInput} onChange={e => setProgressInput(Number(e.target.value))} />
                  <strong>{progressInput}%</strong>
                  <button className="secondary-btn" onClick={applyProgress}>Apply progress</button>
                  <button className="danger-btn" onClick={deleteCourseTasks}>Delete course tasks</button>
                </div>
              </div>

              {topics.length > 0 && (
                <div className="panel task-builder-preview">
                  <div>
                    <h2>Study task preview</h2>
                    <p className="muted">Before building tasks, this estimates workload from section length and density.</p>
                  </div>
                  <div className="preview-metrics">
                    <div><span>Unfinished</span><strong>{taskPreview.open}</strong></div>
                    <div><span>Total workload</span><strong>{minutesLabel(taskPreview.totalMinutes)}</strong></div>
                    <div><span>Average section</span><strong>{minutesLabel(taskPreview.averageMinutes)}</strong></div>
                    <div><span>Complexity</span><strong>{taskPreview.heavy} heavy</strong></div>
                  </div>
                  <div className="complexity-row">
                    <span>{taskPreview.light} light</span>
                    <span>{taskPreview.medium} medium</span>
                    <span>{taskPreview.heavy} heavy</span>
                  </div>
                  {taskPreview.biggest.length > 0 && (
                    <div className="biggest-sections">
                      {taskPreview.biggest.map(({ topic, estimate }) => (
                        <span key={topic.id}>{topic.title}: {minutesLabel(estimate.minutes)}</span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {topics.length === 0 ? (
                <div className="panel empty-state">
                  <h2>No topics yet.</h2>
                  <p>Upload a PDF, Markdown, JSON, or text file to create the first study sections.</p>
                </div>
              ) : (
                <div className="panel">
                  <div className="panel-title-row">
                    <h2>Sections</h2>
                    <span>{topics.length}</span>
                  </div>
                  <div className="topic-list">
                    {topics.map(t => (
                      <article key={t.id} className="topic-row">
                        <input type="checkbox" checked={!!t.completed} onChange={() => toggleTopic(t.id, t.completed)} />
                        <div className="topic-body">
                          <h3 className={t.completed ? 'done-text' : ''}>{t.title}</h3>
                          {t.content && <p>{t.content.slice(0, 190)}{t.content.length > 190 ? '...' : ''}</p>}
                          <div className="topic-actions">
                            <button onClick={() => planTopic(t, 'read', todayKey())}>Read today</button>
                            <button onClick={() => planTopic(t, 'review', todayKey(1))}>Review tomorrow</button>
                            <button onClick={() => planTopic(t, 'quiz', todayKey())}>Quiz task</button>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  )
}
