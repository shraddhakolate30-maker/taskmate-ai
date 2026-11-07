'use strict';

const { todayISO } = require('./store');

const DAY_MS = 24 * 60 * 60 * 1000;

function daysUntil(dueDate) {
  if (!dueDate) return null;
  const today = todayISO();
  const start = new Date(`${today}T00:00:00`);
  const end = new Date(`${dueDate}T00:00:00`);
  if (Number.isNaN(end.getTime())) return null;
  return Math.round((end - start) / DAY_MS);
}

function isOverdue(task) {
  if (!task || task.status === 'completed' || !task.dueDate) return false;
  const days = daysUntil(task.dueDate);
  return days !== null && days < 0;
}

function urgencyPoints(task) {
  const days = daysUntil(task.dueDate);
  if (days === null) return { points: 4, reason: 'No deadline set' };
  if (days < 0) {
    return { points: 42, reason: `Overdue by ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'}` };
  }
  if (days === 0) return { points: 36, reason: 'Due today' };
  if (days === 1) return { points: 30, reason: 'Due tomorrow' };
  if (days <= 3) return { points: 23, reason: `Due in ${days} days` };
  if (days <= 7) return { points: 15, reason: `Due in ${days} days` };
  if (days <= 14) return { points: 8, reason: `Due in ${days} days` };
  return { points: 3, reason: `Due in ${days} days` };
}

function agePoints(task) {
  const created = new Date(task.createdAt || Date.now()).getTime();
  if (Number.isNaN(created)) return 0;
  const ageDays = Math.floor((Date.now() - created) / DAY_MS);
  if (ageDays <= 0) return 0;
  return Math.min(8, ageDays);
}

function stepProgress(task) {
  const steps = Array.isArray(task.subtasks) ? task.subtasks : [];
  const total = steps.length;
  const done = steps.filter((step) => step.done).length;
  return { total, done, ratio: total === 0 ? 0 : done / total };
}

function computePriority(task, now = Date.now()) {
  if (!task || task.status === 'completed') {
    return { score: 0, level: 'done', reasons: ['Completed'], nextAction: 'Nothing - it is done.' };
  }

  const reasons = [];
  let score = 0;

  const urgency = urgencyPoints(task);
  score += urgency.points;
  reasons.push(urgency.reason);

  const importancePoints = (task.importance - 1) * 7;
  score += importancePoints;
  reasons.push(`Importance ${task.importance}/5`);

  if (task.effort === 'S') {
    score += 5;
    reasons.push('Quick win (small effort)');
  } else if (task.effort === 'L') {
    score -= 3;
    reasons.push('Large effort');
  }

  if (task.status === 'blocked') {
    score += 8;
    reasons.push('Blocked - needs unblocking');
  } else if (task.status === 'in_progress') {
    score += 4;
    reasons.push('Already in progress');
  }

  const progress = stepProgress(task);
  if (progress.total > 0 && progress.ratio < 1) {
    score += Math.round(4 * (1 - progress.ratio));
  }

  score += agePoints(task);

  score = Math.max(0, Math.min(100, Math.round(score)));

  let level = 'low';
  if (score >= 65) level = 'high';
  else if (score >= 45) level = 'medium';

  return {
    score,
    level,
    reasons,
    nextAction: nextActionFor(task, urgency)
  };
}

function nextActionFor(task, urgency) {
  if (task.status === 'blocked') {
    return task.blockedReason
      ? `Unblock: ${task.blockedReason}`
      : 'Write down what is blocking this task.';
  }
  const steps = Array.isArray(task.subtasks) ? task.subtasks : [];
  const nextStep = steps.find((step) => !step.done);
  if (nextStep) return `Next step: ${nextStep.title}`;
  if (task.status === 'in_progress') return 'Finish it and mark it complete.';
  if (urgency.points >= 30) return 'Start this now.';
  return 'Schedule a time to start.';
}

function withPriority(task) {
  return {
    ...task,
    priority: computePriority(task),
    overdue: isOverdue(task),
    daysUntilDue: daysUntil(task.dueDate),
    stepProgress: stepProgress(task)
  };
}

