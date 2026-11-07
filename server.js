'use strict';

const path = require('node:path');
const express = require('express');
const store = require('./lib/store');
const priority = require('./lib/priority');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';

app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

function asHandler(fn) {
  return (req, res, next) => {
    try {
      fn(req, res, next);
    } catch (error) {
      next(error);
    }
  };
}

function notFound(message) {
  const error = new Error(message);
  error.statusCode = 404;
  return error;
}

function sortTasks(tasks, sort) {
  const list = [...tasks];
  switch (sort) {
    case 'due':
      return list.sort((a, b) => {
        if (!a.dueDate && !b.dueDate) return a.title.localeCompare(b.title);
        if (!a.dueDate) return 1;
        if (!b.dueDate) return -1;
        return a.dueDate.localeCompare(b.dueDate);
      });
    case 'created':
      return list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    case 'importance':
      return list.sort((a, b) => b.importance - a.importance);
    case 'priority':
    default:
      return list.sort((a, b) => {
        if (a.status === 'completed' && b.status !== 'completed') return 1;
        if (b.status === 'completed' && a.status !== 'completed') return -1;
        return b.priority.score - a.priority.score;
      });
  }
}

app.get(
  '/api/health',
  asHandler((req, res) => {
    res.json({ ok: true, app: 'TaskMate AI', version: '1.0.0', time: new Date().toISOString() });
  })
);

app.get(
  '/api/tasks',
  asHandler((req, res) => {
    const status = String(req.query.status || 'all');
    const query = String(req.query.q || '').trim().toLowerCase();

    let tasks = store.listTasks().map(priority.withPriority);

    if (['pending', 'in_progress', 'completed', 'blocked'].includes(status)) {
      tasks = tasks.filter((task) => task.status === status);
    }
    if (query) {
      tasks = tasks.filter(
        (task) =>
          task.title.toLowerCase().includes(query) ||
          task.description.toLowerCase().includes(query) ||
          (task.blockedReason || '').toLowerCase().includes(query)
      );
    }

    tasks = sortTasks(tasks, String(req.query.sort || 'priority'));
    res.json({ tasks, count: tasks.length });
  })
);

app.get(
  '/api/tasks/:id',
  asHandler((req, res) => {
    const task = store.getTask(req.params.id);
    if (!task) throw notFound('Task not found.');
    res.json({ task: priority.withPriority(task) });
  })
);

app.post(
  '/api/tasks',
  asHandler((req, res) => {
    const body = req.body || {};
    const input = {
      title: body.title,
      description: body.description,
      dueDate: body.dueDate,
      importance: body.importance,
      effort: body.effort,
      status: body.status,
      blockedReason: body.blockedReason
    };

    const providedSteps = Array.isArray(body.subtasks) ? body.subtasks.filter(Boolean) : [];
    if (providedSteps.length) {
      input.subtasks = providedSteps;
    } else if (body.autoSteps !== false) {
      input.subtasks = priority.generateSteps({
        title: input.title || '',
        description: input.description || '',
        status: input.status || 'pending',
        effort: input.effort || 'M',
        blockedReason: input.blockedReason || ''
      });
    } else {
      input.subtasks = [];
    }

    const task = store.createTask(input);
    res.status(201).json({ task: priority.withPriority(task) });
  })
);

app.patch(
  '/api/tasks/:id',
  asHandler((req, res) => {
    const allowed = [
      'title',
      'description',
      'dueDate',
      'importance',
      'effort',
      'status',
      'blockedReason',
      'subtasks'
    ];
    const changes = {};
    for (const key of allowed) {
      if (req.body && Object.prototype.hasOwnProperty.call(req.body, key)) {
        changes[key] = req.body[key];
      }
    }

    const task = store.updateTask(req.params.id, changes);
    if (!task) throw notFound('Task not found.');
    res.json({ task: priority.withPriority(task) });
  })
);

app.delete(
  '/api/tasks/:id',
  asHandler((req, res) => {
    const removed = store.deleteTask(req.params.id);
    if (!removed) throw notFound('Task not found.');
    res.json({ ok: true });
  })
);

app.post(
  '/api/suggest-steps',
  asHandler((req, res) => {
    const body = req.body || {};
    const steps = priority.generateSteps({
      title: body.title || '',
      description: body.description || '',
      status: body.status || 'pending',
      effort: body.effort || 'M',
      blockedReason: body.blockedReason || ''
    });
    res.json({ steps });
  })
);

