const assert = require('assert')
const path = require('path')
const { _electron: electron } = require('playwright-core')

const appRoot = path.resolve(__dirname, '..')
const pdfPath = process.argv[2] || process.env.PDF_SMOKE_PATH
const courseName = `PDF Smoke ${Date.now()}`

if (!pdfPath) {
  console.error('Usage: npm run test:pdf -- "C:\\path\\to\\course.pdf"')
  process.exit(1)
}

async function clickNav(page, name) {
  await page.getByRole('button', { name }).click()
}

async function main() {
  const app = await electron.launch({
    executablePath: path.join(appRoot, 'node_modules', 'electron', 'dist', 'electron.exe'),
    args: ['.'],
    cwd: appRoot
  })

  let course
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await page.getByText('Study Vault').waitFor({ timeout: 15000 })

    await app.evaluate(({ dialog }, filePath) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] })
    }, path.resolve(pdfPath))

    await clickNav(page, /Courses/)
    await page.getByPlaceholder('Course name').fill(courseName)
    await page.getByRole('button', { name: 'Create' }).click()
    await page.getByText(courseName).first().waitFor({ timeout: 10000 })

    course = await page.evaluate(async name => {
      const courses = await window.api.getCourses()
      return courses.find(course => course.name === name)
    }, courseName)
    assert.ok(course?.id, 'PDF smoke course was not created')

    const aiFallback = page.locator('.ai-toggle input')
    if (await aiFallback.isChecked()) await aiFallback.uncheck()

    await page.getByRole('button', { name: /Upload content|Re-import content/ }).click()
    await page.locator('.info-msg', { hasText: /Imported/i }).waitFor({ timeout: 120000 })

    const topics = await page.evaluate(async id => window.api.getTopics(id), course.id)
    assert.ok(topics.length >= 20, `expected at least 20 topics from PDF, got ${topics.length}`)

    await page.getByRole('button', { name: /Build study tasks/ }).click()
    await page.locator('.info-msg', { hasText: /Created|Updated|study tasks/i }).waitFor({ timeout: 60000 })

    const tasks = await page.evaluate(async id => {
      const all = await window.api.getTasks('all')
      return all.filter(task => task.course_id === id)
    }, course.id)
    assert.ok(tasks.length >= 20, `expected at least 20 tasks from PDF, got ${tasks.length}`)

    console.log(JSON.stringify({
      ok: true,
      pdf: path.resolve(pdfPath),
      course: courseName,
      topics: topics.length,
      tasks: tasks.length,
      firstTopics: topics.slice(0, 5).map(topic => topic.title)
    }, null, 2))
  } finally {
    try {
      if (course?.id) {
        const page = await app.firstWindow()
        await page.evaluate(async id => {
          await window.api.deleteCourse(id)
        }, course.id)
      }
    } catch (error) {
      console.warn('cleanup warning:', error.message)
    }
    await app.close()
  }
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
