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

const DEFAULT_COURSE_SETTINGS = {
  difficulty: 'normal',
  priority: 3,
  target_score: 85,
  reading_speed: 110,
  quiz_frequency: 'normal'
}

function normalizeCourseSettings(settings = {}) {
  return {
    difficulty: ['easy', 'normal', 'hard', 'exam'].includes(settings.difficulty) ? settings.difficulty : 'normal',
    priority: Math.max(1, Math.min(4, Number(settings.priority || 3))),
    target_score: Math.max(50, Math.min(100, Number(settings.target_score || 85))),
    reading_speed: Math.max(50, Math.min(260, Number(settings.reading_speed || 110))),
    quiz_frequency: ['low', 'normal', 'high'].includes(settings.quiz_frequency) ? settings.quiz_frequency : 'normal'
  }
}

function difficultyMultiplier(settings = DEFAULT_COURSE_SETTINGS) {
  return {
    easy: 0.85,
    normal: 1,
    hard: 1.25,
    exam: 1.45
  }[settings.difficulty] || 1
}

function quizEstimateMinutes(settings = DEFAULT_COURSE_SETTINGS) {
  return {
    low: 15,
    normal: 20,
    high: 30
  }[settings.quiz_frequency] || 20
}

function shouldCreateQuizTask(index, estimate, rawSettings = DEFAULT_COURSE_SETTINGS) {
  const settings = normalizeCourseSettings(rawSettings)
  if (settings.quiz_frequency === 'high') return true
  if (settings.quiz_frequency === 'normal') return estimate.complexity === 'heavy' || (index + 1) % 3 === 0
  return estimate.complexity === 'heavy' && (index + 1) % 5 === 0
}

function estimateTopic(topic, rawSettings = DEFAULT_COURSE_SETTINGS) {
  const settings = normalizeCourseSettings(rawSettings)
  const content = String(topic.content || '')
  const title = String(topic.title || '')
  const words = wordCount(content)
  const bulletSignals = (content.match(/[•\n-]/g) || []).length
  const objectiveSignals = (content.match(/\b\d+\.\d+\b/g) || []).length
  const continued = /\bcontinued\b/i.test(title)
  const denseWords = /\b(configur|implement|compare|analyz|troubleshoot|attack|protocol|crypt|architecture|framework|policy)\b/i.test(`${title} ${content}`)

  let estimate = 20
  estimate += Math.ceil(words / settings.reading_speed) * 10
  estimate += Math.min(20, Math.ceil(bulletSignals / 8) * 5)
  estimate += Math.min(20, Math.ceil(objectiveSignals / 4) * 5)
  if (continued) estimate += 10
  if (denseWords) estimate += 15

  estimate = Math.round((estimate * difficultyMultiplier(settings)) / 5) * 5
  estimate = Math.min(150, Math.max(20, estimate))
  const complexityScore = estimate + (denseWords ? 10 : 0) + (continued ? 5 : 0)
  const complexity = complexityScore >= 80 ? 'heavy' : complexityScore >= 50 ? 'medium' : 'light'

  return { minutes: estimate, words, complexity }
}

function defaultStudySubtasks(topic, estimate, rawSettings = DEFAULT_COURSE_SETTINGS) {
  const settings = normalizeCourseSettings(rawSettings)
  const title = topic.title || 'section'
  const steps = [
    `Preview ${title}`,
    'Read and mark confusing points',
    'Write 3-5 recall questions',
    'Do a quick self-quiz',
    estimate.complexity === 'heavy' ? 'Schedule a second review pass' : 'Summarize the key idea'
  ]

  if (settings.quiz_frequency === 'high') {
    steps.push('Do extra quiz practice until you can explain missed answers')
  }

  return steps.map((step, index) => ({
    id: `${topic.id || title}-${index}`,
    title: step,
    completed: 0
  }))
}

