'use strict';

const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3000';
const CHROME =
  process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SHOT_DIR = process.env.SHOT_DIR || path.join(__dirname, '..', 'screenshots');

let passed = 0;
function ok(label, condition, extra) {
  if (condition) {
    passed += 1;
    console.log(`ok    ${label}`);
  } else {
    console.error(`FAIL  ${label}${extra === undefined ? '' : ` -> ${JSON.stringify(extra)}`}`);
    process.exitCode = 1;
  }
}

async function text(page, selector) {
  return page.$eval(selector, (node) => node.textContent.trim());
}

async function count(page, selector) {
  return page.$$eval(selector, (nodes) => nodes.length);
}

async function cardIdByTitle(page, title) {
  return page.$$eval(
    '.task-card',
    (cards, wanted) => {
      const found = cards.find(
        (card) => (card.querySelector('.task-title') || {}).textContent.trim() === wanted
      );
      return found ? found.getAttribute('data-id') : null;
    },
    title
  );
}

async function main() {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu']
  });

  const page = await browser.newPage();
  const problems = [];
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console: ${message.text()}`);
  });
  page.on('dialog', (dialog) => dialog.accept());

  await page.setViewport({ width: 1360, height: 1000, deviceScaleFactor: 1 });
  await page.goto(BASE, { waitUntil: 'networkidle0' });

  ok('page loads with the TaskMate title', (await page.title()) === 'TaskMate AI');
  ok('five project tasks render', (await count(page, '.task-card')) === 5, await count(page, '.task-card'));
  ok('dashboard shows the total', (await text(page, '#statTotal')) === '5');
  const blockedCards = await page.$$eval('.task-card [data-action="status"]', (nodes) =>
    nodes.filter((node) => node.getAttribute('data-status') === 'blocked').length
  );
  ok('dashboard shows the blocked count', (await text(page, '#statBlocked')) === String(blockedCards));
  ok('top priorities are ranked', (await count(page, '.priority-card')) >= 3);
  ok('progress bar reflects completion', (await text(page, '#heroPercent')) === '20%');

  await page.click('#newTaskBtn');
  await page.waitForSelector('#taskModal:not([hidden])');
  await page.type('#titleInput', 'Write the demo script');
  await page.type('#descInput', 'Short walkthrough for the hackathon judges.');
  const today = new Date().toISOString().slice(0, 10);
  await page.$eval('#dueInput', (node, value) => { node.value = value; }, today);
  await page.$eval('#importanceInput', (node) => {
    node.value = '5';
    node.dispatchEvent(new Event('input', { bubbles: true }));
  });
  ok('importance slider updates its label', (await text(page, '#importanceValue')) === '5/5');

  await page.click('#suggestStepsBtn');
  await page.waitForFunction(
    () => document.querySelectorAll('#stepEditor li:not(.step-editor-empty)').length >= 3,
    { timeout: 8000 }
  );
  ok('AI suggests steps in the form', (await count(page, '#stepEditor li:not(.step-editor-empty)')) >= 3);

  await page.click('#saveBtn');
  await page.waitForFunction(() => document.querySelectorAll('.task-card').length === 6, {
    timeout: 8000
  });
  ok('saving adds the task to the board', (await count(page, '.task-card')) === 6);
  ok('dashboard total updates', (await text(page, '#statTotal')) === '6');

  const id = await cardIdByTitle(page, 'Write the demo script');
  ok('new task is found by title', Boolean(id));

  await page.select(`[data-id="${id}"] [data-action="status"]`, 'in_progress');
  await page.waitForFunction(
    (taskId) => {
      const card = document.querySelector(`[data-id="${taskId}"]`);
      const select = card && card.querySelector('[data-action="status"]');
      return select && select.getAttribute('data-status') === 'in_progress';
    },
    { timeout: 8000 },
    id
  );
  ok('status change persists', true);

  await page.click(`[data-id="${id}"] [data-action="toggle-steps"]`);
  await page.waitForSelector(`[data-id="${id}"] .step-item input[type="checkbox"]`);
  await page.click(`[data-id="${id}"] .step-item input[type="checkbox"]`);
  await page.waitForFunction(
    (taskId) => {
      const card = document.querySelector(`[data-id="${taskId}"]`);
      const item = card && card.querySelector('.step-item');
      return item && item.classList.contains('is-done');
    },
    { timeout: 8000 },
    id
  );
  ok('step checkbox marks the step done', true);

  await page.click('#roomUpdateBtn');
  await page.waitForSelector('#digestModal:not([hidden])');
  const digest = await page.$eval('#digestText', (node) => node.value);
  ok('room update is generated', digest.includes('TaskMate AI') && digest.includes('Write the demo script'));
  ok('room update includes progress', /Progress: \d+% complete/.test(digest));
  await page.click('#digestCloseBtn');

  await page.screenshot({ path: path.join(SHOT_DIR, 'desktop.png'), fullPage: true });

  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  await page.reload({ waitUntil: 'networkidle0' });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth
  );
  ok('mobile has no horizontal overflow', overflow <= 1, overflow);
  await page.screenshot({ path: path.join(SHOT_DIR, 'mobile.png'), fullPage: true });

  await page.setViewport({ width: 1360, height: 1000, deviceScaleFactor: 1 });
  await page.reload({ waitUntil: 'networkidle0' });
  const deleteId = await cardIdByTitle(page, 'Write the demo script');
  await page.click(`[data-id="${deleteId}"] [data-action="delete"]`);
  await page.waitForFunction(() => document.querySelectorAll('.task-card').length === 5, {
    timeout: 8000
  });
  ok('deleting removes the task', (await count(page, '.task-card')) === 5);

  ok('no browser console errors', problems.length === 0, problems);

  await browser.close();
  console.log(`\n${passed} UI checks passed`);
  console.log(`Screenshots: ${SHOT_DIR}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
