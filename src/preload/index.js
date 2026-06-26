import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {
  openFile: () => ipcRenderer.invoke('dialog:openFile'),
  getCourses: () => ipcRenderer.invoke('db:getCourses'),
  createCourse: (data) => ipcRenderer.invoke('db:createCourse', data),
  updateCourse: (data) => ipcRenderer.invoke('db:updateCourse', data),
  deleteCourse: (id) => ipcRenderer.invoke('db:deleteCourse', id),
  getTopics: (courseId) => ipcRenderer.invoke('db:getTopics', courseId),
  insertTopics: (data) => ipcRenderer.invoke('db:insertTopics', data),
  replaceTopics: (data) => ipcRenderer.invoke('db:replaceTopics', data),
  toggleTopic: (data) => ipcRenderer.invoke('db:toggleTopic', data),
  structureCourse: (data) => ipcRenderer.invoke('ai:structureCourse', data),
  getTasks: (filter) => ipcRenderer.invoke('db:getTasks', filter),
  createTask: (data) => ipcRenderer.invoke('db:createTask', data),
  bulkCreateStudyTasks: (data) => ipcRenderer.invoke('db:bulkCreateStudyTasks', data),
  updateTask: (data) => ipcRenderer.invoke('db:updateTask', data),
  completeTask: (data) => ipcRenderer.invoke('db:completeTask', data),
  deleteTask: (id) => ipcRenderer.invoke('db:deleteTask', id),
  deleteAllTasks: () => ipcRenderer.invoke('db:deleteAllTasks'),
  clearStudyLogs: () => ipcRenderer.invoke('db:clearStudyLogs'),
  clearQuizHistory: () => ipcRenderer.invoke('db:clearQuizHistory'),
  resetSectionProgress: () => ipcRenderer.invoke('db:resetSectionProgress'),
  freshStartStudy: () => ipcRenderer.invoke('db:freshStartStudy'),
  exportBackup: () => ipcRenderer.invoke('db:exportBackup'),
  importBackup: (backup) => ipcRenderer.invoke('db:importBackup', backup),
  deleteCourseTasks: (courseId) => ipcRenderer.invoke('db:deleteCourseTasks', courseId),
  getTaskStats: () => ipcRenderer.invoke('db:getTaskStats'),
  setCourseProgress: (data) => ipcRenderer.invoke('db:setCourseProgress', data),
  getStudyPlan: () => ipcRenderer.invoke('db:getStudyPlan'),
  generateStudyPlan: () => ipcRenderer.invoke('db:generateStudyPlan'),
  clearStudyPlan: () => ipcRenderer.invoke('db:clearStudyPlan'),
  getStudyPlanSettings: () => ipcRenderer.invoke('db:getStudyPlanSettings'),
  setStudyPlanSettings: (settings) => ipcRenderer.invoke('db:setStudyPlanSettings', settings),
  logStudy: (data) => ipcRenderer.invoke('db:logStudy', data),
  getStudyLog: () => ipcRenderer.invoke('db:getStudyLog'),
  getTotalHours: () => ipcRenderer.invoke('db:getTotalHours'),
  getStudyAnalytics: () => ipcRenderer.invoke('db:getStudyAnalytics'),
  getFixedEvents: () => ipcRenderer.invoke('db:getFixedEvents'),
  createFixedEvent: (event) => ipcRenderer.invoke('db:createFixedEvent', event),
  updateFixedEvent: (data) => ipcRenderer.invoke('db:updateFixedEvent', data),
  deleteFixedEvent: (id) => ipcRenderer.invoke('db:deleteFixedEvent', id),
  getScheduleExceptions: () => ipcRenderer.invoke('db:getScheduleExceptions'),
  createScheduleException: (event) => ipcRenderer.invoke('db:createScheduleException', event),
  updateScheduleException: (data) => ipcRenderer.invoke('db:updateScheduleException', data),
  deleteScheduleException: (id) => ipcRenderer.invoke('db:deleteScheduleException', id),
  getOllamaStatus: () => ipcRenderer.invoke('ai:ollamaStatus'),
  analyzeStudyStats: (analytics) => ipcRenderer.invoke('ai:analyzeStudyStats', analytics),
  generateQuiz: (data) => ipcRenderer.invoke('ai:generateQuiz', data),
  saveQuiz: (data) => ipcRenderer.invoke('db:saveQuiz', data),
  getQuiz: (topicId) => ipcRenderer.invoke('db:getQuiz', topicId),
  recordAnswer: (data) => ipcRenderer.invoke('db:recordAnswer', data),
  getSetting: (key) => ipcRenderer.invoke('db:getSetting', key),
  setSetting: (key, value) => ipcRenderer.invoke('db:setSetting', { key, value }),
  checkUpdate: () => ipcRenderer.invoke('updater:check'),
  installUpdate: () => ipcRenderer.invoke('updater:install'),
  onUpdateStatus: (cb) => ipcRenderer.on('updater:status', (_, msg) => cb(msg))
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (e) {
    console.error(e)
  }
} else {
  window.electron = electronAPI
  window.api = api
}