function defaultQuizSubtasks(topic) {
  return [
    { id: `${topic.id}-quiz-attempt`, title: 'Answer saved or AI-generated questions', completed: 0 },
    { id: `${topic.id}-quiz-missed`, title: 'Turn missed answers into a review task', completed: 0 }
  ]
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
  const [courseSettings, setCourseSettings] = useState(DEFAULT_COURSE_SETTINGS)

  useEffect(() => { loadCourses() }, [])
  useEffect(() => { if (selected) loadTopics(selected.id) }, [selected])
  useEffect(() => {
    if (selected) setCourseSettings(normalizeCourseSettings(selected.study_settings))
  }, [selected?.id, selected?.study_settings])

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

  async function saveCourseSettings() {
    if (!selected) return
    const settings = normalizeCourseSettings(courseSettings)
    const updated = await window.api.updateCourse({
      id: selected.id,
      patch: { study_settings: settings }
    })
    if (!updated) return
    setSelected(updated)
    setCourses(current => current.map(course => course.id === updated.id ? updated : course))
    setCourseSettings(updated.study_settings)
    setMsg('Saved course study settings. New tasks will use these estimates and priorities.')
    onDataChange?.()
  }

  async function applySettingsToExistingTasks() {
    if (!selected) return
    const settings = normalizeCourseSettings(courseSettings)
    const updated = await window.api.updateCourse({
      id: selected.id,
      patch: { study_settings: settings }
    })
    if (updated) {
      setSelected(updated)
      setCourses(current => current.map(course => course.id === updated.id ? updated : course))
      setCourseSettings(updated.study_settings)
    }

    const allTasks = await window.api.getTasks('all')
    const topicById = new Map(topics.map(topic => [topic.id, topic]))
    const courseTasks = allTasks.filter(task =>
      task.course_id === selected.id &&
      !task.completed &&
      task.topic_id &&
      topicById.has(task.topic_id)
    )

    let updatedCount = 0
    await Promise.all(courseTasks.map(task => {
      const topic = topicById.get(task.topic_id)
      let estimateMinutes = task.estimate_minutes
      let subtasks = task.subtasks

      if (task.kind === 'study') {
        const estimate = estimateTopic(topic, settings)
        estimateMinutes = estimate.minutes
        subtasks = defaultStudySubtasks(topic, estimate, settings)
      } else if (task.kind === 'quiz') {
        estimateMinutes = quizEstimateMinutes(settings)
        subtasks = defaultQuizSubtasks(topic)
      } else if (task.kind === 'read' || task.kind === 'review') {
        estimateMinutes = Math.round(((task.kind === 'read' ? 35 : 30) * difficultyMultiplier(settings)) / 5) * 5
      }

      updatedCount++
      return window.api.updateTask({
        id: task.id,
        patch: {
          priority: task.kind === 'quiz' ? Math.min(2, settings.priority) : settings.priority,
          estimate_minutes: estimateMinutes,
          subtasks
        }
      })
    }))

    const openTopics = topics.filter(topic => !topic.completed)
    const openQuizTopicIds = new Set(courseTasks.filter(task => task.kind === 'quiz').map(task => task.topic_id))
    let createdQuizCount = 0
    await Promise.all(openTopics.map((topic, index) => {
      const estimate = estimateTopic(topic, settings)
      if (!shouldCreateQuizTask(index, estimate, settings) || openQuizTopicIds.has(topic.id)) {
        return Promise.resolve(null)
      }

      createdQuizCount++
      return window.api.createTask({
        title: `Quiz ${topic.title}`,
        kind: 'quiz',
        courseId: selected.id,
        topicId: topic.id,
        dueDate: todayKey(1),
        priority: Math.min(2, settings.priority),
        estimateMinutes: quizEstimateMinutes(settings),
        subtasks: defaultQuizSubtasks(topic),
        notes: [
          `Auto-created while applying ${settings.quiz_frequency} quiz frequency to existing course tasks.`,
          `Target score: ${settings.target_score}%.`,
          topic.content?.slice(0, 220) || ''
        ].filter(Boolean).join('\n\n')
      })
    }))

    await window.api.generateStudyPlan()
    setMsg(`Updated ${updatedCount} existing task${updatedCount === 1 ? '' : 's'} and added ${createdQuizCount} quiz task${createdQuizCount === 1 ? '' : 's'} from these course settings.`)
    onDataChange?.()
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
    const settings = normalizeCourseSettings(courseSettings)
    const estimateMinutes = kind === 'quiz'
      ? quizEstimateMinutes(settings)
      : Math.round(((kind === 'read' ? 35 : 30) * difficultyMultiplier(settings)) / 5) * 5

    await window.api.createTask({
      title: `${kind === 'quiz' ? 'Quiz' : kind === 'read' ? 'Read' : 'Review'} ${topic.title}`,
      kind,
      courseId: selected.id,
      topicId: topic.id,
      dueDate,
      priority: kind === 'quiz' ? Math.min(2, settings.priority) : settings.priority,
      estimateMinutes,
      notes: [
        `Course settings: ${settings.difficulty} difficulty, ${settings.quiz_frequency} quiz frequency, target ${settings.target_score}%.`,
        topic.content?.slice(0, 300) || ''
      ].filter(Boolean).join('\n\n')
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
    const settings = normalizeCourseSettings(courseSettings)
    for (let i = 0; i < openTopics.length; i++) {
      const topic = openTopics[i]
      const dueOffset = Math.min(spanDays, Math.floor((i / Math.max(1, openTopics.length - 1)) * spanDays))
      const estimate = estimateTopic(topic, settings)

      builtTasks.push({
        title: `Study ${topic.title}`,
        kind: 'study',
        courseId: selected.id,
        topicId: topic.id,
        dueDate: todayKey(dueOffset),
        priority: dueOffset <= 2 ? Math.min(2, settings.priority) : settings.priority,
        estimateMinutes: estimate.minutes,
        subtasks: defaultStudySubtasks(topic, estimate, settings),
        notes: [
          `Auto-estimate: ${estimate.complexity} section, ${estimate.words} words, ${estimate.minutes} minutes.`,
          `Course settings: ${settings.difficulty} difficulty, priority P${settings.priority}, target ${settings.target_score}%, ${settings.quiz_frequency} quiz frequency.`,
          topic.content?.slice(0, 300) || ''
        ].filter(Boolean).join('\n\n')
      })

      if (shouldCreateQuizTask(i, estimate, settings)) {
        builtTasks.push({
          title: `Quiz ${topic.title}`,
          kind: 'quiz',
          courseId: selected.id,
          topicId: topic.id,
          dueDate: todayKey(Math.min(spanDays, dueOffset + 1)),
          priority: Math.min(2, settings.priority),
          estimateMinutes: quizEstimateMinutes(settings),
          subtasks: defaultQuizSubtasks(topic),
          notes: [
            `Auto-created because this course uses ${settings.quiz_frequency} quiz frequency.`,
            `Target score: ${settings.target_score}%.`,
            topic.content?.slice(0, 220) || ''
          ].filter(Boolean).join('\n\n')
        })
      }
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
    const rows = openTopics.map(topic => ({ topic, estimate: estimateTopic(topic, courseSettings) }))
    const studyMinutes = rows.reduce((sum, row) => sum + row.estimate.minutes, 0)
    const heavy = rows.filter(row => row.estimate.complexity === 'heavy').length
    const medium = rows.filter(row => row.estimate.complexity === 'medium').length
    const light = rows.filter(row => row.estimate.complexity === 'light').length
    const quizTasks = rows.filter((row, index) => shouldCreateQuizTask(index, row.estimate, courseSettings)).length
    const quizMinutes = quizTasks * quizEstimateMinutes(courseSettings)
    const totalMinutes = studyMinutes + quizMinutes
    const biggest = [...rows].sort((a, b) => b.estimate.minutes - a.estimate.minutes).slice(0, 3)
    return {
      open: openTopics.length,
      totalMinutes,
      studyMinutes,
      quizMinutes,
      averageMinutes: rows.length ? Math.round(studyMinutes / rows.length) : 0,
      heavy,
      medium,
      light,
      quizTasks,
      biggest
    }
  }, [topics, courseSettings])

  return (
    <div className="page courses-page">
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
                <div className="course-hero-copy">
                  <h2>{selected.name}</h2>
                  <p>{done}/{topics.length} sections complete. {pct}% finished.</p>
                  <div className="course-summary-strip">
                    <span>{topics.length} sections</span>
                    <span>{Math.max(0, topics.length - done)} left</span>
                    <span>{courseSettings.difficulty} difficulty</span>
                    <span>{courseSettings.quiz_frequency} quiz</span>
                  </div>
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

              <div className="panel course-settings-panel">
                <div>
                  <h2>Study settings</h2>
                  <p>Controls estimates, priority, and how aggressively this course creates quiz practice.</p>
                </div>
                <div className="course-settings-grid">
                  <label>
                    Difficulty
                    <select className="field" value={courseSettings.difficulty} onChange={e => setCourseSettings(s => ({ ...s, difficulty: e.target.value }))}>
                      <option value="easy">Easy</option>
                      <option value="normal">Normal</option>
                      <option value="hard">Hard</option>
                      <option value="exam">Exam prep</option>
                    </select>
                  </label>
                  <label>
                    Priority
                    <select className="field" value={courseSettings.priority} onChange={e => setCourseSettings(s => ({ ...s, priority: Number(e.target.value) }))}>
                      <option value={1}>P1 urgent</option>
                      <option value={2}>P2 high</option>
                      <option value={3}>P3 normal</option>
                      <option value={4}>P4 light</option>
                    </select>
                  </label>
                  <label>
                    Target score
                    <input className="field" type="number" min="50" max="100" value={courseSettings.target_score} onChange={e => setCourseSettings(s => ({ ...s, target_score: Number(e.target.value) }))} />
                  </label>
                  <label>
                    Reading speed
                    <input className="field" type="number" min="50" max="260" value={courseSettings.reading_speed} onChange={e => setCourseSettings(s => ({ ...s, reading_speed: Number(e.target.value) }))} />
                    <span>Words per 10 minutes</span>
                  </label>
                  <label>
                    Quiz frequency
                    <select className="field" value={courseSettings.quiz_frequency} onChange={e => setCourseSettings(s => ({ ...s, quiz_frequency: e.target.value }))}>
                      <option value="low">Low</option>
                      <option value="normal">Normal</option>
                      <option value="high">High</option>
                    </select>
                  </label>
                  <button className="primary-btn" onClick={saveCourseSettings}>Save settings</button>
                  <button className="secondary-btn" onClick={applySettingsToExistingTasks}>Apply to tasks</button>
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
                    <div><span>Quiz tasks</span><strong>{taskPreview.quizTasks}</strong></div>
                  </div>
                  <div className="complexity-row">
                    <span>{minutesLabel(taskPreview.studyMinutes)} study</span>
                    <span>{minutesLabel(taskPreview.quizMinutes)} quiz</span>
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
                <div className="panel sections-panel">
                  <div className="panel-title-row sections-title">
                    <div>
                      <h2>Sections</h2>
                      <p>Mark progress, create one-off tasks, or use the builder above for a full study plan.</p>
                    </div>
                    <span>{topics.length}</span>
                  </div>
                  <div className="topic-list">
                    {topics.map(t => (
                      <article key={t.id} className={`topic-row ${t.completed ? 'completed' : ''}`}>
                        <input type="checkbox" checked={!!t.completed} onChange={() => toggleTopic(t.id, t.completed)} />
                        <div className="topic-body">
                          <div className="topic-heading">
                            <h3 className={t.completed ? 'done-text' : ''}>{t.title}</h3>
                            <span>{t.completed ? 'Done' : 'Open'}</span>
                          </div>
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
