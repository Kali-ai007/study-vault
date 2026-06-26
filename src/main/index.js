import { app, shell, BrowserWindow, ipcMain, dialog, screen } from 'electron'
import { join } from 'path'
import { createRequire } from 'module'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { autoUpdater } from 'electron-updater'
import { initDatabase, dbHandlers } from './database'
import fs from 'fs'

// Use createRequire so CommonJS packages work inside ES module context
const require = createRequire(import.meta.url)
const pdfParse = require('pdf-parse')

let mainWindow

function getInitialWindowBounds() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize
  return {
    width: Math.min(width, Math.max(1040, Math.round(width * 0.82))),
    height: Math.min(height, Math.max(680, Math.round(height * 0.86)))
  }
}

function cleanLine(raw) {
  let line = String(raw || '').replace(/\u00a0/g, ' ').trim()
  if (!line) return ''

  line = line.replace(/^©\s*\d{4}.*?Course Notes\s*-\s*Page\s+\d+\s*/i, '')
  line = line.replace(/^.*?Course Notes\s*-\s*Page\s+\d+\s*/i, '')
  line = line.replace(/^©\s*\d{4}.*?ProfessorMesser\.com\s*/i, '')
  line = line.replace(/^Professor Messer.*?Course Notes\s*-?\s*/i, '')
  line = line.replace(/^Page\s+\d+\s*/i, '')
  line = line.replace(/https?:\/\/\S+/gi, '')
  line = line.replace(/\s+/g, ' ').trim()

  if (/^©?\s*\d{4}\s+Messer Studios/i.test(line)) return ''
  if (/^ProfessorMesser\.com$/i.test(line)) return ''
  if (/^Page\s+\d+$/i.test(line)) return ''
  return line
}

function cleanPdfText(rawText) {
  return String(rawText || '')
    .replace(/\r/g, '\n')
    .split('\n')
    .map(cleanLine)
    .filter(Boolean)
}

function removeDuplicateTitle(text) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim()
  const words = normalized.split(' ')

  for (let size = 1; size <= Math.floor(words.length / 2); size++) {
    if (size * 2 !== words.length) continue
    const first = words.slice(0, size).join(' ').toLowerCase()
    const second = words.slice(size, size * 2).join(' ').toLowerCase()
    if (first === second) return words.slice(0, size).join(' ')
  }

  return normalized
}