app.post(
  '/api/tasks/:id/steps/suggest',
  asHandler((req, res) => {
    const task = store.getTask(req.params.id);
    if (!task) throw notFound('Task not found.');

    const mode = String(req.query.mode || 'replace');
    const suggested = priority.generateSteps(task);

    let subtasks;
    if (mode === 'append') {
      subtasks = [...task.subtasks, ...suggested];
    } else {
      subtasks = suggested;
    }

    const updated = store.updateTask(task.id, { subtasks });
    res.json({ task: priority.withPriority(updated) });
  })
);

app.post(
  '/api/tasks/:id/steps',
  asHandler((req, res) => {
    const title = String((req.body && req.body.title) || '').trim();
    if (!title) {
      const error = new Error('A step title is required.');
      error.statusCode = 400;
      throw error;
    }
    const task = store.getTask(req.params.id);
    if (!task) throw notFound('Task not found.');
    const subtasks = [...task.subtasks, { title }];
    const updated = store.updateTask(task.id, { subtasks });
    res.status(201).json({ task: priority.withPriority(updated) });
  })
);

app.patch(
  '/api/tasks/:id/steps/:stepId',
  asHandler((req, res) => {
    const task = store.getTask(req.params.id);
    if (!task) throw notFound('Task not found.');

    const step = task.subtasks.find((item) => item.id === req.params.stepId);
    if (!step) throw notFound('Step not found.');

    const subtasks = task.subtasks.map((item) =>
      item.id === step.id ? { ...item, done: Boolean(req.body && req.body.done) } : item
    );
    const updated = store.updateTask(task.id, { subtasks });
    res.json({ task: priority.withPriority(updated) });
  })
);

app.delete(
  '/api/tasks/:id/steps/:stepId',
  asHandler((req, res) => {
    const task = store.getTask(req.params.id);
    if (!task) throw notFound('Task not found.');
    const subtasks = task.subtasks.filter((item) => item.id !== req.params.stepId);
    if (subtasks.length === task.subtasks.length) throw notFound('Step not found.');
    const updated = store.updateTask(task.id, { subtasks });
    res.json({ task: priority.withPriority(updated) });
  })
);

app.get(
  '/api/dashboard',
  asHandler((req, res) => {
    const tasks = store.listTasks().map(priority.withPriority);
    const total = tasks.length;
    const counts = { pending: 0, in_progress: 0, completed: 0, blocked: 0 };
    for (const task of tasks) counts[task.status] += 1;

    const overdue = tasks.filter((task) => task.overdue);
    const dueToday = tasks.filter(
      (task) => task.status !== 'completed' && task.daysUntilDue === 0
    );
    const highPriority = tasks.filter(
      (task) => task.status !== 'completed' && task.priority.level === 'high'
    );

    const active = tasks.filter((task) => task.status !== 'completed');
    const completionRate = total === 0 ? 0 : Math.round((counts.completed / total) * 100);
    const averagePriority =
      active.length === 0
        ? 0
        : Math.round(active.reduce((sum, task) => sum + task.priority.score, 0) / active.length);

    res.json({
      total,
      counts,
      completionRate,
      averagePriority,
      overdue: overdue.length,
      overdueTasks: overdue.map((task) => ({ id: task.id, title: task.title, dueDate: task.dueDate })),
      dueToday: dueToday.length,
      dueTodayTasks: dueToday.map((task) => ({ id: task.id, title: task.title })),
      highPriority: highPriority.length,
      topPriorities: active
        .sort((a, b) => b.priority.score - a.priority.score)
        .slice(0, 5)
        .map((task) => ({
          id: task.id,
          title: task.title,
          score: task.priority.score,
          level: task.priority.level,
          nextAction: task.priority.nextAction
        }))
    });
  })
);

app.get(
  '/api/digest',
  asHandler((req, res) => {
    const tasks = store.listTasks();
    const text = priority.buildDigest(tasks);
    if (String(req.query.format || 'json') === 'text') {
      res.type('text/plain').send(text);
      return;
    }
    res.json({ digest: text });
  })
);

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'API route not found.' });
});

app.use((error, req, res, next) => {
  const status = error.statusCode || 500;
  if (status >= 500) console.error(error);
  res.status(status).json({ error: error.message || 'Something went wrong.' });
});

function start(port, attemptsLeft) {
  const server = app.listen(port, HOST, () => {
    console.log('');
    console.log('  TaskMate AI is running');
    console.log(`  Open http://${HOST}:${port}`);
    console.log('  Press Ctrl+C to stop.');
    console.log('');
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE' && attemptsLeft > 0) {
      console.warn(`Port ${port} is busy, trying ${port + 1}...`);
      start(port + 1, attemptsLeft - 1);
      return;
    }
    console.error('Could not start TaskMate AI:', error.message);
    process.exit(1);
  });
}

if (require.main === module) {
  start(PORT, 10);
}

module.exports = app;
