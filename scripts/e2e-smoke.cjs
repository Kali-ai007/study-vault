const assert = require('assert')
const fs = require('fs')
const path = require('path')
const { _electron: electron } = require('playwright-core')

const appRoot = path.resolve(__dirname, '..')
const importPath = path.join(appRoot, 'tmp', 'e2e-course.md')
const courseName = `E2E Course ${Date.now()}`

const courseContent = `# ${courseName}

## 1.1 - Network Foundations
Packets, protocols, ports, segmentation, and basic troubleshooting. Study this before moving into device configuration.

## 1.2 - Secure Authentication
Identity, access control, multifactor authentication, password policy, and account recovery procedures.

## 1.3 - Wireless Planning
Coverage, interference, bands, channels, signal strength, and secure wireless settings.
`

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function clickNav(page, name) {
  await page.getByRole('button', { name }).click()
}

async function resizeWindow(app, width, height) {
  await app.evaluate(({ BrowserWindow }, size) => {
    const win = BrowserWindow.getAllWindows()[0]
    win.setSize(size.width, size.height)
  }, { width, height })

  await wait(250)

  return app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    const [width, height] = win.getSize()
    return { width, height }
  })
}

async function assertNoHorizontalOverflow(page, label) {
  const metrics = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    bodyScrollWidth: document.body.scrollWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
    appScrollWidth: document.querySelector('.app-shell')?.scrollWidth || 0
  }))
  const maxScrollWidth = Math.max(metrics.bodyScrollWidth, metrics.documentScrollWidth, metrics.appScrollWidth)
  assert.ok(
    maxScrollWidth <= metrics.innerWidth + 8,
    `${label}: horizontal overflow detected. inner=${metrics.innerWidth}, maxScroll=${maxScrollWidth}`
  )
}

async function getOrCreateCourse(page) {
  const existing = await page.evaluate(async name => {
    const courses = await window.api.getCourses()
    return courses.find(course => course.name === name) || null
  }, courseName)

  if (existing) return existing

  await clickNav(page, /Courses/)
  await page.getByPlaceholder('Course name').fill(courseName)
  await page.getByRole('button', { name: 'Create' }).click()
  await page.getByText(courseName).first().waitFor({ timeout: 10000 })

  return page.evaluate(async name => {
    const courses = await window.api.getCourses()
    return courses.find(course => course.name === name)
  }, courseName)
}

async function main() {
  fs.mkdirSync(path.dirname(importPath), { recursive: true })
  fs.writeFileSync(importPath, courseContent)

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
    }, importPath)

    course = await getOrCreateCourse(page)
    assert.ok(course?.id, 'course was not created')

    await page.evaluate(async id => {
      await window.api.deleteCourseTasks(id)
      await window.api.replaceTopics({ courseId: id, topics: [] })
    }, course.id)
    await page.reload()
    await page.waitForLoadState('domcontentloaded')

    await clickNav(page, /Courses/)
    await page.getByText(courseName).first().click()
    await page.getByRole('button', { name: /Upload content|Re-import content/ }).click()
    await page.locator('.info-msg', { hasText: /Imported/i }).waitFor({ timeout: 30000 })

    await page.getByRole('button', { name: /Build study tasks/ }).click()
    await page.locator('.info-msg', { hasText: /Created|Updated|study tasks/i }).waitFor({ timeout: 30000 })

    await clickNav(page, /Today/)
    await page.getByRole('button', { name: /Auto-plan/ }).click()
    await page.locator('.planned-block').first().waitFor({ timeout: 30000 })

    await page.locator('.planned-block').first().click()
    await page.getByText(/Track progress/i).waitFor({ timeout: 10000 })
    await page.getByRole('button', { name: '+15m' }).click()
    await page.getByRole('button', { name: /Mark complete/ }).click()
    await page.getByRole('button', { name: /Save changes/ }).click()
    await page.getByLabel('Close task details').click()

    await clickNav(page, /Stats/)
    await page.getByText(/Exam readiness|Course progress|Study hours/).first().waitFor({ timeout: 10000 })

    await clickNav(page, /Quiz/)
    await page.getByText(/Local AI|Set up quiz/).first().waitFor({ timeout: 10000 })

    const sizes = [
      { label: 'desktop', width: 1366, height: 768 },
      { label: 'small laptop', width: 1024, height: 768 },
      { label: 'narrow', width: 760, height: 900 }
    ]

    for (const size of sizes) {
      const actual = await resizeWindow(app, size.width, size.height)
      assert.ok(actual.width <= size.width + 8, `${size.label}: Electron clamped width to ${actual.width}`)

      for (const screen of [/Today/, /Courses/, /Stats/, /Quiz/]) {
        await clickNav(page, screen)
        await wait(150)
        await assertNoHorizontalOverflow(page, `${size.label} ${screen}`)
      }
    }

    console.log(JSON.stringify({ ok: true, course: courseName, tested: sizes }, null, 2))
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
    fs.rmSync(importPath, { force: true })
  }
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
