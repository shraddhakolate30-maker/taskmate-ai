'use strict';

const state = {
  tasks: [],
  dashboard: null,
  status: 'all',
  query: '',
  sort: 'priority',
  open: new Set(),
  editingId: null,
  draftSteps: []
};

const el = {
  heroHeadline: document.getElementById('heroHeadline'),
  heroSubtitle: document.getElementById('heroSubtitle'),
  heroBar: document.getElementById('heroBar'),
  heroPercent: document.getElementById('heroPercent'),
  overdueFlag: document.getElementById('overdueFlag'),
  todayFlag: document.getElementById('todayFlag'),
  highFlag: document.getElementById('highFlag'),
  statTotal: document.getElementById('statTotal'),
  statPending: document.getElementById('statPending'),
  statProgress: document.getElementById('statProgress'),
  statDone: document.getElementById('statDone'),
  statBlocked: document.getElementById('statBlocked'),
  priorityList: document.getElementById('priorityList'),
  taskGrid: document.getElementById('taskGrid'),
  emptyState: document.getElementById('emptyState'),
  taskCount: document.getElementById('taskCount'),
  searchInput: document.getElementById('searchInput'),
  filterChips: document.getElementById('filterChips'),
  sortSelect: document.getElementById('sortSelect'),
  newTaskBtn: document.getElementById('newTaskBtn'),
  roomUpdateBtn: document.getElementById('roomUpdateBtn'),
  emptyNewBtn: document.getElementById('emptyNewBtn'),
  taskModal: document.getElementById('taskModal'),
  taskModalTitle: document.getElementById('taskModalTitle'),
  modalClose: document.getElementById('modalClose'),
  cancelBtn: document.getElementById('cancelBtn'),
  taskForm: document.getElementById('taskForm'),
  taskId: document.getElementById('taskId'),
  titleInput: document.getElementById('titleInput'),
  descInput: document.getElementById('descInput'),
  dueInput: document.getElementById('dueInput'),
  statusInput: document.getElementById('statusInput'),
  importanceInput: document.getElementById('importanceInput'),
  importanceValue: document.getElementById('importanceValue'),
  effortInput: document.getElementById('effortInput'),
  blockedWrap: document.getElementById('blockedWrap'),
  blockedInput: document.getElementById('blockedInput'),
  stepEditor: document.getElementById('stepEditor'),
  newStepInput: document.getElementById('newStepInput'),
  addStepBtn: document.getElementById('addStepBtn'),
  suggestStepsBtn: document.getElementById('suggestStepsBtn'),
  saveBtn: document.getElementById('saveBtn'),
  digestModal: document.getElementById('digestModal'),
  digestClose: document.getElementById('digestClose'),
  digestCloseBtn: document.getElementById('digestCloseBtn'),
  digestText: document.getElementById('digestText'),
  copyDigestBtn: document.getElementById('copyDigestBtn'),
  toasts: document.getElementById('toasts'),
  footerStamp: document.getElementById('footerStamp')
};

