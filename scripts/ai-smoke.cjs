const assert = require('assert')
const path = require('path')
const { _electron: electron } = require('playwright-core')

const appRoot = path.resolve(__dirname, '..')

async function main() {
  const app = await electron.launch({
    executablePath: path.join(appRoot, 'node_modules', 'electron', 'dist', 'electron.exe'),
    args: ['.'],
    cwd: appRoot
  })

  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await page.getByText('Study Vault').waitFor({ timeout: 15000 })

    const status = await page.evaluate(() => window.api.getOllamaStatus())
    assert.ok(status.ok, status.message || 'Ollama is offline')

    const questions = await page.evaluate(() => window.api.generateQuiz({
      count: 2,
      content: `Authentication verifies identity before access is granted.
Multi-factor authentication combines something you know, something you have, or something you are.
Access control should follow least privilege so users only receive permissions needed for their role.`
    }))
    assert.ok(Array.isArray(questions), questions?.error || 'quiz generation did not return an array')
    assert.ok(questions.length >= 1, 'quiz generation returned no questions')
    assert.ok(questions[0].question && Array.isArray(questions[0].options), 'quiz question shape is invalid')

    const analysis = await page.evaluate(() => window.api.analyzeStudyStats({
      readiness: {
        score: 72,
        label: 'Building',
        factors: [
          { label: 'Sections', percent: 68, weight: 30 },
          { label: 'Tasks', percent: 70, weight: 20 },
          { label: 'Quiz', percent: 62, weight: 15 }
        ]
      },
      totals: {
        remainingMinutes: 480,
        openTasks: 8,
        completedTasks: 21,
        quizAccuracy: 62,
        linkedSessions: 5,
        sessions: 7
      },
      pace: {
        dailyNeededMinutes: 55,
        cushionMinutes: 140
      },
      courseRows: [
        { name: 'Security+', sectionPercent: 68, remainingMinutes: 480 }
      ],
      weakQuizTopics: [
        { title: 'Authentication', accuracy: 50, attempts: 4 }
      ],
      completions: []
    }))
    assert.ok(analysis?.ok, analysis?.error || 'AI stats analysis failed')
    const analysisText = String(analysis.analysis || analysis.text || '')
    assert.ok(analysisText.length > 100, `AI analysis returned too little text: ${analysisText}`)

    console.log(JSON.stringify({
      ok: true,
      model: status.model,
      quizQuestions: questions.length,
      analysisChars: analysisText.length
    }, null, 2))
  } finally {
    await app.close()
  }
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
