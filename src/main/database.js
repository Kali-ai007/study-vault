import Store from 'electron-store'

const store = new Store({
  name: 'studyvault-data',
  defaults: {
    courses: [],
    topics: [],
    tasks: [],
    plan_blocks: [],
    fixed_events: [],
    schedule_exceptions: [],
    study_log: [],
    quiz_questions: [],
    settings: {
      exam_date: '2026-07-15',
      study_plan: {
        weekday_start: '18:00',
        weekday_end: '22:00',
        weekend_start: '09:00',
        weekend_end: '13:00',
        min_block_minutes: 30,
        max_block_minutes: 90,
        use_calibrated_estimates: false,
        horizon_days: 14
      }
    }
  }
})

const BACKUP_KEYS = [
  'courses',
  'topics',
  'tasks',
  'plan_blocks',
  'fixed_events',
  'schedule_exceptions',
  'study_log',
  'quiz_questions',
  'settings'
]

function list(key) {
  return store.get(key, [])
}

function nextId(items) {
  if (items.length === 0) return 1
  return Math.max(...items.map(i => i.id)) + 1
}

function defaultCourseSettings() {
  return {
    difficulty: 'normal',
    priority: 3,
    target_score: 85,
    reading_speed: 110,
    quiz_frequency: 'normal'
  }
}

function normalizeCourseSettings(settings = {}) {
  const difficulty = ['easy', 'normal', 'hard', 'exam'].includes(settings.difficulty)
    ? settings.difficulty
    : 'normal'
  const quizFrequency = ['low', 'normal', 'high'].includes(settings.quiz_frequency)
    ? settings.quiz_frequency
    : 'normal'

  return {
    difficulty,
    priority: Math.max(1, Math.min(4, Number(settings.priority || 3))),
    target_score: Math.max(50, Math.min(100, Number(settings.target_score || 85))),
    reading_speed: Math.max(50, Math.min(260, Number(settings.reading_speed || 110))),
    quiz_frequency: quizFrequency
  }
}

function normalizeCourse(course) {
  return {
    ...course,
    study_settings: normalizeCourseSettings(course.study_settings)
  }
}

function taskSourceKey(data) {
  if (data.source_key) return data.source_key
  if (data.topic_id || data.topicId) {
    return `course:${Number(data.course_id ?? data.courseId ?? 0)}:topic:${Number(data.topic_id ?? data.topicId)}:kind:${data.kind || 'study'}`
  }
  return null
}

function normalizeSubtasks(subtasks) {
  if (!Array.isArray(subtasks)) return []
  return subtasks
    .map((item, index) => ({
      id: item.id || `${Date.now()}-${index}`,
      title: String(item.title || '').trim(),
      completed: item.completed ? 1 : 0
    }))
    .filter(item => item.title)
}

function normalizedTasks() {
  const topics = list('topics')
  const topicById = new Map(topics.map(t => [t.id, t]))
  const keyed = new Map()
  const loose = []

  for (const rawTask of list('tasks')) {
    const sourceKey = taskSourceKey(rawTask)
    const topic = rawTask.topic_id ? topicById.get(rawTask.topic_id) : null
    const task = {
      ...rawTask,
      source_key: sourceKey,
      logged_minutes: Number(rawTask.logged_minutes || 0),
      completed: rawTask.completed || topic?.completed ? 1 : 0,
      completed_at: rawTask.completed_at || (topic?.completed ? new Date().toISOString() : null)
    }
    task.remaining_minutes = task.completed
      ? 0
      : Math.max(0, Number(task.estimate_minutes || 30) - Number(task.logged_minutes || 0))

    if (!sourceKey) {
      loose.push(task)
      continue
    }

    const existing = keyed.get(sourceKey)
    if (!existing) {
      keyed.set(sourceKey, task)
      continue
    }

    const preferOpen = existing.completed && !task.completed
    const preferOldestEquivalent = existing.completed === task.completed && task.id < existing.id
    if (preferOpen || preferOldestEquivalent) {
      keyed.set(sourceKey, task)
    }
  }

  return [...loose, ...keyed.values()]
}

function saveTasks(tasks) {
  store.set('tasks', tasks)
  store.set('plan_blocks', [])
}

function createReviewTasksForTask(task, currentTasks = normalizedTasks()) {
  if (!task?.topic_id || task.kind !== 'study' || !task.course_id) {
    return { tasks: currentTasks, created: 0 }
  }

  const stages = [
    { offset: 1, label: '1-day recall', minutes: 20 },
    { offset: 3, label: '3-day review', minutes: 25 },
    { offset: 7, label: '7-day retention check', minutes: 30 }
  ]
  const nextTasks = [...currentTasks]
  let id = nextId(nextTasks)
  let created = 0

  for (const stage of stages) {
    const sourceKey = `course:${task.course_id}:topic:${task.topic_id}:review:${stage.offset}`
    if (nextTasks.some(existing => existing.source_key === sourceKey)) continue

    nextTasks.push({
      id: id++,
      title: `Review ${task.topic_title || task.title} (${stage.label})`,
      notes: `Spaced review generated after completing "${task.title}".`,
      kind: 'review',
      course_id: task.course_id,
      course_name: task.course_name || null,
      topic_id: task.topic_id,
      topic_title: task.topic_title || null,
      due_date: dateKey(stage.offset),
      source_key: sourceKey,
      priority: stage.offset <= 1 ? 2 : 3,
      estimate_minutes: stage.minutes,
      subtasks: [
        { id: `${sourceKey}:recall`, title: 'Recall the main idea without looking', completed: 0 },
        { id: `${sourceKey}:missed`, title: 'Review missed or weak points', completed: 0 },
        { id: `${sourceKey}:quiz`, title: 'Answer at least 3 practice questions', completed: 0 }
      ],
      logged_minutes: 0,
      completed: 0,
      completed_at: null,
      created_at: new Date().toISOString()
    })
    created++
  }

  return { tasks: nextTasks, created }
}

function dateKey(offset = 0) {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + offset)
  return d.toISOString().slice(0, 10)
}

function parseClock(clock) {
  const [hours, minutes] = String(clock || '00:00').split(':').map(Number)
  return (hours * 60) + (minutes || 0)
}