const LEVEL_LABEL = { high: 'High', medium: 'Medium', low: 'Low', done: 'Done' };

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(iso) {
  if (!iso) return '';
  const parts = iso.split('-').map(Number);
  if (parts.length !== 3) return iso;
  const date = new Date(parts[0], parts[1] - 1, parts[2]);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function dueLabel(task) {
  const days = task.daysUntilDue;
  if (days === null || days === undefined) return 'No due date';
  if (days < 0) return `Overdue by ${Math.abs(days)}d`;
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  if (days <= 7) return `Due in ${days}d`;
  return `Due ${formatDate(task.dueDate)}`;
}

async function api(path, options = {}) {
  const config = { headers: { 'Content-Type': 'application/json' }, ...options };
  const response = await fetch(path, config);
  let data = null;
  try {
    data = await response.json();
  } catch (error) {
    data = null;
  }
  if (!response.ok) {
    const message = (data && data.error) || `Request failed (${response.status})`;
    throw new Error(message);
  }
  return data;
}

function showToast(message, type = 'info') {
  const node = document.createElement('div');
  node.className = `toast${type === 'error' ? ' is-error' : type === 'success' ? ' is-success' : ''}`;
  node.textContent = message;
  el.toasts.appendChild(node);
  setTimeout(() => {
    node.style.opacity = '0';
    node.style.transform = 'translateY(6px)';
    node.style.transition = 'all 0.25s ease';
    setTimeout(() => node.remove(), 260);
  }, 3200);
}

/* ---------------- Data loading ---------------- */

async function load() {
  const params = new URLSearchParams();
  if (state.status !== 'all') params.set('status', state.status);
  if (state.query) params.set('q', state.query);
  params.set('sort', state.sort);

  try {
    const [taskData, dashboard] = await Promise.all([
      api(`/api/tasks?${params.toString()}`),
      api('/api/dashboard')
    ]);
    state.tasks = taskData.tasks;
    state.dashboard = dashboard;
    render();
  } catch (error) {
    showToast(error.message, 'error');
  }
}

/* ---------------- Rendering ---------------- */

function render() {
  renderDashboard();
  renderPriorities();
  renderTasks();
  el.taskCount.textContent = `${state.tasks.length} task${state.tasks.length === 1 ? '' : 's'}`;
  el.footerStamp.textContent = `Updated ${new Date().toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit'
  })}`;
}

function renderDashboard() {
  const d = state.dashboard;
  if (!d) return;

  el.statTotal.textContent = d.total;
  el.statPending.textContent = d.counts.pending;
  el.statProgress.textContent = d.counts.in_progress;
  el.statDone.textContent = d.counts.completed;
  el.statBlocked.textContent = d.counts.blocked;

  el.heroBar.style.width = `${d.completionRate}%`;
  el.heroPercent.textContent = `${d.completionRate}%`;
  el.overdueFlag.textContent = `${d.overdue} overdue`;
  el.todayFlag.textContent = `${d.dueToday} due today`;
  el.highFlag.textContent = `${d.highPriority} high priority`;

  el.overdueFlag.style.display = d.overdue ? '' : 'none';
  el.todayFlag.style.display = d.dueToday ? '' : 'none';

  if (d.total === 0) {
    el.heroHeadline.textContent = 'A clean slate';
    el.heroSubtitle.textContent = 'Add your first task and TaskMate AI will rank it and split it into steps.';
    return;
  }

  if (d.overdue > 0) {
    el.heroHeadline.textContent = `${d.overdue} task${d.overdue === 1 ? '' : 's'} overdue - start there`;
    el.heroSubtitle.textContent = `${d.dueToday} due today and ${d.highPriority} high-priority items on your list. Clear the oldest fire first.`;
  } else if (d.dueToday > 0) {
    el.heroHeadline.textContent = `${d.dueToday} task${d.dueToday === 1 ? '' : 's'} due today`;
    el.heroSubtitle.textContent = `${d.counts.in_progress} in progress, ${d.counts.pending} waiting. Finish something before starting something new.`;
  } else if (d.highPriority > 0) {
    el.heroHeadline.textContent = `${d.highPriority} high-priority task${d.highPriority === 1 ? '' : 's'} need attention`;
    el.heroSubtitle.textContent = 'No overdue work. Keep the momentum with your top-ranked item.';
  } else if (d.counts.blocked > 0) {
    el.heroHeadline.textContent = `${d.counts.blocked} task${d.counts.blocked === 1 ? '' : 's'} blocked`;
    el.heroSubtitle.textContent = 'Unblocking work is the fastest way to move your progress bar.';
  } else {
    el.heroHeadline.textContent = 'You are on top of things';
    el.heroSubtitle.textContent = `${d.completionRate}% complete. Pick the next item from your ranked list.`;
  }
}

function renderPriorities() {
  const d = state.dashboard;
  if (!d || !d.topPriorities || d.topPriorities.length === 0) {
    el.priorityList.innerHTML =
      '<div class="priority-card"><div class="rank">Nothing ranked</div><h3>All caught up</h3><div class="priority-meta"><span>Completed tasks are not ranked</span></div></div>';
    return;
  }

  el.priorityList.innerHTML = d.topPriorities
    .map(
      (task, index) => `
      <article class="priority-card" data-focus="${task.id}" tabindex="0" role="button" aria-label="Open ${escapeHtml(task.title)}">
        <div class="rank">#${index + 1} ${escapeHtml(LEVEL_LABEL[task.level] || '')}</div>
        <h3>${escapeHtml(task.title)}</h3>
        <div class="priority-meta">
          <span>AI score ${task.score}/100</span>
          <span>${task.level === 'high' ? 'Do first' : task.level === 'medium' ? 'Schedule it' : 'Later'}</span>
        </div>
        <div class="score-track"><span style="width:${task.score}%"></span></div>
        <div class="next-action">${escapeHtml(task.nextAction)}</div>
      </article>`
    )
    .join('');
}

function priorityBadge(task) {
  if (task.status === 'completed') {
    return '<span class="badge badge-done">Completed</span>';
  }
  const level = task.priority.level;
  return `<span class="badge badge-${level}">${LEVEL_LABEL[level]} - ${task.priority.score}</span>`;
}

function renderTasks() {
  if (!state.tasks.length) {
    el.taskGrid.innerHTML = '';
    el.emptyState.hidden = false;
    return;
  }
  el.emptyState.hidden = true;

  el.taskGrid.innerHTML = state.tasks.map(taskCard).join('');
}

function taskCard(task) {
  const isOpen = state.open.has(task.id);
  const total = task.subtasks.length;
  const done = task.subtasks.filter((step) => step.done).length;
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);

  const badges = [priorityBadge(task)];

  if (task.overdue) {
    badges.push(`<span class="badge badge-overdue">${escapeHtml(dueLabel(task))}</span>`);
  } else if (task.dueDate) {
    badges.push(`<span class="badge badge-due">${escapeHtml(dueLabel(task))}</span>`);
  } else {
    badges.push('<span class="badge badge-neutral">No due date</span>');
  }

  if (task.status === 'blocked') {
    badges.push('<span class="badge badge-blocked">Blocked</span>');
  }

  badges.push(`<span class="badge badge-neutral">Importance ${task.importance}/5</span>`);

  const stepsMarkup =
    total === 0
      ? '<p class="step-empty">No steps yet. Use edit to add some.</p>'
      : `<ul class="step-list"${isOpen ? '' : ' hidden'}>
          ${task.subtasks
            .map(
              (step) => `
            <li class="step-item${step.done ? ' is-done' : ''}">
              <input type="checkbox" data-step-id="${step.id}" ${step.done ? 'checked' : ''} aria-label="Toggle step" />
              <span>${escapeHtml(step.title)}</span>
            </li>`
            )
            .join('')}
        </ul>`;

  const blockedLine =
    task.status === 'blocked' && task.blockedReason
      ? `<div class="next-line" title="${escapeHtml(task.blockedReason)}">Blocker: ${escapeHtml(task.blockedReason)}</div>`
      : '';

  return `
    <article class="task-card${task.status === 'completed' ? ' is-completed' : ''}${isOpen ? ' is-open' : ''}"
      data-id="${task.id}" data-priority="${task.priority.level}">
      <div class="task-top">
        <h3 class="task-title">${escapeHtml(task.title)}</h3>
        <div class="task-actions">
          <button class="icon-btn" data-action="edit" title="Edit task" aria-label="Edit task">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg>
          </button>
          <button class="icon-btn danger" data-action="delete" title="Delete task" aria-label="Delete task">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>
          </button>
        </div>
      </div>
      ${task.description ? `<p class="task-desc">${escapeHtml(task.description)}</p>` : ''}
      <div class="badge-row">${badges.join('')}</div>
      <div class="card-foot">
        <select class="status-select" data-action="status" data-status="${task.status}" aria-label="Task status">
          <option value="pending"${task.status === 'pending' ? ' selected' : ''}>Pending</option>
          <option value="in_progress"${task.status === 'in_progress' ? ' selected' : ''}>In progress</option>
          <option value="completed"${task.status === 'completed' ? ' selected' : ''}>Completed</option>
          <option value="blocked"${task.status === 'blocked' ? ' selected' : ''}>Blocked</option>
        </select>
        ${blockedLine || `<span class="next-line" title="${escapeHtml(task.priority.nextAction)}">${escapeHtml(task.priority.nextAction)}</span>`}
      </div>
      <div class="steps-block">
        <button class="steps-summary" data-action="toggle-steps" aria-expanded="${isOpen}">
          <span>Steps ${done}/${total}</span>
          <span class="chevron">&gt;</span>
        </button>
        <div class="mini-track"><span style="width:${percent}%"></span></div>
        ${stepsMarkup}
      </div>
    </article>`;
}

