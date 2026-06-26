import { useEffect, useState } from 'react'

function todayKey(offset = 0) {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return d.toISOString().slice(0, 10)
}

function quizAccuracy(question) {
  const attempted = Number(question.times_attempted || 0)
  if (!attempted) return 1
  return Number(question.times_correct || 0) / attempted
}

function summarizeQuizQuestions(questions, targetScore = 85) {
  const saved = questions.length
  const totalAttempts = questions.reduce((sum, question) => sum + Number(question.times_attempted || 0), 0)
  const totalCorrect = questions.reduce((sum, question) => sum + Number(question.times_correct || 0), 0)
  const attempted = questions.filter(question => Number(question.times_attempted || 0) > 0).length
  const belowTarget = questions.filter(question =>
    Number(question.times_attempted || 0) > 0 &&
    Math.round(quizAccuracy(question) * 100) < targetScore
  ).length
  const untouched = saved - attempted
  const accuracy = totalAttempts ? Math.round((totalCorrect / totalAttempts) * 100) : 0

  return {
    saved,
    attempted,
    untouched,
    belowTarget,
    totalAttempts,
    totalCorrect,
    accuracy,
    targetScore,
    targetGap: totalAttempts ? accuracy - targetScore : null
  }
}

function questionPerformance(question) {
  const attempts = Number(question?.times_attempted || 0)
  const correct = Number(question?.times_correct || 0)
  const misses = Math.max(0, attempts - correct)
  const accuracy = attempts ? Math.round((correct / attempts) * 100) : null
  return { attempts, correct, misses, accuracy }
}