function formatClock(minutes) {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function fixedEventDays(event) {
  if (Array.isArray(event.days)) return event.days.map(Number)
  if (typeof event.days === 'string') {
    try {
      const parsed = JSON.parse(event.days)
      return Array.isArray(parsed) ? parsed.map(Number) : []
    } catch {
      return []
    }
  }
  return []
}

function eventOverlaps(day, event) {
  const start = parseClock(event.start)
  const end = parseClock(event.end)
  if (end <= day.start || start >= day.end) return false
  return true
}

function subtractBusySegments(baseStart, baseEnd, busyEvents) {
  let segments = [{ start: baseStart, end: baseEnd }]

  for (const event of busyEvents) {
    const busyStart = Math.max(baseStart, parseClock(event.start))
    const busyEnd = Math.min(baseEnd, parseClock(event.end))
    if (busyEnd <= busyStart) continue

    segments = segments.flatMap(segment => {
      if (busyEnd <= segment.start || busyStart >= segment.end) return [segment]

      const next = []
      if (busyStart > segment.start) next.push({ start: segment.start, end: busyStart })
      if (busyEnd < segment.end) next.push({ start: busyEnd, end: segment.end })
      return next
    })
  }

  return segments
    .filter(segment => segment.end > segment.start)
    .map(segment => ({ ...segment, cursor: segment.start }))
}

function daysUntil(date) {
  if (!date) return 14
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const target = new Date(`${date}T12:00:00`)
  if (Number.isNaN(target.getTime())) return 14
  return Math.max(1, Math.ceil((target - today) / 86400000) + 1)
}

function planSettings() {
  const settings = store.get('settings', {})
  const examDate = settings.exam_date || '2026-07-15'
  return {
    weekday_start: '18:00',
    weekday_end: '22:00',
    weekend_start: '09:00',
    weekend_end: '13:00',
    min_block_minutes: 30,
    max_block_minutes: 90,
    use_calibrated_estimates: false,
    ...settings.study_plan,
    exam_date: examDate,
    horizon_days: daysUntil(examDate)
  }
}

function openTasks() {
  const completedTopicIds = new Set(list('topics').filter(t => t.completed).map(t => t.id))
  return normalizedTasks()
    .filter(t => !t.completed && !completedTopicIds.has(t.topic_id))
    .sort((a, b) => {
      const dueA = a.due_date || '9999-12-31'
      const dueB = b.due_date || '9999-12-31'
      if (dueA !== dueB) return dueA.localeCompare(dueB)
      if ((a.priority || 4) !== (b.priority || 4)) return (a.priority || 4) - (b.priority || 4)
      return a.id - b.id
    })
}

function rebalanceStudyDueDates(examDate) {
  const tasks = normalizedTasks()
  const topics = list('topics')
  const topicById = new Map(topics.map(t => [t.id, t]))
  const today = new Date(`${dateKey()}T12:00:00`)
  const last = new Date(`${examDate || dateKey(14)}T12:00:00`)
  const spanDays = Math.max(1, Math.ceil((last - today) / 86400000))
  const grouped = new Map()

  for (const task of tasks) {
    if (task.completed || task.kind !== 'study' || !task.course_id || !task.topic_id) continue
    const topic = topicById.get(task.topic_id)
    if (!topic || topic.completed) continue
    const key = String(task.course_id)
    grouped.set(key, [...(grouped.get(key) || []), { task, topic }])
  }

  const dueById = new Map()
  for (const group of grouped.values()) {
    const ordered = group.sort((a, b) => {
      if (a.topic.order_index !== b.topic.order_index) return a.topic.order_index - b.topic.order_index
      return a.task.id - b.task.id
    })

    ordered.forEach(({ task }, index) => {
      const dueOffset = Math.min(spanDays, Math.floor((index / Math.max(1, ordered.length - 1)) * spanDays))
      dueById.set(task.id, {
        due_date: dateKey(dueOffset),
        priority: dueOffset <= 2 ? 2 : 3
      })
    })
  }

  if (dueById.size > 0) {
    saveTasks(tasks.map(task => dueById.has(task.id) ? { ...task, ...dueById.get(task.id) } : task))
  }

  return dueById.size
}

function buildStudyAnalytics() {
  const courses = list('courses')
  const topics = list('topics')
  const tasks = normalizedTasks()
  const logs = list('study_log')
  const quizQuestions = list('quiz_questions')
  const taskLogs = logs.filter(log => log.task_id)
  const totalLoggedMinutes = logs.reduce((sum, log) => sum + Number(log.minutes || (Number(log.hours || 0) * 60)), 0)
  const completedTasks = tasks.filter(task => task.completed)
  const openTasks = tasks.filter(task => !task.completed)
  const studyTasks = tasks.filter(task => task.kind === 'study')
  const estimatedMinutes = tasks.reduce((sum, task) => sum + Number(task.estimate_minutes || 0), 0)
  const remainingMinutes = tasks.reduce((sum, task) => sum + Number(task.remaining_minutes ?? task.estimate_minutes ?? 0), 0)

  const courseRows = courses.map(course => {
    const courseTopics = topics.filter(topic => topic.course_id === course.id)
    const courseTasks = tasks.filter(task => task.course_id === course.id)
    const courseLogs = logs.filter(log => log.course_id === course.id)
    const doneTopics = courseTopics.filter(topic => topic.completed)
    const completedCourseTasks = courseTasks.filter(task => task.completed)
    const loggedMinutes = courseLogs.reduce((sum, log) => sum + Number(log.minutes || (Number(log.hours || 0) * 60)), 0)
    const taskLoggedMinutes = courseTasks.reduce((sum, task) => sum + Number(task.logged_minutes || 0), 0)

    return {
      id: course.id,
      name: course.name,
      sections: courseTopics.length,
      completedSections: doneTopics.length,
      sectionPercent: courseTopics.length ? Math.round((doneTopics.length / courseTopics.length) * 100) : 0,
      tasks: courseTasks.length,
      completedTasks: completedCourseTasks.length,
      openTasks: courseTasks.length - completedCourseTasks.length,
      loggedMinutes,
      taskLoggedMinutes,
      remainingMinutes: courseTasks.reduce((sum, task) => sum + Number(task.remaining_minutes ?? task.estimate_minutes ?? 0), 0),
      avgMinutesPerCompletedTask: completedCourseTasks.length
        ? Math.round(completedCourseTasks.reduce((sum, task) => sum + Number(task.logged_minutes || task.estimate_minutes || 0), 0) / completedCourseTasks.length)
        : 0
    }
  })

  const completionRows = completedTasks
    .filter(task => task.topic_id || task.logged_minutes)
    .map(task => {
      const created = task.created_at ? new Date(task.created_at) : null
      const completed = task.completed_at ? new Date(task.completed_at) : null
      const calendarDays = created && completed && !Number.isNaN(created.getTime()) && !Number.isNaN(completed.getTime())
        ? Math.max(0, Math.ceil((completed - created) / 86400000))
        : null
      const estimate = Number(task.estimate_minutes || 0)
      const logged = Number(task.logged_minutes || 0)
      return {
        id: task.id,
        title: task.title,
        courseName: task.course_name,
        topicTitle: task.topic_title,
        estimateMinutes: estimate,
        loggedMinutes: logged,
        calendarDays,
        efficiencyPercent: estimate && logged ? Math.round((estimate / logged) * 100) : null
      }
    })
    .sort((a, b) => (b.loggedMinutes || 0) - (a.loggedMinutes || 0))

  const timedCompletions = completionRows.filter(item => item.estimateMinutes > 0 && item.loggedMinutes > 0)
  const completedEstimateMinutes = timedCompletions.reduce((sum, item) => sum + item.estimateMinutes, 0)
  const completedLoggedMinutes = timedCompletions.reduce((sum, item) => sum + item.loggedMinutes, 0)
  const estimateAccuracyPercent = completedEstimateMinutes && completedLoggedMinutes
    ? Math.round((completedEstimateMinutes / completedLoggedMinutes) * 100)
    : 0
  const estimateMultiplier = completedEstimateMinutes && completedLoggedMinutes
    ? Number((completedLoggedMinutes / completedEstimateMinutes).toFixed(2))
    : 1
  const estimateBias = estimateAccuracyPercent === 0
    ? 'not_enough_data'
    : estimateAccuracyPercent < 85
      ? 'underestimating'
      : estimateAccuracyPercent > 115
        ? 'overestimating'
        : 'accurate'

  const byDate = new Map()
  for (const log of logs) {
    const minutes = Number(log.minutes || (Number(log.hours || 0) * 60))
    byDate.set(log.date, (byDate.get(log.date) || 0) + minutes)
  }
  const studyDays = Array.from(byDate.entries())
    .map(([date, minutes]) => ({ date, minutes }))
    .sort((a, b) => b.minutes - a.minutes)

  const activeDates = new Set(studyDays.filter(day => day.minutes > 0).map(day => day.date))
  let currentStreakDays = 0
  for (let offset = 0; offset < 3650; offset += 1) {
    if (!activeDates.has(dateKey(-offset))) break
    currentStreakDays += 1
  }

  const ascendingDates = Array.from(activeDates).sort()
  let longestStreakDays = 0
  let streakCursor = 0
  let previousDate = null
  for (const date of ascendingDates) {
    const currentDate = new Date(`${date}T12:00:00`)
    const previous = previousDate ? new Date(`${previousDate}T12:00:00`) : null
    const isNextDay = previous && Math.round((currentDate - previous) / 86400000) === 1
    streakCursor = previousDate && isNextDay ? streakCursor + 1 : 1
    longestStreakDays = Math.max(longestStreakDays, streakCursor)
    previousDate = date
  }

  const recent7Minutes = Array.from({ length: 7 }, (_, i) => byDate.get(dateKey(-6 + i)) || 0)
  const weeklyLoggedMinutes = recent7Minutes.reduce((sum, minutes) => sum + minutes, 0)
  const recentDailyAverageMinutes = Math.round(weeklyLoggedMinutes / 7)
  const activeStudyDays = activeDates.size
  const avgMinutesPerStudyDay = activeStudyDays ? Math.round(totalLoggedMinutes / activeStudyDays) : 0
  const settings = store.get('settings', {})
  const examDate = settings.exam_date || '2026-07-15'
  const today = new Date(`${dateKey()}T12:00:00`)
  const exam = new Date(`${examDate}T12:00:00`)
  const daysUntilExam = Number.isNaN(exam.getTime()) ? 0 : Math.max(0, Math.ceil((exam - today) / 86400000))
  const requiredDailyMinutes = daysUntilExam > 0 ? Math.ceil(remainingMinutes / daysUntilExam) : remainingMinutes
  const paceDeltaMinutes = recentDailyAverageMinutes - requiredDailyMinutes
  const bestStudyDay = studyDays[0] || null
  const byHour = new Map()
  for (const log of logs) {
    const created = log.created_at ? new Date(log.created_at) : null
    if (!created || Number.isNaN(created.getTime())) continue
    const hour = created.getHours()
    const minutes = Number(log.minutes || (Number(log.hours || 0) * 60))
    byHour.set(hour, (byHour.get(hour) || 0) + minutes)
  }
  const bestHour = Array.from(byHour.entries()).sort((a, b) => b[1] - a[1])[0] || null

  const quizByTopic = new Map()
  for (const question of quizQuestions) {
    const topicId = Number(question.topic_id || 0)
    if (!topicId) continue
    const current = quizByTopic.get(topicId) || {
      topicId,
      questions: 0,
      attempts: 0,
      correct: 0
    }
    current.questions += 1
    current.attempts += Number(question.times_attempted || 0)
    current.correct += Number(question.times_correct || 0)
    quizByTopic.set(topicId, current)
  }

  const quizTopicRows = Array.from(quizByTopic.values())
    .map(row => {
      const topic = topics.find(item => item.id === row.topicId)
      const course = topic ? courses.find(item => item.id === topic.course_id) : null
      return {
        ...row,
        courseId: course?.id || topic?.course_id || null,
        topicTitle: topic?.title || 'Unknown topic',
        courseName: course?.name || 'No course',
        accuracyPercent: row.attempts ? Math.round((row.correct / row.attempts) * 100) : null
      }
    })
    .sort((a, b) => (a.accuracyPercent ?? 101) - (b.accuracyPercent ?? 101) || b.attempts - a.attempts)

  const quizAttempts = quizQuestions.reduce((sum, q) => sum + Number(q.times_attempted || 0), 0)
  const quizCorrect = quizQuestions.reduce((sum, q) => sum + Number(q.times_correct || 0), 0)
  const sectionProgressPercent = topics.length
    ? Math.round((topics.filter(topic => topic.completed).length / topics.length) * 100)
    : 0
  const taskCompletionPercent = tasks.length ? Math.round((completedTasks.length / tasks.length) * 100) : 0
  const quizAccuracyPercent = quizAttempts ? Math.round((quizCorrect / quizAttempts) * 100) : 0
  const paceScore = requiredDailyMinutes <= 0
    ? 100
    : Math.max(0, Math.min(100, Math.round((recentDailyAverageMinutes / requiredDailyMinutes) * 100)))
  const workloadScore = remainingMinutes <= 0
    ? 100
    : Math.max(0, Math.min(100, Math.round(((remainingMinutes + Math.max(0, paceDeltaMinutes * Math.max(1, daysUntilExam))) / remainingMinutes) * 100)))
  const quizScore = quizAttempts ? quizAccuracyPercent : Math.max(20, sectionProgressPercent)
  const readinessFactors = {
    sectionProgress: sectionProgressPercent,
    taskCompletion: taskCompletionPercent,
    pace: paceScore,
    workload: workloadScore,
    quiz: quizScore
  }
  const readinessScore = Math.round(
    readinessFactors.sectionProgress * 0.3 +
    readinessFactors.taskCompletion * 0.2 +
    readinessFactors.pace * 0.2 +
    readinessFactors.workload * 0.15 +
    readinessFactors.quiz * 0.15
  )
  const readinessLabel = readinessScore >= 85
    ? 'Exam ready'
    : readinessScore >= 70
      ? 'On track'
      : readinessScore >= 50
        ? 'Needs push'
        : 'At risk'

  return {
    totals: {
      courses: courses.length,
      sections: topics.length,
      completedSections: topics.filter(topic => topic.completed).length,
      tasks: tasks.length,
      openTasks: openTasks.length,
      completedTasks: completedTasks.length,
      studyTasks: studyTasks.length,
      completionRate: tasks.length ? Math.round((completedTasks.length / tasks.length) * 100) : 0,
      sessions: logs.length,
      linkedSessions: taskLogs.length,
      totalLoggedMinutes,
      averageSessionMinutes: logs.length ? Math.round(totalLoggedMinutes / logs.length) : 0,
      estimatedMinutes,
      remainingMinutes,
      taskLoggedMinutes: tasks.reduce((sum, task) => sum + Number(task.logged_minutes || 0), 0),
      timedCompletions: timedCompletions.length,
      completedEstimateMinutes,
      completedLoggedMinutes,
      estimateAccuracyPercent,
      estimateMultiplier,
      estimateBias,
      quizQuestions: quizQuestions.length,
      quizAttempts,
      quizCorrect,
      quizAccuracyPercent,
      weakQuizTopics: quizTopicRows.filter(row => row.attempts > 0 && row.accuracyPercent < 70).length,
      readinessScore,
      readinessLabel,
      currentStreakDays,
      longestStreakDays,
      activeStudyDays,
      avgMinutesPerStudyDay,
      recentDailyAverageMinutes,
      requiredDailyMinutes,
      paceDeltaMinutes,
      daysUntilExam
    },
    readiness: {
      score: readinessScore,
      label: readinessLabel,
      factors: readinessFactors,
      weights: {
        sectionProgress: 30,
        taskCompletion: 20,
        pace: 20,
        workload: 15,
        quiz: 15
      },
      note: quizAttempts
        ? 'Quiz score uses your recorded question accuracy.'
        : 'Quiz score is estimated from section progress until you answer saved or generated quiz questions.'
    },
    courseRows,
    completions: completionRows.slice(0, 20),
    quizTopics: quizTopicRows,
    weakQuizTopics: quizTopicRows.filter(row => row.attempts > 0 && row.accuracyPercent < 70).slice(0, 8),
    pace: {
      examDate,
      daysUntilExam,
      weeklyLoggedMinutes,
      recentDailyAverageMinutes,
      requiredDailyMinutes,
      paceDeltaMinutes,
      bestStudyDay,
      bestStudyHour: bestHour
        ? { hour: bestHour[0], minutes: bestHour[1], label: `${String(bestHour[0]).padStart(2, '0')}:00` }
        : null
    },
    studyDays,
    collection: {
      tracksTaskTime: true,
      tracksTopicCompletionTime: true,
      tracksCalendarDaysToComplete: true,
      tracksQuizAccuracyByTopic: quizAttempts > 0,
      tracksStudyTimeOfDay: logs.some(log => log.created_at),
      note: 'Time-of-day quality improves from new sessions because older logs may not have created_at.'
    }
  }
}

function makeAvailability(settings) {
  const fixedEvents = list('fixed_events')
  const scheduleExceptions = list('schedule_exceptions')
  return Array.from({ length: Number(settings.horizon_days || 14) }, (_, offset) => {
    const key = dateKey(offset)
    const d = new Date(`${key}T12:00:00`)
    const weekday = d.getDay()
    const weekend = weekday === 0 || weekday === 6
    const start = parseClock(weekend ? settings.weekend_start : settings.weekday_start)
    const end = parseClock(weekend ? settings.weekend_end : settings.weekday_end)
    const events = fixedEvents
      .filter(event => fixedEventDays(event).includes(weekday))
      .filter(event => eventOverlaps({ start, end }, event))
      .sort((a, b) => parseClock(a.start) - parseClock(b.start))
    const exceptions = scheduleExceptions
      .filter(event => event.date === key)
      .filter(event => eventOverlaps({ start, end }, event))
      .sort((a, b) => parseClock(a.start) - parseClock(b.start))
    const segments = subtractBusySegments(start, end, [...events, ...exceptions])
    const baseAvailable = Math.max(0, end - start)
    const available = segments.reduce((sum, segment) => sum + (segment.end - segment.start), 0)

    return {
      date: key,
      start,
      end,
      segments,
      fixed_events: events.map(event => ({
        ...event,
        start_minute: parseClock(event.start),
        end_minute: parseClock(event.end),
        start_label: event.start,
        end_label: event.end
      })),
      exceptions: exceptions.map(event => ({
        ...event,
        start_minute: parseClock(event.start),
        end_minute: parseClock(event.end),
        start_label: event.start,
        end_label: event.end
      })),
      base_available: baseAvailable,
      busy: Math.max(0, baseAvailable - available),
      available
    }
  })
}

function buildPlan() {
  const settings = planSettings()
  const availability = makeAvailability(settings)
  const tasks = openTasks()
  const analytics = buildStudyAnalytics()
  const canUseCalibration = Boolean(settings.use_calibrated_estimates) && Number(analytics.totals.timedCompletions || 0) >= 3
  const estimateMultiplier = canUseCalibration ? Number(analytics.totals.estimateMultiplier || 1) : 1
  const blocks = []
  let blockId = 1

  for (const task of tasks) {
    let remaining = Math.ceil(Number(task.remaining_minutes ?? task.estimate_minutes ?? 30) * estimateMultiplier)
    const due = task.due_date || availability[availability.length - 1]?.date
    const windows = availability.filter(day => day.date <= due || due < dateKey())

    for (const day of windows) {
      for (const segment of day.segments) {
        while (remaining > 0 && segment.cursor < segment.end) {
          const free = segment.end - segment.cursor
          if (free < Number(settings.min_block_minutes || 30)) break
          const chunk = Math.min(remaining, free, Number(settings.max_block_minutes || 90))
          const start = segment.cursor
          const end = start + chunk
          blocks.push({
            id: blockId++,
            task_id: task.id,
            title: task.title,
            kind: task.kind || 'study',
            course_name: task.course_name || null,
            due_date: task.due_date || null,
            date: day.date,
            start_minute: start,
            end_minute: end,
            start_label: formatClock(start),
            end_label: formatClock(end)
          })
          segment.cursor = end
          remaining -= chunk
        }
        if (remaining <= 0) break
      }
      if (remaining <= 0) break
    }
  }

  const totalStudyWindow = availability.reduce((sum, d) => sum + d.base_available, 0)
  const totalBusy = availability.reduce((sum, d) => sum + d.busy, 0)
  const totalAvailable = availability.reduce((sum, d) => sum + d.available, 0)
  const totalNeeded = tasks.reduce((sum, t) => sum + Math.ceil(Number(t.remaining_minutes ?? t.estimate_minutes ?? 30) * estimateMultiplier), 0)
  const plannedMinutes = blocks.reduce((sum, b) => sum + (b.end_minute - b.start_minute), 0)
  const unplannedMinutes = Math.max(0, totalNeeded - plannedMinutes)
  const cushionMinutes = totalAvailable - totalNeeded
  const fixedEventCount = list('fixed_events').length
  const exceptionCount = list('schedule_exceptions').length
  const generatedAt = new Date().toISOString()

  return {
    settings,
    generated_at: generatedAt,
    meta: {
      generatedAt,
      horizonDays: availability.length,
      openTasks: tasks.length,
      plannedBlocks: blocks.length,
      fixedEventCount,
      exceptionCount,
      estimateMultiplier,
      calibratedEstimates: canUseCalibration,
      inputs: {
        weekday: `${settings.weekday_start}-${settings.weekday_end}`,
        weekend: `${settings.weekend_start}-${settings.weekend_end}`,
        minBlockMinutes: Number(settings.min_block_minutes || 30),
        maxBlockMinutes: Number(settings.max_block_minutes || 90),
        calibratedEstimates: canUseCalibration
      }
    },
    days: availability.map(day => ({
      date: day.date,
      available: day.available,
      free_after_plan: day.segments.reduce((sum, segment) => sum + Math.max(0, segment.end - segment.cursor), 0),
      fixed_events: day.fixed_events,
      exceptions: day.exceptions,
      blocks: blocks.filter(b => b.date === day.date)
    })),
    tasks,
    blocks,
    summary: {
      totalAvailable,
      totalStudyWindow,
      totalBusy,
      estimateMultiplier,
      calibratedEstimates: canUseCalibration,
      totalNeeded,
      plannedMinutes,
      unplannedMinutes,
      cushionMinutes
    }
  }
}

export function initDatabase() {
  console.log('Store path:', store.path)
}

export function dbHandlers(ipcMain) {
  // Courses
  ipcMain.handle('db:getCourses', () =>
    list('courses').map(normalizeCourse).sort((a, b) => b.id - a.id)
  )

  ipcMain.handle('db:createCourse', (_, { name, description }) => {
    const courses = list('courses')
    const course = {
      id: nextId(courses),
      name,
      description,
      study_settings: defaultCourseSettings(),
      created_at: new Date().toISOString()
    }
    store.set('courses', [...courses, course])
    return normalizeCourse(course)
  })

  ipcMain.handle('db:updateCourse', (_, { id, patch = {} }) => {
    const numericId = Number(id)
    let updated = null
    const courses = list('courses').map(course => {
      if (course.id !== numericId) return course

      const next = {
        ...course,
        ...(typeof patch.name === 'string' ? { name: patch.name } : {}),
        ...(typeof patch.description === 'string' ? { description: patch.description } : {}),
        ...(patch.study_settings
          ? { study_settings: normalizeCourseSettings({ ...course.study_settings, ...patch.study_settings }) }
          : {})
      }
      updated = next
      return next
    })

    store.set('courses', courses)
    return updated ? normalizeCourse(updated) : null
  })

  ipcMain.handle('db:deleteCourse', (_, id) => {
    const numericId = Number(id)
    store.set('courses', list('courses').filter(c => c.id !== numericId))
    store.set('topics', list('topics').filter(t => t.course_id !== numericId))
    saveTasks(normalizedTasks().filter(t => t.course_id !== numericId))
    store.set('plan_blocks', [])
    return { ok: true }
  })

  // Topics
  ipcMain.handle('db:getTopics', (_, courseId) =>
    list('topics')
      .filter(t => t.course_id === Number(courseId))
      .sort((a, b) => a.order_index - b.order_index)
  )

  ipcMain.handle('db:insertTopics', (_, { courseId, topics }) => {
    const existing = list('topics')
    let id = nextId(existing)
    const newTopics = topics.map((t, i) => ({
      id: id++,
      course_id: Number(courseId),
      title: t.title,
      content: t.content || '',
      order_index: i,
      completed: 0
    }))
    store.set('topics', [...existing, ...newTopics])
    return { ok: true, count: newTopics.length }
  })

  ipcMain.handle('db:replaceTopics', (_, { courseId, topics }) => {
    const numericCourseId = Number(courseId)
    const remaining = list('topics').filter(t => t.course_id !== numericCourseId)
    let id = nextId(remaining)
    const newTopics = topics.map((t, i) => ({
      id: id++,
      course_id: numericCourseId,
      title: t.title,
      content: t.content || '',
      order_index: i,
      completed: 0
    }))

    const removedTopicIds = new Set(list('topics').filter(t => t.course_id === numericCourseId).map(t => t.id))
    store.set('topics', [...remaining, ...newTopics])
    saveTasks(normalizedTasks().map(t =>
      removedTopicIds.has(t.topic_id) ? { ...t, topic_id: null, topic_title: null } : t
    ))
    return { ok: true, count: newTopics.length }
  })

  ipcMain.handle('db:toggleTopic', (_, { id, completed }) => {
    const numericId = Number(id)
    const done = completed ? 1 : 0
    store.set('topics', list('topics').map(t =>
      t.id === numericId ? { ...t, completed: done } : t
    ))
    saveTasks(normalizedTasks().map(t =>
      t.topic_id === numericId
        ? { ...t, completed: done, completed_at: done ? new Date().toISOString() : null }
        : t
    ))
    return { ok: true }
  })

  ipcMain.handle('db:setCourseProgress', (_, { courseId, percent }) => {
    const numericCourseId = Number(courseId)
    const topics = list('topics')
      .filter(t => t.course_id === numericCourseId)
      .sort((a, b) => a.order_index - b.order_index)
    const completedCount = Math.max(0, Math.min(topics.length, Math.round(topics.length * (Number(percent) / 100))))
    const completedIds = new Set(topics.slice(0, completedCount).map(t => t.id))

    store.set('topics', list('topics').map(t =>
      t.course_id === numericCourseId ? { ...t, completed: completedIds.has(t.id) ? 1 : 0 } : t
    ))
    saveTasks(normalizedTasks().map(t =>
      t.course_id === numericCourseId && t.topic_id
        ? { ...t, completed: completedIds.has(t.topic_id) ? 1 : 0, completed_at: completedIds.has(t.topic_id) ? new Date().toISOString() : null }
        : t
    ))
    return { ok: true, completed: completedCount, total: topics.length }
  })

  // Study tasks
  ipcMain.handle('db:getTasks', (_, filter = 'all') => {
    const today = new Date().toISOString().slice(0, 10)
    const tasks = normalizedTasks().sort((a, b) => {
      if (!!a.completed !== !!b.completed) return a.completed ? 1 : -1
      if ((a.due_date || '') !== (b.due_date || '')) return (a.due_date || '9999').localeCompare(b.due_date || '9999')
      if ((a.priority || 4) !== (b.priority || 4)) return (a.priority || 4) - (b.priority || 4)
      return b.id - a.id
    })

    if (filter === 'today') {
      return tasks.filter(t => !t.completed && (!t.due_date || t.due_date <= today))
    }
    if (filter === 'upcoming') {
      return tasks.filter(t => !t.completed && t.due_date && t.due_date > today)
    }
    if (filter === 'completed') {
      return tasks.filter(t => t.completed)
    }
    return tasks
  })

  ipcMain.handle('db:createTask', (_, data) => {
    const tasks = normalizedTasks()
    const course = data.courseId ? list('courses').find(c => c.id === Number(data.courseId)) : null
    const topic = data.topicId ? list('topics').find(t => t.id === Number(data.topicId)) : null
    if (data.topicId && data.kind) {
      const key = taskSourceKey(data)
      const existing = tasks.find(t => !t.completed && t.source_key === key)
      if (existing) return existing
    }
    const sourceKey = taskSourceKey(data)
    const task = {
      id: nextId(tasks),
      title: data.title || 'Untitled study task',
      notes: data.notes || '',
      kind: data.kind || 'study',
      course_id: data.courseId ? Number(data.courseId) : null,
      course_name: course?.name || null,
      topic_id: data.topicId ? Number(data.topicId) : null,
      topic_title: topic?.title || null,
      due_date: data.dueDate || null,
      source_key: sourceKey,
      priority: Number(data.priority || 3),
      estimate_minutes: Number(data.estimateMinutes || 30),
      subtasks: normalizeSubtasks(data.subtasks),
      logged_minutes: 0,
      completed: 0,
      completed_at: null,
      created_at: new Date().toISOString()
    }
    saveTasks([...tasks, task])
    return task
  })

  ipcMain.handle('db:updateTask', (_, { id, patch }) => {
    saveTasks(normalizedTasks().map(t => t.id === Number(id) ? { ...t, ...patch } : t))
    return { ok: true }
  })

  ipcMain.handle('db:completeTask', (_, { id, completed }) => {
    const done = completed ? 1 : 0
    const tasks = normalizedTasks()
    const task = tasks.find(t => t.id === Number(id))
    const completedTasks = tasks.map(t =>
      t.id === Number(id)
        ? { ...t, completed: done, completed_at: done ? new Date().toISOString() : null }
        : t
    )
    const reviewResult = done ? createReviewTasksForTask({ ...task, completed: done }, completedTasks) : { tasks: completedTasks, created: 0 }
    saveTasks(reviewResult.tasks)
    if (task?.topic_id && task.kind === 'study') {
      store.set('topics', list('topics').map(topic =>
        topic.id === task.topic_id ? { ...topic, completed: done } : topic
      ))
    }
    return { ok: true, reviewTasksCreated: reviewResult.created }
  })

  ipcMain.handle('db:deleteTask', (_, id) => {
    saveTasks(normalizedTasks().filter(t => t.id !== Number(id)))
    return { ok: true }
  })

  ipcMain.handle('db:bulkCreateStudyTasks', (_, { courseId, tasks: incomingTasks }) => {
    const numericCourseId = Number(courseId)
    const existing = normalizedTasks()
    const course = list('courses').find(c => c.id === numericCourseId)
    let id = nextId(existing)
    let created = 0
    let skipped = 0
    const nextTasks = [...existing]

    for (const data of incomingTasks || []) {
      const topicId = data.topicId ? Number(data.topicId) : null
      const sourceKey = taskSourceKey({ ...data, courseId: numericCourseId })
      const duplicate = sourceKey && nextTasks.some(t => !t.completed && t.source_key === sourceKey)
      if (duplicate) {
        skipped++
        continue
      }

      const topic = topicId ? list('topics').find(t => t.id === topicId) : null
      nextTasks.push({
        id: id++,
        title: data.title || 'Study section',
        notes: data.notes || '',
        kind: data.kind || 'study',
        course_id: numericCourseId,
        course_name: course?.name || null,
        topic_id: topicId,
        topic_title: topic?.title || null,
        due_date: data.dueDate || null,
        source_key: sourceKey,
        priority: Number(data.priority || 3),
        estimate_minutes: Number(data.estimateMinutes || 30),
        subtasks: normalizeSubtasks(data.subtasks),
        logged_minutes: 0,
        completed: 0,
        completed_at: null,
        created_at: new Date().toISOString()
      })
      created++
    }

    saveTasks(nextTasks)
    return { ok: true, created, skipped }
  })

  ipcMain.handle('db:deleteAllTasks', () => {
    const count = normalizedTasks().length
    saveTasks([])
    return { ok: true, deleted: count }
  })

  ipcMain.handle('db:clearStudyLogs', () => {
    const count = list('study_log').length
    const tasks = normalizedTasks().map(task => ({
      ...task,
      logged_minutes: 0
    }))
    saveTasks(tasks)
    store.set('study_log', [])
    return { ok: true, deleted: count }
  })

  ipcMain.handle('db:clearQuizHistory', () => {
    const count = list('quiz_questions').length
    store.set('quiz_questions', [])
    return { ok: true, deleted: count }
  })

  ipcMain.handle('db:resetSectionProgress', () => {
    const count = list('topics').filter(topic => topic.completed).length
    store.set('topics', list('topics').map(topic => ({ ...topic, completed: 0 })))
    saveTasks(normalizedTasks().map(task => ({ ...task, completed: 0, completed_at: null })))
    return { ok: true, reset: count }
  })

  ipcMain.handle('db:freshStartStudy', () => {
    const counts = {
      tasks: normalizedTasks().length,
      sessions: list('study_log').length,
      completedSections: list('topics').filter(t => t.completed).length,
      quizzes: list('quiz_questions').length
    }

    saveTasks([])
    store.set('study_log', [])
    store.set('quiz_questions', [])
    store.set('topics', list('topics').map(topic => ({ ...topic, completed: 0 })))
    store.set('plan_blocks', [])

    return { ok: true, counts }
  })

  ipcMain.handle('db:exportBackup', () => {
    const data = {}
    for (const key of BACKUP_KEYS) {
      data[key] = store.get(key)
    }

    return {
      ok: true,
      schema_version: 1,
      app: 'Study Vault',
      exported_at: new Date().toISOString(),
      data,
      counts: {
        courses: list('courses').length,
        topics: list('topics').length,
        tasks: normalizedTasks().length,
        sessions: list('study_log').length,
        quizzes: list('quiz_questions').length
      }
    }
  })

  ipcMain.handle('db:importBackup', (_, backup) => {
    if (!backup || backup.app !== 'Study Vault' || !backup.data || typeof backup.data !== 'object') {
      throw new Error('This does not look like a Study Vault backup file.')
    }

    const next = {}
    for (const key of BACKUP_KEYS) {
      if (key === 'settings') {
        next[key] = backup.data[key] && typeof backup.data[key] === 'object'
          ? backup.data[key]
          : store.get('settings', {})
      } else {
        next[key] = Array.isArray(backup.data[key]) ? backup.data[key] : []
      }
    }

    for (const key of BACKUP_KEYS) {
      store.set(key, next[key])
    }

    return {
      ok: true,
      imported_at: new Date().toISOString(),
      counts: {
        courses: list('courses').length,
        topics: list('topics').length,
        tasks: normalizedTasks().length,
        sessions: list('study_log').length,
        quizzes: list('quiz_questions').length
      }
    }
  })

  ipcMain.handle('db:deleteCourseTasks', (_, courseId) => {
    const numericCourseId = Number(courseId)
    const tasks = normalizedTasks()
    const before = tasks.length
    saveTasks(tasks.filter(t => t.course_id !== numericCourseId))
    return { ok: true, deleted: before - normalizedTasks().length }
  })

  ipcMain.handle('db:getTaskStats', () => {
    const today = new Date().toISOString().slice(0, 10)
    const tasks = normalizedTasks()
    const open = tasks.filter(t => !t.completed)
    const dueToday = open.filter(t => !t.due_date || t.due_date <= today)
    const upcoming = open.filter(t => t.due_date && t.due_date > today)
    return {
      open: open.length,
      today: dueToday.length,
      upcoming: upcoming.length,
      completed: tasks.filter(t => t.completed).length,
      plannedMinutesToday: dueToday.reduce((sum, t) => sum + Number(t.remaining_minutes ?? t.estimate_minutes ?? 0), 0)
    }
  })

  ipcMain.handle('db:getStudyAnalytics', () => buildStudyAnalytics())

  ipcMain.handle('db:getFixedEvents', () =>
    list('fixed_events').map(event => ({ ...event, days: fixedEventDays(event) }))
  )

  ipcMain.handle('db:createFixedEvent', (_, event) => {
    const events = list('fixed_events')
    const start = event.start || '09:00'
    const end = event.end || '10:00'
    const item = {
      id: nextId(events),
      title: String(event.title || 'Busy block').trim() || 'Busy block',
      days: Array.isArray(event.days) ? event.days.map(Number) : [],
      start,
      end,
      color: event.color || '#8f7cff',
      created_at: new Date().toISOString()
    }
    store.set('fixed_events', [...events, item])
    store.set('plan_blocks', [])
    return item
  })

  ipcMain.handle('db:updateFixedEvent', (_, { id, patch }) => {
    const events = list('fixed_events')
    const numericId = Number(id)
    store.set('fixed_events', events.map(event => event.id === numericId ? {
      ...event,
      ...patch,
      title: String(patch.title ?? event.title ?? 'Busy block').trim() || 'Busy block',
      days: Array.isArray(patch.days) ? patch.days.map(Number) : fixedEventDays(event),
      updated_at: new Date().toISOString()
    } : event))
    store.set('plan_blocks', [])
    return { ok: true }
  })

  ipcMain.handle('db:deleteFixedEvent', (_, id) => {
    store.set('fixed_events', list('fixed_events').filter(event => event.id !== Number(id)))
    store.set('plan_blocks', [])
    return { ok: true }
  })

  ipcMain.handle('db:getScheduleExceptions', () =>
    list('schedule_exceptions').sort((a, b) => {
      if ((a.date || '') !== (b.date || '')) return (a.date || '').localeCompare(b.date || '')
      return (a.start || '').localeCompare(b.start || '')
    })
  )

  ipcMain.handle('db:createScheduleException', (_, event) => {
    const exceptions = list('schedule_exceptions')
    const item = {
      id: nextId(exceptions),
      title: String(event.title || 'Busy').trim() || 'Busy',
      date: event.date || dateKey(),
      start: event.start || '09:00',
      end: event.end || '10:00',
      created_at: new Date().toISOString()
    }
    store.set('schedule_exceptions', [...exceptions, item])
    store.set('plan_blocks', [])
    return item
  })

  ipcMain.handle('db:updateScheduleException', (_, { id, patch }) => {
    const numericId = Number(id)
    store.set('schedule_exceptions', list('schedule_exceptions').map(event => event.id === numericId ? {
      ...event,
      ...patch,
      title: String(patch.title ?? event.title ?? 'Busy').trim() || 'Busy',
      updated_at: new Date().toISOString()
    } : event))
    store.set('plan_blocks', [])
    return { ok: true }
  })

  ipcMain.handle('db:deleteScheduleException', (_, id) => {
    store.set('schedule_exceptions', list('schedule_exceptions').filter(event => event.id !== Number(id)))
    store.set('plan_blocks', [])
    return { ok: true }
  })

  ipcMain.handle('db:getStudyPlan', () => {
    return buildPlan()
  })

  ipcMain.handle('db:generateStudyPlan', () => {
    const generated = buildPlan()
    store.set('plan_blocks', [])
    return generated
  })

  ipcMain.handle('db:clearStudyPlan', () => {
    store.set('plan_blocks', [])
    return { ok: true }
  })

  ipcMain.handle('db:getStudyPlanSettings', () => planSettings())

  ipcMain.handle('db:setStudyPlanSettings', (_, settings) => {
    const current = store.get('settings', {})
    store.set('settings', {
      ...current,
      study_plan: { ...planSettings(), ...settings }
    })
    store.set('plan_blocks', [])
    return { ok: true }
  })

  // Study log
  ipcMain.handle('db:logStudy', (_, { date, hours, courseId, taskId, notes }) => {
    const log = list('study_log')
    const tasks = normalizedTasks()
    const minutes = Math.round(Number(hours || 0) * 60)
    const task = taskId ? tasks.find(t => t.id === Number(taskId)) : null
    const resolvedCourseId = task?.course_id || (courseId ? Number(courseId) : null)
    const course = resolvedCourseId ? list('courses').find(c => c.id === resolvedCourseId) : null
    let completedTask = null
    let reviewTasksCreated = 0

    if (task && minutes > 0) {
      const loggedMinutes = Number(task.logged_minutes || 0) + minutes
      const completed = loggedMinutes >= Number(task.estimate_minutes || 0) ? 1 : 0
      completedTask = { ...task, logged_minutes: loggedMinutes, completed, completed_at: completed ? new Date().toISOString() : null }
      const updatedTasks = tasks.map(t => t.id === task.id ? completedTask : t)
      const reviewResult = completed ? createReviewTasksForTask(completedTask, updatedTasks) : { tasks: updatedTasks, created: 0 }
      reviewTasksCreated = reviewResult.created
      saveTasks(reviewResult.tasks)

      if (completedTask.topic_id && completedTask.kind === 'study' && completed) {
        store.set('topics', list('topics').map(topic =>
          topic.id === completedTask.topic_id ? { ...topic, completed: 1 } : topic
        ))
      }
    }

    store.set('study_log', [...log, {
      id: nextId(log),
      date,
      hours: Number(hours),
      minutes,
      course_id: resolvedCourseId,
      course_name: course?.name || null,
      task_id: task?.id || null,
      task_title: task?.title || null,
      topic_id: task?.topic_id || null,
      topic_title: task?.topic_title || null,
      notes: notes || null,
      created_at: new Date().toISOString()
    }])
    return {
      ok: true,
      completedTask: !!completedTask?.completed,
      reviewTasksCreated,
      remainingMinutes: completedTask ? Math.max(0, Number(completedTask.estimate_minutes || 0) - Number(completedTask.logged_minutes || 0)) : null
    }
  })

  ipcMain.handle('db:getStudyLog', () =>
    list('study_log')
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 60)
  )

  ipcMain.handle('db:getTotalHours', () => ({
    total: list('study_log').reduce((sum, r) => sum + r.hours, 0)
  }))

  // Quiz
  ipcMain.handle('db:saveQuiz', (_, { topicId, questions }) => {
    const existing = list('quiz_questions')
    const numericTopicId = Number(topicId)
    const seen = new Set(
      existing
        .filter(q => Number(q.topic_id) === numericTopicId)
        .map(q => String(q.question || '').trim().toLowerCase())
    )
    let id = nextId(existing)
    const created = []

    for (const q of questions || []) {
      const questionText = String(q.question || '').trim()
      const key = questionText.toLowerCase()
      if (!questionText || seen.has(key)) continue
      seen.add(key)
      created.push({
        id: id++,
        topic_id: numericTopicId,
        question: questionText,
        options: JSON.stringify(q.options || []),
        answer: q.answer,
        explanation: q.explanation || '',
        times_correct: Number(q.times_correct || 0),
        times_attempted: Number(q.times_attempted || 0)
      })
    }

    store.set('quiz_questions', [...existing, ...created])
    return { ok: true, created: created.length, skipped: Math.max(0, (questions || []).length - created.length) }
  })

  ipcMain.handle('db:getQuiz', (_, topicId) =>
    list('quiz_questions')
      .filter(q => q.topic_id === Number(topicId))
      .map(q => ({ ...q, options: JSON.parse(q.options) }))
  )

  ipcMain.handle('db:recordAnswer', (_, { id, correct }) => {
    const numericId = Number(id)
    store.set('quiz_questions', list('quiz_questions').map(q =>
      q.id === numericId
        ? { ...q, times_attempted: q.times_attempted + 1, times_correct: q.times_correct + (correct ? 1 : 0) }
        : q
    ))
    return { ok: true }
  })

  // Settings
  ipcMain.handle('db:getSetting', (_, key) =>
    store.get('settings', {})[key] ?? null
  )

  ipcMain.handle('db:setSetting', (_, { key, value }) => {
    const current = store.get('settings', {})
    store.set('settings', { ...current, [key]: value })
    let rebalanced = 0
    if (key === 'exam_date') {
      rebalanced = rebalanceStudyDueDates(value)
    }
    store.set('plan_blocks', [])
    return { ok: true, rebalanced }
  })
}