/* ---------------- Task modal ---------------- */

function openTaskModal(task) {
  state.editingId = task ? task.id : null;
  state.draftSteps = task ? task.subtasks.map((step) => ({ ...step })) : [];

  el.taskModalTitle.textContent = task ? 'Edit task' : 'New task';
  el.taskId.value = task ? task.id : '';
  el.titleInput.value = task ? task.title : '';
  el.descInput.value = task ? task.description : '';
  el.dueInput.value = task && task.dueDate ? task.dueDate : '';
  el.statusInput.value = task ? task.status : 'pending';
  el.importanceInput.value = task ? task.importance : 3;
  el.importanceValue.textContent = `${el.importanceInput.value}/5`;
  el.effortInput.value = task ? task.effort : 'M';
  el.blockedInput.value = task ? task.blockedReason || '' : '';
  el.blockedWrap.hidden = el.statusInput.value !== 'blocked';
  renderStepEditor();

  el.taskModal.hidden = false;
  setTimeout(() => el.titleInput.focus(), 30);
}

function closeTaskModal() {
  el.taskModal.hidden = true;
  state.editingId = null;
  state.draftSteps = [];
}

function renderStepEditor() {
  if (!state.draftSteps.length) {
    el.stepEditor.innerHTML = '<li class="step-editor-empty">No steps yet - TaskMate AI will suggest some.</li>';
    return;
  }
  el.stepEditor.innerHTML = state.draftSteps
    .map(
      (step, index) => `
      <li>
        <input type="checkbox" data-draft-step="${index}" ${step.done ? 'checked' : ''} aria-label="Toggle step" />
        <span>${escapeHtml(step.title)}</span>
        <button type="button" class="icon-btn danger" data-remove-step="${index}" aria-label="Remove step">x</button>
      </li>`
    )
    .join('');
}