function extractObjectiveHeading(line) {
  const match = line.match(/(?:^|\s)((?:\d+\.)+\d*)\s*[-–]\s*([^•]{3,120})/)
  if (!match) return null

  const objective = match[1]
  const rawTitle = removeDuplicateTitle(match[2])
    .replace(/\s*[-–]\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
  const title = `${objective} - ${rawTitle}`
  const afterTitle = line.slice(match.index + match[0].length)
    .replace(/^[\s•\-–:]+/, '')
    .trim()

  return { title, content: afterTitle }
}

function appendContent(section, line) {
  if (!line) return
  const normalized = line.replace(/\s+/g, ' ').trim()
  if (!normalized) return
  const existing = section.content.split('\n').map(x => x.trim().toLowerCase())
  if (existing.includes(normalized.toLowerCase())) return
  section.content += `${section.content ? '\n' : ''}${normalized}`
}

function parseJsonCourse(rawText) {
  try {
    const data = JSON.parse(rawText)
    const topics = Array.isArray(data) ? data : data.topics
    if (!Array.isArray(topics)) return null
    return topics
      .map(t => ({ title: t.title || t.name || 'Untitled section', content: t.content || t.notes || '' }))
      .filter(t => t.title.trim())
  } catch {
    return null
  }
}

function parseMarkdownCourse(rawText) {
  const sections = String(rawText || '').split(/\n(?=#{1,3} )/).filter(Boolean)
  if (sections.length <= 1) return null

  return sections.map(section => {
    const lines = section.trim().split('\n')
    return {
      title: lines[0].replace(/^#+\s*/, '').trim(),
      content: lines.slice(1).join('\n').trim()
    }
  }).filter(t => t.title)
}

function parseObjectiveCourse(rawText) {
  const lines = cleanPdfText(rawText)
  const sections = []
  let current = null

  for (const line of lines) {
    const heading = extractObjectiveHeading(line)

    if (heading) {
      if (!current || current.title.toLowerCase() !== heading.title.toLowerCase()) {
        if (current) sections.push(current)
        current = { title: heading.title, content: '' }
      }
      appendContent(current, heading.content)
      continue
    }

    if (current) appendContent(current, line)
  }

  if (current) sections.push(current)

  return sections
    .map(section => ({
      title: section.title,
      content: section.content.trim()
    }))
    .filter(section => section.title && section.content.length > 15)
}

function normalizePrintedHeading(raw) {
  return String(raw || '')
    .replace(/(?:\.\s*){2,}\s*\d+\s*$/, '')
    .replace(/^\d+(?=[A-Z])/, '')
    .replace(/\s+\d+$/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractTocHeadings(lines) {
  const headings = []
  const seen = new Set()
  const tocWindow = lines.slice(0, 140)

  for (const line of tocWindow) {
    const hasDotLeader = /(?:\.\s*){2,}\s*\d+\s*$/.test(line)
    const looksLikeChapter = /^[A-Z][A-Za-z ,'-]{5,70}\s+\d+$/.test(line)
    if (!hasDotLeader && !looksLikeChapter) continue

    const heading = normalizePrintedHeading(line)
    if (!heading || /^contents$/i.test(heading) || heading.length < 4 || heading.length > 90) continue

    const key = heading.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    headings.push(heading)
  }

  return headings
}

function parseTocCourse(rawText) {
  const rawLines = cleanPdfText(rawText)
  const headings = extractTocHeadings(rawLines)
  const lines = rawLines
    .map(normalizePrintedHeading)
    .filter(Boolean)
  if (headings.length < 5) return null

  const headingSet = new Set(headings.map(heading => heading.toLowerCase()))
  const seenHeadings = new Set()
  let startIndex = -1

  for (let i = 0; i < lines.length; i++) {
    const key = lines[i].toLowerCase()
    if (!headingSet.has(key)) continue
    if (seenHeadings.has(key)) {
      startIndex = i
      break
    }
    seenHeadings.add(key)
  }

  if (startIndex < 0) return null

  const sections = []
  let current = null

  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i]
    const key = line.toLowerCase()

    if (headingSet.has(key)) {
      if (current?.title.toLowerCase() === key) continue
      if (current && current.content.trim().length > 40) sections.push(current)
      current = { title: line, content: '' }
      continue
    }

    if (!current) continue
    if (/^\d+$/.test(line)) continue
    if (/^contents$/i.test(line)) continue
    appendContent(current, line)
  }

  if (current && current.content.trim().length > 40) sections.push(current)

  return sections
    .map(section => ({
      title: section.title,
      content: section.content.trim()
    }))
    .filter(section => section.title && section.content.length > 40)
}

function parseParagraphCourse(rawText) {
  const paragraphs = cleanPdfText(rawText)
    .join('\n')
    .split(/\n{2,}|(?<=\.)\s+(?=[A-Z][A-Za-z ,'-]{8,80}\s+[A-Z])/)
    .map(p => p.trim())
    .filter(p => p.length > 60)

  const chunks = []
  let current = ''
  for (const paragraph of paragraphs) {
    if (current.length + paragraph.length > 1800) {
      if (current) chunks.push(current)
      current = paragraph
    } else {
      current += `${current ? '\n\n' : ''}${paragraph}`
    }
  }
  if (current) chunks.push(current)

  return chunks.map((content, index) => ({
    title: `Section ${index + 1}`,
    content
  }))
}

function parseCourseContent(name, rawText) {
  const lowerName = String(name || '').toLowerCase()

  if (lowerName.endsWith('.json')) {
    const json = parseJsonCourse(rawText)
    if (json?.length) return { method: 'json', topics: json }
  }

  if (lowerName.endsWith('.md') || /(^|\n)#{1,3}\s+/.test(rawText)) {
    const markdown = parseMarkdownCourse(rawText)
    if (markdown?.length) return { method: 'markdown', topics: markdown }
  }

  const objectiveSections = parseObjectiveCourse(rawText)
  if (objectiveSections.length >= 3) {
    return { method: 'objective headings', topics: objectiveSections }
  }

  const tocSections = parseTocCourse(rawText)
  if (tocSections?.length >= 5) {
    return { method: 'table of contents headings', topics: tocSections }
  }

  return { method: 'paragraph chunks', topics: parseParagraphCourse(rawText) }
}

function extractJsonArray(text) {
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']') + 1
  if (start < 0 || end <= start) throw new Error('AI did not return a JSON array')
  return JSON.parse(text.slice(start, end))
}

const OLLAMA_BASE_URL = 'http://127.0.0.1:11434'

async function fetchOllama(path, options = {}, timeoutMs = 15000) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(`${OLLAMA_BASE_URL}${path}`, {
      ...options,
      signal: controller.signal
    })
  } finally {
    clearTimeout(timeout)
  }
}

async function getOllamaStatus() {
  try {
    const response = await fetchOllama('/api/tags', {}, 8000)
    if (!response.ok) throw new Error('Ollama API did not respond')
    const data = await response.json()
    const models = Array.isArray(data.models) ? data.models.map(model => model.name) : []
    const model = models.includes('mistral:latest')
      ? 'mistral:latest'
      : models.find(name => name.startsWith('mistral'))
        || models[0]
        || null

    if (!model) {
      return {
        ok: false,
        code: 'no_models',
        model: null,
        models,
        message: 'Ollama is running, but no local models are installed.',
        action: 'Run: ollama pull mistral'
      }
    }

    return {
      ok: true,
      code: model.startsWith('mistral') ? 'ready' : 'fallback_model',
      model,
      models,
      message: model.startsWith('mistral')
        ? `Ollama connected with ${model}.`
        : `Ollama connected, using ${model}. Mistral is recommended.`,
      action: model.startsWith('mistral') ? null : 'For best results run: ollama pull mistral'
    }
  } catch (err) {
    return {
      ok: false,
      code: 'offline',
      model: null,
      models: [],
      message: 'Ollama is not reachable on 127.0.0.1:11434.',
      action: 'Open Ollama or run: ollama serve',
      error: err.message
    }
  }
}

function minutesLabel(minutes = 0) {
  const sign = minutes < 0 ? '-' : ''
  const abs = Math.abs(Math.round(Number(minutes || 0)))
  const h = Math.floor(abs / 60)
  const m = abs % 60
  if (!h) return `${sign}${m}m`
  return m ? `${sign}${h}h ${m}m` : `${sign}${h}h`
}

function fallbackStudyAnalysis(analytics = {}) {
  const totals = analytics.totals || {}
  const readiness = analytics.readiness || {}
  const pace = analytics.pace || {}
  const weakTopics = analytics.weakQuizTopics || []
  const courseRows = analytics.courseRows || []
  const weakestCourse = [...courseRows].sort((a, b) => (a.sectionPercent || 0) - (b.sectionPercent || 0))[0]
  const paceDelta = Number(totals.paceDeltaMinutes || 0)
  const actions = []

  if ((readiness.score || totals.readinessScore || 0) < 70) actions.push('Protect one focused study block today before adding new material.')
  if (paceDelta < 0) actions.push(`Add ${minutesLabel(Math.abs(paceDelta))} per day or reduce workload to get back on pace.`)
  if (weakTopics.length) actions.push(`Review the weakest quiz topic: ${weakTopics[0].topicTitle} (${weakTopics[0].accuracyPercent}% accuracy).`)
  if (Number(totals.linkedSessions || 0) < Number(totals.sessions || 0)) actions.push('Link future study logs to exact tasks so time estimates get smarter.')
  while (actions.length < 3) actions.push('Complete the next planned task and log time against it.')

  return `## Snapshot
- Readiness: ${readiness.score || totals.readinessScore || 0}% (${readiness.label || totals.readinessLabel || 'not calculated'}).
- Remaining workload: ${minutesLabel(totals.remainingMinutes || 0)}.
- Required daily pace: ${minutesLabel(totals.requiredDailyMinutes || pace.requiredDailyMinutes || 0)}.
- Recent daily average: ${minutesLabel(totals.recentDailyAverageMinutes || pace.recentDailyAverageMinutes || 0)}.
- Quiz accuracy: ${totals.quizAccuracyPercent || 0}% from ${totals.quizAttempts || 0} attempts.

## What is working
- ${totals.currentStreakDays || 0} day current streak, ${totals.longestStreakDays || 0} day longest streak.
- ${totals.completedTasks || 0} tasks complete and ${totals.completedSections || 0}/${totals.sections || 0} sections complete.
- ${totals.timedCompletions || 0} completed tasks have linked timing data for estimate calibration.

## Risk areas
- ${paceDelta < 0 ? `Behind pace by ${minutesLabel(Math.abs(paceDelta))}/day.` : `Ahead of required pace by ${minutesLabel(paceDelta)}/day.`}
- ${weakTopics.length ? `${weakTopics.length} weak quiz topic(s) are below 70% accuracy.` : 'No weak quiz topics yet, or quiz evidence is still thin.'}
- ${weakestCourse ? `${weakestCourse.name} has ${weakestCourse.sectionPercent}% section progress.` : 'No course progress data yet.'}

## Next 3 actions
1. ${actions[0]}
2. ${actions[1]}
3. ${actions[2]}

## What to track next
- Log time against tasks, not just courses.
- Answer saved or generated quiz questions after each review.
- Keep exam date and fixed schedule blocks updated so pace and cushion stay honest.`
}

async function aiStructureCourse(name, rawText) {
  const status = await getOllamaStatus()
  if (!status.ok) throw new Error(status.action || status.message)
  const sample = cleanPdfText(rawText).join('\n').slice(0, 12000)
  const prompt = `You organize study material into real course sections.
Return ONLY a JSON array. Each item must be { "title": string, "content": string }.
Rules:
- Use real section/objective names from the material.
- Remove repeated PDF headers, footers, copyright lines, URLs, and page numbers.
- Do not create generic titles like "Section 1" unless no title exists.
- Keep content concise but useful for studying.

File: ${name}

Material:
${sample}`

  const response = await fetchOllama('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: status.model, prompt, stream: false })
  }, 180000)

  if (!response.ok) throw new Error('Ollama generation failed. Check the selected local model.')
  const data = await response.json()
  return extractJsonArray(String(data.response || '')).filter(t => t.title && t.content)
}

function createWindow() {
  const initialBounds = getInitialWindowBounds()

  mainWindow = new BrowserWindow({
    ...initialBounds,
    minWidth: 720,
    minHeight: 560,
    backgroundColor: '#f6f8ff',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow.show())

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.studyvault.app')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  initDatabase()
  dbHandlers(ipcMain)

  // ── File picker ──────────────────────────────────────────────────────────
  // PDFs are binary — use pdf-parse to extract real text.
  // Markdown / JSON / TXT read as UTF-8.
  ipcMain.handle('dialog:openFile', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select course file',
      filters: [{ name: 'Course files', extensions: ['pdf', 'md', 'json', 'txt'] }],
      properties: ['openFile']
    })
    if (result.canceled) return null

    const filePath = result.filePaths[0]
    const name = filePath.split(/[/\\]/).pop()

    if (name.toLowerCase().endsWith('.pdf')) {
      try {
        const buffer = fs.readFileSync(filePath)
        const data = await pdfParse(buffer)
        return { filePath, content: data.text, name }
      } catch (err) {
        return { filePath, content: '', name, error: 'PDF parse failed: ' + err.message }
      }
    }

    // Plain text files
    const content = fs.readFileSync(filePath, 'utf-8')
    return { filePath, content, name }
  })

  ipcMain.handle('ai:structureCourse', async (_, { name, content, useAi = true }) => {
    try {
      const parsed = parseCourseContent(name, content)
      const generic = parsed.topics.some(t => /^Section\s+\d+$/i.test(t.title))

      if (useAi && (parsed.topics.length < 3 || generic)) {
        try {
          const aiTopics = await aiStructureCourse(name, content)
          if (aiTopics.length >= 2) {
            return { ok: true, method: 'ollama', topics: aiTopics }
          }
        } catch (err) {
          return {
            ok: true,
            method: `${parsed.method}; AI unavailable: ${err.message}`,
            topics: parsed.topics
          }
        }
      }

      return { ok: true, method: parsed.method, topics: parsed.topics }
    } catch (err) {
      return { ok: false, error: err.message, topics: [] }
    }
  })

  // ── Ollama quiz generation ───────────────────────────────────────────────
  ipcMain.handle('ai:generateQuiz', async (_, { content, count = 5 }) => {
    try {
      const status = await getOllamaStatus()
      if (!status.ok) throw new Error(status.action || status.message)
      const prompt = `You are a study quiz generator. Given the following course content, generate exactly ${count} multiple-choice questions. Return ONLY a JSON array with objects: { question, options: [A,B,C,D], answer, explanation }. No extra text.\n\nContent:\n${content.slice(0, 3000)}`

      const response = await fetchOllama('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: status.model, prompt, stream: false })
      }, 180000)

      if (!response.ok) throw new Error('Ollama generation failed. Check the selected local model.')
      const data = await response.json()
      const text = data.response.trim()
      const jsonStart = text.indexOf('[')
      const jsonEnd = text.lastIndexOf(']') + 1
      return JSON.parse(text.slice(jsonStart, jsonEnd))
    } catch (err) {
      return { error: err.message }
    }
  })

  // ── Auto-updater ─────────────────────────────────────────────────────────
  autoUpdater.on('update-available', () => {
    mainWindow?.webContents.send('updater:status', 'Update available — downloading...')
  })
  autoUpdater.on('update-downloaded', () => {
    mainWindow?.webContents.send('updater:status', 'Update ready — restart to install')
  })
  ipcMain.handle('ai:ollamaStatus', async () => getOllamaStatus())

  ipcMain.handle('ai:analyzeStudyStats', async (_, analytics) => {
    try {
      const status = await getOllamaStatus()
      if (!status.ok) throw new Error(status.action || status.message)
      const compact = JSON.stringify(analytics).slice(0, 12000)
      const prompt = `You are Study Vault's local academic analytics coach.
Analyze the student's Study Vault JSON and give a practical, numbers-first report.
Use readiness.score, readiness.factors, pace, courseRows, weakQuizTopics, completions, and totals when present.
Mention specific course/topic names when the data includes them.
Do not invent data. If evidence is thin, say exactly which metric needs more tracking.

Return concise markdown with exactly these sections:
## Snapshot
- One line with readiness score/label, remaining workload, cushion or pace risk, and quiz accuracy.

## Diagnosis
- 3 bullets explaining what the numbers mean.
- Include whether the student is ahead/behind daily pace.
- Include the weakest readiness factor.

## Risk areas
- 2-4 bullets.
- Include weak quiz topics below 70%, overdue/open workload, estimate bias, or low linked sessions if relevant.

## Next 3 actions
1. A concrete action for today.
2. A concrete action for the next 3 days.
3. A concrete tracking improvement.

## What to track next
- 2-3 bullets focused on better data collection.

Data:
${compact}`

      const response = await fetchOllama('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: status.model, prompt, stream: false })
      }, 180000)

      if (!response.ok) throw new Error('Ollama generation failed. Check the selected local model.')
      const data = await response.json()
      return { ok: true, method: 'ollama', model: status.model, analysis: String(data.response || '').trim() }
    } catch (err) {
      const fallback = fallbackStudyAnalysis(analytics)
      return {
        ok: false,
        method: 'fallback',
        error: err.message,
        analysis: `${fallback}\n\n_AI analysis used the local fallback because Ollama was unavailable: ${err.message || 'Start Ollama, then run Analyze again.'}_`
      }
    }
  })

  ipcMain.handle('updater:check', () => autoUpdater.checkForUpdates())
  ipcMain.handle('updater:install', () => autoUpdater.quitAndInstall())

  createWindow()

  setTimeout(() => { if (!is.dev) autoUpdater.checkForUpdates() }, 10000)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