export default function QuizGenerator() {
  const [courses, setCourses] = useState([])
  const [courseId, setCourseId] = useState('')
  const [topics, setTopics] = useState([])
  const [topicId, setTopicId] = useState('')
  const [count, setCount] = useState(5)
  const [generating, setGenerating] = useState(false)
  const [questions, setQuestions] = useState([])
  const [current, setCurrent] = useState(0)
  const [chosen, setChosen] = useState(null)
  const [results, setResults] = useState([])
  const [done, setDone] = useState(false)
  const [error, setError] = useState(null)
  const [savedMsg, setSavedMsg] = useState(null)
  const [creatingReview, setCreatingReview] = useState(false)
  const [quizInsight, setQuizInsight] = useState(null)
  const [insightLoading, setInsightLoading] = useState(false)
  const [insightVersion, setInsightVersion] = useState(0)
  const [ollamaStatus, setOllamaStatus] = useState(null)
  const [checkingOllama, setCheckingOllama] = useState(false)

  const selectedCourse = courses.find(course => course.id === Number(courseId))
  const targetScore = Number(selectedCourse?.study_settings?.target_score || 85)

  useEffect(() => { window.api.getCourses().then(setCourses) }, [])
  useEffect(() => { refreshOllamaStatus() }, [])
  useEffect(() => {
    if (courseId) {
      window.api.getTopics(Number(courseId)).then(setTopics)
      setTopicId('')
    }
  }, [courseId])

  useEffect(() => {
    let cancelled = false

    async function loadQuizInsight() {
      if (!courseId || topics.length === 0) {
        setQuizInsight(null)
        return
      }

      setInsightLoading(true)
      const targetTopics = topicId
        ? topics.filter(topic => topic.id === Number(topicId))
        : topics
      const groups = await Promise.all(targetTopics.map(async topic => {
        const saved = await window.api.getQuiz(topic.id)
        return saved.map(question => ({ ...question, topic_title: topic.title }))
      }))
      if (cancelled) return

      const questions = groups.flat()
      setQuizInsight({
        label: topicId
          ? targetTopics[0]?.title || 'Selected topic'
          : `${targetTopics.length} course topic${targetTopics.length === 1 ? '' : 's'}`,
        ...summarizeQuizQuestions(questions, targetScore)
      })
      setInsightLoading(false)
    }

    loadQuizInsight()
    return () => { cancelled = true }
  }, [courseId, topicId, topics, insightVersion, targetScore])

  async function refreshOllamaStatus() {
    setCheckingOllama(true)
    const status = await window.api.getOllamaStatus()
    setOllamaStatus(status)
    setCheckingOllama(false)
  }

  function reset() {
    setQuestions([])
    setResults([])
    setCurrent(0)
    setChosen(null)
    setDone(false)
  }

  async function generate() {
    setError(null)
    setGenerating(true)
    reset()
    const topic = topics.find(t => t.id === Number(topicId))
    if (!topic) {
      setError('Pick a topic first.')
      setGenerating(false)
      return
    }
    const result = await window.api.generateQuiz({ content: topic.content || topic.title, count })
    if (!result || result.error) {
      setError(result?.error || 'Generation failed. Make sure Ollama is running: ollama serve')
      setGenerating(false)
      return
    }
    const saveResult = await window.api.saveQuiz({ topicId: Number(topicId), questions: result })
    const saved = await window.api.getQuiz(Number(topicId))
    const savedByQuestion = new Map(saved.map(q => [String(q.question || '').trim().toLowerCase(), q]))
    const trackableQuestions = result.map(q => savedByQuestion.get(String(q.question || '').trim().toLowerCase()) || q)
    setQuestions(trackableQuestions)
    setInsightVersion(version => version + 1)
    setSavedMsg(saveResult.created ? `Saved ${saveResult.created} for stats` : 'Using saved stats copy')
    setTimeout(() => setSavedMsg(null), 2500)
    setGenerating(false)
  }

  async function loadSaved() {
    if (!topicId) return
    const topic = topics.find(t => t.id === Number(topicId))
    const saved = await window.api.getQuiz(Number(topicId))
    if (!saved.length) {
      setError('No saved questions for this topic.')
      return
    }
    setError(null)
    reset()
    setQuestions(saved.map(question => ({ ...question, topic_id: topic?.id, topic_title: topic?.title })))
  }

  async function loadWeakSaved() {
    if (!courseId) {
      setError('Pick a course first.')
      return
    }

    setError(null)
    setGenerating(true)
    reset()
    const targetTopics = topicId
      ? topics.filter(topic => topic.id === Number(topicId))
      : topics

    const savedGroups = await Promise.all(targetTopics.map(async topic => {
      const saved = await window.api.getQuiz(topic.id)
      return saved.map(question => ({
        ...question,
        topic_id: topic.id,
        topic_title: topic.title
      }))
    }))

    const weakQuestions = savedGroups
      .flat()
      .filter(question =>
        Number(question.times_attempted || 0) > 0 &&
        Math.round(quizAccuracy(question) * 100) < targetScore
      )
      .sort((a, b) => {
        const accuracyDiff = quizAccuracy(a) - quizAccuracy(b)
        if (accuracyDiff !== 0) return accuracyDiff
        const missesA = Number(a.times_attempted || 0) - Number(a.times_correct || 0)
        const missesB = Number(b.times_attempted || 0) - Number(b.times_correct || 0)
        return missesB - missesA
      })
      .slice(0, count)

    if (!weakQuestions.length) {
      setError(topicId ? `No saved questions below your ${targetScore}% target for this topic yet.` : `No saved questions below your ${targetScore}% target in this course yet.`)
      setGenerating(false)
      return
    }

    setQuestions(weakQuestions)
    setSavedMsg(`Loaded ${weakQuestions.length} weak saved question${weakQuestions.length === 1 ? '' : 's'}`)
    setTimeout(() => setSavedMsg(null), 2500)
    setGenerating(false)
  }

  async function saveQuiz() {
    if (!topicId || !questions.length) return
    const result = await window.api.saveQuiz({ topicId: Number(topicId), questions })
    const saved = await window.api.getQuiz(Number(topicId))
    const savedByQuestion = new Map(saved.map(q => [String(q.question || '').trim().toLowerCase(), q]))
    setQuestions(currentQuestions => currentQuestions.map(q => savedByQuestion.get(String(q.question || '').trim().toLowerCase()) || q))
    setInsightVersion(version => version + 1)
    setSavedMsg(result.created ? `Saved ${result.created}` : 'Already saved')
    setTimeout(() => setSavedMsg(null), 2000)
  }

  function pick(opt) {
    if (chosen !== null) return
    setChosen(opt)
    const q = questions[current]
    const correct = opt === q.answer
    window.api.recordAnswer({ id: q.id || 0, correct }).then(() => setInsightVersion(version => version + 1))
    setQuestions(currentQuestions => currentQuestions.map((item, index) => {
      if (index !== current) return item
      return {
        ...item,
        times_attempted: Number(item.times_attempted || 0) + 1,
        times_correct: Number(item.times_correct || 0) + (correct ? 1 : 0)
      }
    }))
    setResults(r => [...r, {
      id: q.id || null,
      topic_id: q.topic_id || Number(topicId) || null,
      topic_title: q.topic_title || topics.find(t => t.id === Number(topicId))?.title || null,
      question: q.question,
      options: q.options || [],
      chosen: opt,
      answer: q.answer,
      explanation: q.explanation || '',
      correct
    }])
  }

  function next() {
    current + 1 >= questions.length ? setDone(true) : (setCurrent(c => c + 1), setChosen(null))
  }

  function retryMissedOnly() {
    const missedQuestions = results
      .filter(result => !result.correct)
      .map(result => questions.find(q => q.id && q.id === result.id) || result)

    if (!missedQuestions.length) return
    setQuestions(missedQuestions)
    setResults([])
    setCurrent(0)
    setChosen(null)
    setDone(false)
    setSavedMsg('Retrying missed questions only')
    setTimeout(() => setSavedMsg(null), 2000)
  }

  async function createMissedReviewTask() {
    const missed = results.filter(result => !result.correct)
    const topic = topics.find(t => t.id === Number(topicId))
    const course = courses.find(c => c.id === Number(courseId))
    if (!missed.length) return

    setCreatingReview(true)
    await window.api.createTask({
      title: `Review missed quiz: ${topic?.title || 'mixed weak topics'}`,
      kind: 'review',
      courseId: Number(courseId) || null,
      topicId: topic ? Number(topicId) : null,
      dueDate: todayKey(),
      priority: 1,
      estimateMinutes: Math.max(20, Math.min(60, missed.length * 10)),
      subtasks: missed.slice(0, 6).map((item, index) => ({
        id: `missed-${Date.now()}-${index}`,
        title: `Explain why${item.topic_title ? ` (${item.topic_title})` : ''}: ${String(item.question).slice(0, 90)}`,
        completed: 0
      })),
      notes: [
        `Created from ${missed.length} missed quiz question${missed.length === 1 ? '' : 's'}.`,
        course ? `Course: ${course.name}` : '',
        missed.map((item, index) => `${index + 1}. ${item.topic_title ? `[${item.topic_title}] ` : ''}${item.question}\nCorrect answer: ${item.answer}${item.explanation ? `\nWhy: ${item.explanation}` : ''}`).join('\n\n')
      ].filter(Boolean).join('\n\n')
    })
    await window.api.generateStudyPlan()
    setCreatingReview(false)
    setSavedMsg('Review task created for missed questions')
    setTimeout(() => setSavedMsg(null), 2500)
  }

  const q = questions[current]
  const score = results.filter(r => r.correct).length
  const missedResults = results.filter(r => !r.correct)
  const currentPerformance = questionPerformance(q)

  return (
    <div className="page quiz-page">
      <div className="page-header">
        <h1>Quiz</h1>
        <p>Generate practice questions from uploaded content using your local Ollama model.</p>
      </div>

      {!questions.length && (
        <div className="quiz-start-grid">
          <section className="panel quiz-setup">
            <div className="panel-title-row">
              <div>
                <h2>Set up quiz</h2>
                <p>Pick one topic when you want a focused drill. Leave topic empty only for weak-review mode.</p>
              </div>
              <span>{count} questions</span>
            </div>

            <label>Course</label>
            <select className="field" value={courseId} onChange={e => setCourseId(e.target.value)}>
              <option value="">Pick a course</option>
              {courses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>

            {topics.length > 0 && (
              <>
                <label>Topic</label>
                <select className="field" value={topicId} onChange={e => setTopicId(e.target.value)}>
                  <option value="">Pick a topic</option>
                  {topics.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
                </select>
              </>
            )}

            <label>Questions: {count}</label>
            <input className="range" type="range" min={3} max={15} value={count} onChange={e => setCount(Number(e.target.value))} />

            {(quizInsight || insightLoading) && (
              <div className="quiz-insight-panel">
                <div>
                  <span>Quiz bank</span>
                  <strong>{insightLoading ? 'Loading...' : quizInsight.label}</strong>
                </div>
                <div className="quiz-insight-grid">
                  <div><span>Saved</span><strong>{quizInsight?.saved || 0}</strong></div>
                  <div><span>Attempted</span><strong>{quizInsight?.attempted || 0}</strong></div>
                  <div><span>Below target</span><strong>{quizInsight?.belowTarget || 0}</strong></div>
                  <div><span>Accuracy</span><strong>{quizInsight?.accuracy || 0}%</strong></div>
                  <div><span>Target</span><strong>{quizInsight?.targetScore || targetScore}%</strong></div>
                  <div><span>Gap</span><strong>{quizInsight?.targetGap === null ? 'n/a' : `${quizInsight?.targetGap > 0 ? '+' : ''}${quizInsight?.targetGap}%`}</strong></div>
                </div>
                {quizInsight && quizInsight.untouched > 0 && <p>{quizInsight.untouched} saved question{quizInsight.untouched === 1 ? '' : 's'} not attempted yet.</p>}
              </div>
            )}

            {error && <div className="error-msg">{error}</div>}

            <div className="button-row">
              <button className="primary-btn" onClick={generate} disabled={generating || !topicId}>
                {generating ? 'Generating...' : 'Generate with AI'}
              </button>
              <button className="secondary-btn" onClick={loadSaved} disabled={!topicId}>Load saved</button>
              <button className="secondary-btn" onClick={loadWeakSaved} disabled={!courseId || generating}>Review weak saved</button>
            </div>
            <p className="quiz-hint">Weak review uses questions you previously missed. Pick a topic for focused review, or leave topic empty to review across the course.</p>

            {generating && <div className="muted">Asking your selected Ollama model. This can take 10 to 30 seconds.</div>}
          </section>

          <aside className="panel quiz-ai-card">
            <div className="panel-title-row">
              <div>
                <h2>Local AI</h2>
                <p>Quiz generation runs through Ollama on this computer.</p>
              </div>
              <span className={`ai-status ${ollamaStatus?.ok ? 'online' : 'offline'}`}>
                {checkingOllama ? 'Checking' : ollamaStatus?.ok ? 'Online' : 'Offline'}
              </span>
            </div>

            <div className="ai-model-box">
              <span>Selected model</span>
              <strong>{ollamaStatus?.model || 'No model detected'}</strong>
              <p>{ollamaStatus?.message || 'Checking localhost:11434...'}</p>
              {ollamaStatus?.action && <code>{ollamaStatus.action}</code>}
            </div>

            <div className="quiz-flow-list">
              <div><strong>1</strong><span>Generate questions from the selected topic.</span></div>
              <div><strong>2</strong><span>Answer them so accuracy is saved by topic.</span></div>
              <div><strong>3</strong><span>Use weak review to drill missed questions later.</span></div>
            </div>

            <button className="secondary-btn" onClick={refreshOllamaStatus} disabled={checkingOllama}>
              {checkingOllama ? 'Checking...' : 'Check Ollama'}
            </button>
          </aside>
        </div>
      )}

      {questions.length > 0 && !done && q && (
        <>
          <section className="panel quiz-progress">
            <div>
              <span>Question {current + 1} of {questions.length}</span>
              <span>{score} correct so far</span>
              {savedMsg && <span>{savedMsg}</span>}
            </div>
            <div className="progress"><span style={{ width: `${(current / questions.length) * 100}%` }} /></div>
          </section>

          <section className="panel quiz-card">
            <div className="quiz-question-meta">
              {q.topic_title && <span>{q.topic_title}</span>}
              <span>{currentPerformance.attempts ? `${currentPerformance.attempts} attempt${currentPerformance.attempts === 1 ? '' : 's'}` : 'New question'}</span>
              {currentPerformance.accuracy !== null && <span>{currentPerformance.accuracy}% accuracy</span>}
              {currentPerformance.misses > 0 && <strong>{currentPerformance.misses} miss{currentPerformance.misses === 1 ? '' : 'es'}</strong>}
            </div>
            <h2>{q.question}</h2>
            <div className="answer-list">
              {(q.options || []).map((opt, i) => {
                let cls = ''
                if (chosen !== null) {
                  if (opt === q.answer) cls = 'correct'
                  else if (opt === chosen) cls = 'wrong'
                }
                return <button key={i} className={cls} onClick={() => pick(opt)}>{opt}</button>
              })}
            </div>

            {chosen !== null && (
              <div className="quiz-footer">
                {q.explanation && <div className="explanation">{q.explanation}</div>}
                <div className="button-row apart">
                  <div className="button-row">
                    <button className="secondary-btn" onClick={saveQuiz}>Save questions</button>
                    {savedMsg && <span className="success-msg">{savedMsg}</span>}
                  </div>
                  <button className="primary-btn" onClick={next}>
                    {current + 1 >= questions.length ? 'See results' : 'Next'}
                  </button>
                </div>
              </div>
            )}
          </section>
        </>
      )}

      {done && (
        <section className="panel quiz-results">
          <div className="score-box">
            <div className="score-mark">{score === questions.length ? 'Perfect' : score >= questions.length * 0.7 ? 'Pass range' : 'Review needed'}</div>
            <div className="score-number">{score}/{questions.length} correct</div>
            <p>{Math.round((score / questions.length) * 100)}% score</p>
          </div>

          {missedResults.length > 0 && (
            <div className="missed-review-panel">
              <div>
                <h3>{missedResults.length} missed question{missedResults.length === 1 ? '' : 's'}</h3>
                <p>Turn mistakes into a focused review task, or drill only the questions you missed.</p>
              </div>
              <div className="button-row">
                <button className="secondary-btn" onClick={retryMissedOnly}>Retry missed only</button>
                <button className="primary-btn" onClick={createMissedReviewTask} disabled={creatingReview}>
                  {creatingReview ? 'Creating...' : 'Create review task'}
                </button>
              </div>
              {savedMsg && <span className="success-msg">{savedMsg}</span>}
            </div>
          )}

          <div className="result-list">
            {results.map((r, i) => (
              <div key={i} className="result-row">
                <strong>{r.correct ? 'Correct' : 'Missed'}</strong>
                <span>{r.question}</span>
                {!r.correct && <em>You chose: {r.chosen} · Correct: {r.answer}</em>}
              </div>
            ))}
          </div>

          <div className="button-row">
            <button className="primary-btn" onClick={() => { setCurrent(0); setChosen(null); setResults([]); setDone(false) }}>Retry</button>
            <button className="secondary-btn" onClick={reset}>New quiz</button>
          </div>
        </section>
      )}
    </div>
  )
}