function addDraftStep(title) {
  const value = String(title || '').trim();
  if (!value) return;
  state.draftSteps.push({ title: value.slice(0, 200), done: false });
  renderStepEditor();
}

function collectForm() {
  return {
    title: el.titleInput.value.trim(),
    description: el.descInput.value.trim(),
    dueDate: el.dueInput.value || null,
    status: el.statusInput.value,
    importance: Number(el.importanceInput.value),
    effort: el.effortInput.value,
    blockedReason: el.statusInput.value === 'blocked' ? el.blockedInput.value.trim() : '',
    subtasks: state.draftSteps.map((step) => ({ title: step.title, done: Boolean(step.done) }))
  };
}

async function saveTask(event) {
  event.preventDefault();
  const payload = collectForm();
  if (!payload.title) {
    showToast('Please add a task title.', 'error');
    el.titleInput.focus();
    return;
  }

  el.saveBtn.disabled = true;
  try {
    if (state.editingId) {
      await api(`/api/tasks/${state.editingId}`, {
        method: 'PATCH',
        body: JSON.stringify(payload)
      });
      showToast('Task updated.', 'success');
    } else {
      await api('/api/tasks', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      showToast('Task added and ranked.', 'success');
    }
    closeTaskModal();
    await load();
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    el.saveBtn.disabled = false;
  }
}

async function suggestSteps() {
  const title = el.titleInput.value.trim();
  if (!title) {
    showToast('Add a title first, then I can suggest steps.', 'error');
    el.titleInput.focus();
    return;
  }
  el.suggestStepsBtn.disabled = true;
  try {
    const data = await api('/api/suggest-steps', {
      method: 'POST',
      body: JSON.stringify({
        title,
        description: el.descInput.value.trim(),
        effort: el.effortInput.value,
        status: el.statusInput.value,
        blockedReason: el.blockedInput.value.trim()
      })
    });
    state.draftSteps = data.steps.map((step) => ({ title: step.title, done: false }));
    renderStepEditor();
    showToast('Steps suggested - edit or remove any.', 'success');
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    el.suggestStepsBtn.disabled = false;
  }
}

/* ---------------- Task actions ---------------- */

async function updateStatus(id, status, currentTask) {
  let blockedReason = '';
  if (status === 'blocked') {
    blockedReason =
      (currentTask && currentTask.blockedReason) ||
      window.prompt('What is blocking this task? (optional)') ||
      '';
  }

  try {
    await api(`/api/tasks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status, blockedReason })
    });
    showToast(
      status === 'completed' ? 'Nice - task completed.' : 'Status updated.',
      status === 'completed' ? 'success' : 'info'
    );
    await load();
  } catch (error) {
    showToast(error.message, 'error');
    await load();
  }
}

async function toggleStep(taskId, stepId, done) {
  try {
    await api(`/api/tasks/${taskId}/steps/${stepId}`, {
      method: 'PATCH',
      body: JSON.stringify({ done })
    });
    await load();
  } catch (error) {
    showToast(error.message, 'error');
    await load();
  }
}

async function deleteTask(task) {
  const ok = window.confirm(`Delete "${task.title}"? This cannot be undone.`);
  if (!ok) return;
  try {
    await api(`/api/tasks/${task.id}`, { method: 'DELETE' });
    state.open.delete(task.id);
    showToast('Task deleted.', 'success');
    await load();
  } catch (error) {
    showToast(error.message, 'error');
  }
}

/* ---------------- Digest ---------------- */

async function openDigest() {
  try {
    const data = await api('/api/digest');
    el.digestText.value = data.digest;
    el.digestModal.hidden = false;
    setTimeout(() => el.digestText.focus(), 30);
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function copyDigest() {
  const text = el.digestText.value;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      el.digestText.select();
      document.execCommand('copy');
    }
    showToast('Copied - paste it into Mattermost or the Switch room.', 'success');
  } catch (error) {
    el.digestText.select();
    showToast('Press Ctrl+C to copy the selected text.', 'error');
  }
}

/* ---------------- Events ---------------- */

el.newTaskBtn.addEventListener('click', () => openTaskModal(null));
el.emptyNewBtn.addEventListener('click', () => openTaskModal(null));
el.roomUpdateBtn.addEventListener('click', openDigest);

el.modalClose.addEventListener('click', closeTaskModal);
el.cancelBtn.addEventListener('click', closeTaskModal);
el.taskForm.addEventListener('submit', saveTask);
el.suggestStepsBtn.addEventListener('click', suggestSteps);

el.addStepBtn.addEventListener('click', () => {
  addDraftStep(el.newStepInput.value);
  el.newStepInput.value = '';
  el.newStepInput.focus();
});

el.newStepInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    addDraftStep(el.newStepInput.value);
    el.newStepInput.value = '';
  }
});

el.stepEditor.addEventListener('click', (event) => {
  const remove = event.target.closest('[data-remove-step]');
  if (remove) {
    const index = Number(remove.getAttribute('data-remove-step'));
    state.draftSteps.splice(index, 1);
    renderStepEditor();
  }
});

el.stepEditor.addEventListener('change', (event) => {
  const index = event.target.getAttribute('data-draft-step');
  if (index !== null) {
    state.draftSteps[Number(index)].done = event.target.checked;
  }
});

el.statusInput.addEventListener('change', () => {
  el.blockedWrap.hidden = el.statusInput.value !== 'blocked';
});

el.importanceInput.addEventListener('input', () => {
  el.importanceValue.textContent = `${el.importanceInput.value}/5`;
});

el.digestClose.addEventListener('click', () => {
  el.digestModal.hidden = true;
});
el.digestCloseBtn.addEventListener('click', () => {
  el.digestModal.hidden = true;
});
el.copyDigestBtn.addEventListener('click', copyDigest);

el.taskModal.addEventListener('click', (event) => {
  if (event.target === el.taskModal) closeTaskModal();
});
el.digestModal.addEventListener('click', (event) => {
  if (event.target === el.digestModal) el.digestModal.hidden = true;
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (!el.taskModal.hidden) closeTaskModal();
    if (!el.digestModal.hidden) el.digestModal.hidden = true;
  }
});

el.filterChips.addEventListener('click', (event) => {
  const chip = event.target.closest('[data-filter]');
  if (!chip) return;
  state.status = chip.getAttribute('data-filter');
  [...el.filterChips.children].forEach((node) => node.classList.toggle('is-active', node === chip));
  load();
});

document.getElementById('statGrid').addEventListener('click', (event) => {
  const card = event.target.closest('[data-status]');
  if (!card) return;
  state.status = card.getAttribute('data-status');
  [...el.filterChips.children].forEach((node) =>
    node.classList.toggle('is-active', node.getAttribute('data-filter') === state.status)
  );
  load();
});

let searchTimer = null;
el.searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.query = el.searchInput.value.trim();
    load();
  }, 220);
});

el.sortSelect.addEventListener('change', () => {
  state.sort = el.sortSelect.value;
  load();
});

el.priorityList.addEventListener('click', (event) => {
  const card = event.target.closest('[data-focus]');
  if (!card) return;
  focusTask(card.getAttribute('data-focus'));
});

el.priorityList.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const card = event.target.closest('[data-focus]');
  if (!card) return;
  event.preventDefault();
  focusTask(card.getAttribute('data-focus'));
});

el.taskGrid.addEventListener('click', (event) => {
  const actionNode = event.target.closest('[data-action]');
  const card = event.target.closest('[data-id]');
  if (!card) return;
  const task = state.tasks.find((item) => item.id === card.getAttribute('data-id'));
  if (!task) return;

  if (!actionNode) return;
  const action = actionNode.getAttribute('data-action');

  if (action === 'edit') {
    openTaskModal(task);
  } else if (action === 'delete') {
    deleteTask(task);
  } else if (action === 'toggle-steps') {
    if (state.open.has(task.id)) state.open.delete(task.id);
    else state.open.add(task.id);
    renderTasks();
  }
});

el.taskGrid.addEventListener('change', (event) => {
  const card = event.target.closest('[data-id]');
  if (!card) return;
  const task = state.tasks.find((item) => item.id === card.getAttribute('data-id'));
  if (!task) return;

  if (event.target.matches('[data-action="status"]')) {
    updateStatus(task.id, event.target.value, task);
    return;
  }

  const stepId = event.target.getAttribute('data-step-id');
  if (stepId) {
    toggleStep(task.id, stepId, event.target.checked);
  }
});

function focusTask(id) {
  state.open.add(id);
  renderTasks();
  const card = el.taskGrid.querySelector(`[data-id="${id}"]`);
  if (card) {
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.style.outline = '2px solid #9a9af0';
    setTimeout(() => {
      card.style.outline = '';
    }, 1400);
  }
}

/* ---------------- Boot ---------------- */

load();
setInterval(() => {
  if (el.taskModal.hidden && el.digestModal.hidden && document.visibilityState === 'visible') {
    load();
  }
}, 60000);