const STEP_TEMPLATES = [
  {
    match: /write|readme|report|paper|blog|post|email|document|draft|submit|submission/i,
    steps: [
      'Collect the key points and notes',
      'Write a rough first draft',
      'Review and tighten the wording',
      'Final proofread and submit'
    ]
  },
  {
    match: /build|code|app|feature|implement|develop|bug|fix|test|deploy/i,
    steps: [
      'Write down the exact requirement',
      'Set up or locate the relevant files',
      'Implement the smallest working version',
      'Test it and fix what breaks',
      'Clean up and document the change'
    ]
  },
  {
    match: /learn|study|course|practice|research|understand/i,
    steps: [
      'List the specific topics to learn',
      'Do a short focused study session',
      'Apply it with a small hands-on exercise',
      'Summarise what you learned'
    ]
  },
  {
    match: /apply|form|register|submit|interview|resume|cv/i,
    steps: [
      'Gather the required details and documents',
      'Fill in the application',
      'Review everything before sending',
      'Submit and save the confirmation'
    ]
  },
  {
    match: /plan|schedule|organize|organise|review|prepare|event|meeting/i,
    steps: [
      'Define the goal and the deadline',
      'List everything that needs to happen',
      'Put the items in a sensible order',
      'Schedule the first block of work'
    ]
  },
  {
    match: /buy|order|shop|purchase|book|pay/i,
    steps: ['Confirm exactly what you need', 'Compare options and prices', 'Place the order', 'Save the confirmation']
  },
  {
    match: /clean|organize|organise|tidy|sort/i,
    steps: ['Pick one small starting area', 'Sort items into keep, move and remove', 'Put the keepers in their place']
  }
];

function generateSteps(task) {
  const title = (task.title || '').toLowerCase();
  const description = (task.description || '').toLowerCase();
  const haystack = `${title} ${description}`;

  const template = STEP_TEMPLATES.find((entry) => entry.match.test(haystack));

  let steps = template
    ? template.steps
    : [
        'Define what done looks like',
        'List the first three actions',
        'Do the first action for 15 minutes',
        'Review progress and adjust'
      ];

  if (task.effort === 'S') steps = steps.slice(0, 3);
  if (task.status === 'blocked' && task.blockedReason) {
    steps = [`Resolve the blocker: ${task.blockedReason}`, ...steps];
  }

  return steps.slice(0, 5).map((title) => ({ title }));
}

function buildDigest(tasks) {
  const enriched = tasks.map(withPriority);
  const counts = { pending: 0, in_progress: 0, completed: 0, blocked: 0 };
  for (const task of enriched) counts[task.status] += 1;

  const active = enriched
    .filter((task) => task.status !== 'completed')
    .sort((a, b) => b.priority.score - a.priority.score);

  const total = enriched.length;
  const completion = total === 0 ? 0 : Math.round((counts.completed / total) * 100);
  const overdue = enriched.filter((task) => task.overdue);
  const dueToday = active.filter((task) => task.daysUntilDue === 0);

  const lines = [];
  lines.push('**TaskMate AI - task update**');
  lines.push('');
  lines.push(
    `${total} tasks | ${counts.pending} pending | ${counts.in_progress} in progress | ${counts.completed} completed | ${counts.blocked} blocked`
  );
  lines.push(`Progress: ${completion}% complete`);
  if (overdue.length) lines.push(`Overdue: ${overdue.length}`);
  if (dueToday.length) lines.push(`Due today: ${dueToday.length}`);
  if (active.length) {
    lines.push('');
    lines.push('**Top priorities**');
    active.slice(0, 5).forEach((task, index) => {
      lines.push(
        `${index + 1}. ${task.title} - ${task.priority.level.toUpperCase()} (${task.priority.score}) - ${task.priority.nextAction}`
      );
    });
  }
  if (counts.blocked) {
    const blocked = enriched.filter((task) => task.status === 'blocked');
    lines.push('');
    lines.push('**Blocked**');
    blocked.forEach((task) => {
      lines.push(`- ${task.title}${task.blockedReason ? `: ${task.blockedReason}` : ''}`);
    });
  }
  lines.push('');
  lines.push('_Sent from TaskMate AI_');
  return lines.join('\n');
}

module.exports = {
  computePriority,
  withPriority,
  generateSteps,
  buildDigest,
  daysUntil,
  isOverdue,
  stepProgress
};
