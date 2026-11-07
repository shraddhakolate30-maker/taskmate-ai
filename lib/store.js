'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DATA_DIR = process.env.TASKMATE_DATA_DIR
  ? path.resolve(process.env.TASKMATE_DATA_DIR)
  : path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'tasks.json');

const STATUSES = ['pending', 'in_progress', 'completed', 'blocked'];
const EFFORTS = ['S', 'M', 'L'];

function todayISO() {
  return toISODate(new Date());
}

function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function shiftDays(days) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function cleanText(value, max) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

function cleanMultiline(value, max) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max);
}

function normalizeSubtasks(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((step) => {
      if (typeof step === 'string') {
        return { id: crypto.randomUUID(), title: cleanText(step, 200), done: false };
      }
      if (!step || typeof step !== 'object') return null;
      const title = cleanText(step.title, 200);
      if (!title) return null;
      return {
        id: typeof step.id === 'string' && step.id ? step.id : crypto.randomUUID(),
        title,
        done: Boolean(step.done)
      };
    })
    .filter(Boolean)
    .slice(0, 30);
}

function normalizeTask(input, existing, touch = true) {
  const base = existing || {};
  const now = new Date().toISOString();

  const status = STATUSES.includes(input.status) ? input.status : base.status || 'pending';
  const importance = clamp(Number.parseInt(input.importance, 10) || base.importance || 3, 1, 5);
  const effort = EFFORTS.includes(input.effort) ? input.effort : base.effort || 'M';

  let dueDate = input.dueDate === undefined ? base.dueDate || null : input.dueDate;
  if (dueDate !== null && dueDate !== '') {
    dueDate = String(dueDate).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) dueDate = null;
  } else {
    dueDate = null;
  }

  const subtasks =
    input.subtasks === undefined ? base.subtasks || [] : normalizeSubtasks(input.subtasks);

  const task = {
    id: base.id || crypto.randomUUID(),
    title: cleanText(input.title === undefined ? base.title : input.title, 140),
    description: cleanMultiline(
      input.description === undefined ? base.description : input.description,
      2000
    ),
    dueDate,
    importance,
    effort,
    status,
    blockedReason: cleanText(
      input.blockedReason === undefined ? base.blockedReason : input.blockedReason,
      300
    ),
    subtasks,
    createdAt: base.createdAt || now,
    updatedAt: touch ? now : base.updatedAt || now,
    completedAt: base.completedAt || null
  };

  if (status === 'completed') {
    task.completedAt = task.completedAt || now;
  } else {
    task.completedAt = null;
    task.blockedReason = status === 'blocked' ? task.blockedReason : '';
  }

  return task;
}

function seedTasks() {
  const now = new Date().toISOString();
  const make = (task) => normalizeTask({ ...task, createdAt: now, updatedAt: now });
  return [
    make({
      title: 'Build and test TaskMate AI MVP',
      description:
        'Build the web app, task management, AI prioritization, dashboard and test the application.',
      dueDate: shiftDays(0),
      importance: 5,
      effort: 'L',
      status: 'completed',
      subtasks: [
        { title: 'Build task management and statuses', done: true },
        { title: 'Add AI prioritization and step breakdown', done: true },
        { title: 'Build the progress dashboard', done: true },
        { title: 'Test the application end to end', done: true }
      ]
    }),
    make({
      title: 'Review and finalize project README',
      description: 'Explain features, architecture, setup, technologies and Switch integration.',
      dueDate: shiftDays(0),
      importance: 5,
      effort: 'M',
      status: 'pending',
      subtasks: [
        { title: 'Outline features and architecture', done: false },
        { title: 'Write setup and usage steps', done: false },
        { title: 'Document the Switch integration', done: false },
        { title: 'Proofread and finalize', done: false }
      ]
    }),
    make({
      title: 'Capture screenshots and record project demo',
      description: 'Prepare desktop/mobile screenshots and a 60-90 second walkthrough.',
      dueDate: shiftDays(0),
      importance: 5,
      effort: 'M',
      status: 'pending',
      subtasks: [
        { title: 'Capture desktop screenshots', done: false },
        { title: 'Capture mobile screenshots', done: false },
        { title: 'Record the 60-90 second walkthrough', done: false },
        { title: 'Review the demo for clarity', done: false }
      ]
    }),
    make({
      title: 'Publish project to GitHub',
      description: 'Create repository and upload the source code with README.',
      dueDate: shiftDays(0),
      importance: 4,
      effort: 'S',
      status: 'pending',
      subtasks: [
        { title: 'Create the repository', done: false },
        { title: 'Add README and .gitignore', done: false },
        { title: 'Push the source code', done: false },
        { title: 'Verify the repository links', done: false }
      ]
    }),
    make({
      title: 'Complete hackathon submission',
      description:
        'Prepare submission description, verify all links and submit before 7 November 2026, 11:59 PM IST.',
      dueDate: shiftDays(0),
      importance: 5,
      effort: 'M',
      status: 'pending',
      subtasks: [
        { title: 'Write the submission description', done: false },
        { title: 'Verify the demo and repository links', done: false },
        { title: 'Submit before 11:59 PM IST', done: false }
      ]
    })
  ];
}

function ensureFile() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    writeAll(seedTasks());
  }
}

function readAll() {
  ensureFile();
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((task) => normalizeTask(task, task, false));
  } catch (error) {
    console.error('Could not read tasks file, starting empty:', error.message);
    return [];
  }
}

function writeAll(tasks) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const temp = `${DATA_FILE}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(tasks, null, 2), 'utf8');
  fs.renameSync(temp, DATA_FILE);
}

function listTasks() {
  return readAll();
}

function getTask(id) {
  return readAll().find((task) => task.id === id) || null;
}

function createTask(input) {
  const tasks = readAll();
  const task = normalizeTask(input, {});
  if (!task.title) {
    const error = new Error('A task title is required.');
    error.statusCode = 400;
    throw error;
  }
  tasks.push(task);
  writeAll(tasks);
  return task;
}

function updateTask(id, changes) {
  const tasks = readAll();
  const index = tasks.findIndex((task) => task.id === id);
  if (index === -1) return null;
  const merged = normalizeTask({ ...tasks[index], ...changes }, tasks[index]);
  if (!merged.title) {
    const error = new Error('A task title is required.');
    error.statusCode = 400;
    throw error;
  }
  tasks[index] = merged;
  writeAll(tasks);
  return merged;
}

function deleteTask(id) {
  const tasks = readAll();
  const next = tasks.filter((task) => task.id !== id);
  if (next.length === tasks.length) return false;
  writeAll(next);
  return true;
}

function replaceSubtasks(id, subtasks) {
  return updateTask(id, { subtasks });
}

module.exports = {
  DATA_FILE,
  STATUSES,
  EFFORTS,
  todayISO,
  toISODate,
  listTasks,
  getTask,
  createTask,
  updateTask,
  deleteTask,
  replaceSubtasks,
  normalizeSubtasks,
  seedTasks
};
