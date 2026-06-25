import { useEffect, useState } from 'react'

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

  useEffect(() => { window.api.getCourses().then(setCourses) }, [])
  useEffect(() => {
    if (courseId) {
      window.api.getTopics(Number(courseId)).then(setTopics)
      setTopicId('')
    }
  }, [courseId])

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
    setSavedMsg(saveResult.created ? `Saved ${saveResult.created} for stats` : 'Using saved stats copy')
    setTimeout(() => setSavedMsg(null), 2500)
    setGenerating(false)
  }

  async function loadSaved() {
    if (!topicId) return
    const saved = await window.api.getQuiz(Number(topicId))
    if (!saved.length) {
      setError('No saved questions for this topic.')
      return
    }
    setError(null)
    reset()
    setQuestions(saved)
  }

  async function saveQuiz() {
    if (!topicId || !questions.length) return
    const result = await window.api.saveQuiz({ topicId: Number(topicId), questions })
    const saved = await window.api.getQuiz(Number(topicId))
    const savedByQuestion = new Map(saved.map(q => [String(q.question || '').trim().toLowerCase(), q]))
    setQuestions(currentQuestions => currentQuestions.map(q => savedByQuestion.get(String(q.question || '').trim().toLowerCase()) || q))
    setSavedMsg(result.created ? `Saved ${result.created}` : 'Already saved')
    setTimeout(() => setSavedMsg(null), 2000)
  }

  function pick(opt) {
    if (chosen !== null) return
    setChosen(opt)
    const q = questions[current]
    const correct = opt === q.answer
    window.api.recordAnswer({ id: q.id || 0, correct })
    setResults(r => [...r, { question: q.question, chosen: opt, answer: q.answer, correct }])
  }

  function next() {
    current + 1 >= questions.length ? setDone(true) : (setCurrent(c => c + 1), setChosen(null))
  }

  const q = questions[current]
  const score = results.filter(r => r.correct).length

  return (
    <div className="page">
      <div className="page-header">
        <h1>Quiz</h1>
        <p>Generate practice questions from uploaded content using your local Ollama model.</p>
      </div>

      {!questions.length && (
        <section className="panel quiz-setup">
          <h2>Set up quiz</h2>
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

          {error && <div className="error-msg">{error}</div>}

          <div className="button-row">
            <button className="primary-btn" onClick={generate} disabled={generating || !topicId}>
              {generating ? 'Generating...' : 'Generate with AI'}
            </button>
            <button className="secondary-btn" onClick={loadSaved} disabled={!topicId}>Load saved</button>
          </div>

          {generating && <div className="muted">Asking your selected Ollama model. This can take 10 to 30 seconds.</div>}
        </section>
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

          <div className="result-list">
            {results.map((r, i) => (
              <div key={i} className="result-row">
                <strong>{r.correct ? 'Correct' : 'Missed'}</strong>
                <span>{r.question}</span>
                {!r.correct && <em>Correct: {r.answer}</em>}
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
