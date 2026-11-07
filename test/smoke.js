'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskmate-test-'));
process.env.TASKMATE_DATA_DIR = tempDir;

const app = require('../server');

let passed = 0;
function check(label, condition, extra) {
  if (!condition) {
    console.error(`FAIL  ${label}${extra ? ` -> ${JSON.stringify(extra)}` : ''}`);
    process.exitCode = 1;
    return;
  }
  passed += 1;
  console.log(`ok    ${label}`);
}

async function main() {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  async function call(method, url, body) {
    const response = await fetch(`${base}${url}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const data = await response.json().catch(() => null);
    return { status: response.status, data };
  }

  try {
    const health = await call('GET', '/api/health');
    check('health endpoint responds', health.status === 200 && health.data.ok === true);

    const seeded = await call('GET', '/api/tasks');
    check('seed data loads', seeded.status === 200 && seeded.data.count === 5, seeded.data && seeded.data.count);
    check(
      'seed data includes completed and pending work',
      new Set(seeded.data.tasks.map((task) => task.status)).has('completed') &&
        new Set(seeded.data.tasks.map((task) => task.status)).has('pending')
    );
    check(
      'every task carries an AI priority',
      seeded.data.tasks.every((task) => typeof task.priority.score === 'number' && task.priority.level)
    );

    const dashboard = await call('GET', '/api/dashboard');
    check('dashboard totals add up', dashboard.status === 200 && dashboard.data.total === 5);
    check(
      'dashboard counts match the task list',
      ['pending', 'in_progress', 'completed', 'blocked'].every(
        (status) =>
          dashboard.data.counts[status] ===
          seeded.data.tasks.filter((task) => task.status === status).length
      )
    );
    check('dashboard exposes top priorities', dashboard.data.topPriorities.length > 0);

    const created = await call('POST', '/api/tasks', {
      title: 'Write launch email',
      description: 'Draft and send the announcement to the team list.',
      dueDate: new Date().toISOString().slice(0, 10),
      importance: 5,
      effort: 'S',
      status: 'pending'
    });
    check('create task returns 201', created.status === 201);
    const task = created.data.task;
    check('task is auto-split into steps', task.subtasks.length >= 3, task.subtasks.length);
    check('due-today high-importance task ranks high', task.priority.level === 'high', task.priority);

    const invalid = await call('POST', '/api/tasks', { title: '   ' });
    check('blank title is rejected', invalid.status === 400);

    const moved = await call('PATCH', `/api/tasks/${task.id}`, { status: 'in_progress' });
    check('status can move to in progress', moved.data.task.status === 'in_progress');

    const steps = moved.data.task.subtasks;
    const toggled = await call('PATCH', `/api/tasks/${task.id}/steps/${steps[0].id}`, { done: true });
    check('step can be completed', toggled.data.task.subtasks[0].done === true);
    check('step progress is reported', toggled.data.task.stepProgress.done === 1);

    const suggested = await call('POST', '/api/suggest-steps', {
      title: 'Fix the login page',
      effort: 'M',
      status: 'pending'
    });
    check('suggest-steps returns steps', suggested.status === 200 && suggested.data.steps.length >= 3);

    const blocked = await call('PATCH', `/api/tasks/${task.id}`, {
      status: 'blocked',
      blockedReason: 'Waiting on designer'
    });
    check('blocked status stores a reason', blocked.data.task.blockedReason === 'Waiting on designer');

    const filtered = await call('GET', '/api/tasks?status=blocked');
    check(
      'status filter works',
      filtered.data.tasks.every((item) => item.status === 'blocked') && filtered.data.count >= 1
    );

    const parsed = await call('GET', '/api/digest?format=text');
    check('digest is generated', parsed.status === 200);

    const deleted = await call('DELETE', `/api/tasks/${task.id}`);
    check('task can be deleted', deleted.status === 200 && deleted.data.ok === true);

    const missing = await call('GET', `/api/tasks/${task.id}`);
    check('deleted task is gone', missing.status === 404);

    const page = await fetch(`${base}/`);
    const html = await page.text();
    check('frontend is served', page.status === 200 && html.includes('TaskMate AI'));

    check('data file is written to disk', fs.existsSync(path.join(tempDir, 'tasks.json')));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  console.log(`\n${passed} checks passed`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
