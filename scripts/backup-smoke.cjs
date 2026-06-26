const assert = require('assert')
const path = require('path')
const { _electron: electron } = require('playwright-core')

const appRoot = path.resolve(__dirname, '..')
const courseName = `Backup Smoke ${Date.now()}`

async function main() {
  const app = await electron.launch({
    executablePath: path.join(appRoot, 'node_modules', 'electron', 'dist', 'electron.exe'),
    args: ['.'],
    cwd: appRoot
  })

  let originalBackup = null
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await page.getByText('Study Vault').waitFor({ timeout: 15000 })

    originalBackup = await page.evaluate(() => window.api.exportBackup())
    assert.ok(originalBackup?.ok, 'original backup export failed')

    const created = await page.evaluate(name => window.api.createCourse({ name, description: '' }), courseName)
    assert.ok(created?.id, 'temporary course was not created')

    const backupWithTempCourse = await page.evaluate(() => window.api.exportBackup())
    assert.ok(backupWithTempCourse?.ok, 'backup with temp course failed')

    await page.evaluate(id => window.api.deleteCourse(id), created.id)
    const afterDelete = await page.evaluate(name => window.api.getCourses().then(courses => courses.some(course => course.name === name)), courseName)
    assert.equal(afterDelete, false, 'temporary course was not deleted before restore')

    const restored = await page.evaluate(backup => window.api.importBackup(backup), backupWithTempCourse)
    assert.ok(restored?.ok, 'backup import failed')

    const afterRestore = await page.evaluate(name => window.api.getCourses().then(courses => courses.some(course => course.name === name)), courseName)
    assert.equal(afterRestore, true, 'temporary course was not restored from backup')

    console.log(JSON.stringify({
      ok: true,
      originalCounts: originalBackup.counts,
      restoredCounts: restored.counts
    }, null, 2))
  } finally {
    try {
      if (originalBackup) {
        const page = await app.firstWindow()
        await page.evaluate(backup => window.api.importBackup(backup), originalBackup)
      }
    } catch (error) {
      console.warn('restore warning:', error.message)
    }
    await app.close()
  }
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
