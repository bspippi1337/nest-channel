const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../nest-core.js');

function task(id, overrides = {}) {
  const baseTime = '2026-08-11T12:00:00.000Z';
  return {
    id, title: id, assignee: '', done: false, deleted: false, labels: [], dependsOn: [], comments: [],
    createdAt: baseTime, updatedAt: baseTime,
    fieldUpdatedAt: {
      title: baseTime, assignee: baseTime, done: baseTime, deleted: baseTime, labels: baseTime, dependsOn: baseTime
    },
    ...overrides
  };
}

function clocks(values = {}) {
  const base = '2026-08-11T12:00:00.000Z';
  return Object.fromEntries(core.TASK_FIELDS.map(field => [field, values[field] || base]));
}

test('door model opens tasks in dependency order', () => {
  const a = task('A');
  const b = task('B', { dependsOn: ['A'] });
  const c = task('C', { dependsOn: ['B'] });
  const tasks = [a, b, c];
  assert.equal(core.taskState(tasks, a), 'ready');
  assert.equal(core.taskState(tasks, b), 'waiting');
  assert.equal(core.taskState(tasks, c), 'waiting');
  a.done = true;
  assert.equal(core.taskState(tasks, b), 'ready');
  assert.equal(core.taskState(tasks, c), 'waiting');
  b.done = true;
  assert.equal(core.taskState(tasks, c), 'ready');
});

test('cycle detection blocks direct and transitive loops', () => {
  const a = task('A', { dependsOn: ['B'] });
  const b = task('B', { dependsOn: ['C'] });
  const c = task('C');
  const tasks = [a, b, c];
  assert.equal(core.wouldCreateCycle(tasks, 'C', 'A'), true);
  assert.equal(core.wouldCreateCycle(tasks, 'A', 'A'), true);
  assert.equal(core.wouldCreateCycle(tasks, 'C', 'B'), true);
  assert.equal(core.wouldCreateCycle(tasks, 'A', 'C'), false);
});

test('legacy field-level merge preserves simultaneous edits to different fields', () => {
  const local = task('A', {
    title: 'Original', assignee: 'Mina', fieldUpdatedAt: clocks({ assignee: '2026-08-11T12:05:00.000Z' })
  });
  const remote = task('A', {
    title: 'Ny tittel', assignee: '', fieldUpdatedAt: clocks({ title: '2026-08-11T12:04:00.000Z' })
  });
  const merged = core.mergeTask(local, remote);
  assert.equal(merged.title, 'Ny tittel');
  assert.equal(merged.assignee, 'Mina');
});

test('comments merge independently of task field clocks', () => {
  const local = task('A', { comments: [{ id: 'c1', author: 'A', text: 'lokal', createdAt: '2026-08-11T12:01:00.000Z' }] });
  const remote = task('A', { comments: [{ id: 'c2', author: 'B', text: 'remote', createdAt: '2026-08-11T12:02:00.000Z' }] });
  const merged = core.mergeTask(local, remote);
  assert.deepEqual(merged.comments.map(item => item.id), ['c1', 'c2']);
});

test('newer legacy delete flag wins without clobbering newer legacy title', () => {
  const local = task('A', {
    title: 'Lokal ny tittel', deleted: false, fieldUpdatedAt: clocks({ title: '2026-08-11T12:10:00.000Z' })
  });
  const remote = task('A', {
    title: 'Gammel tittel', deleted: true, fieldUpdatedAt: clocks({ deleted: '2026-08-11T12:08:00.000Z' })
  });
  const merged = core.mergeTask(local, remote);
  assert.equal(merged.title, 'Lokal ny tittel');
  assert.equal(merged.deleted, true);
});

test('logical clock beats an absurdly future wall clock during migration', () => {
  const localClock = core.makeLogicalClock(1, 'phone-a');
  const local = task('A', { title: 'Logisk edit', fieldUpdatedAt: clocks({ title: localClock }) });
  const remote = task('A', { title: 'Telefon satt til år 2099', fieldUpdatedAt: clocks({ title: '2099-12-31T23:59:59.999Z' }) });
  const merged = core.mergeTask(local, remote);
  assert.equal(merged.title, 'Logisk edit');
  assert.equal(merged.fieldUpdatedAt.title, localClock);
});

test('higher Lamport counter wins regardless of wall clock', () => {
  const local = task('A', { title: 'Lokal', fieldUpdatedAt: clocks({ title: core.makeLogicalClock(7, 'phone-a') }) });
  const remote = task('A', { title: 'Remote', fieldUpdatedAt: clocks({ title: core.makeLogicalClock(8, 'phone-b') }) });
  assert.equal(core.mergeTask(local, remote).title, 'Remote');
});

test('Lamport tie is deterministic by client id', () => {
  const alpha = core.makeLogicalClock(12, 'alpha');
  const omega = core.makeLogicalClock(12, 'omega');
  assert.equal(core.compareClock(alpha, omega), -1);
  assert.equal(core.compareClock(omega, alpha), 1);
  const local = task('A', { title: 'Alpha', fieldUpdatedAt: clocks({ title: alpha }) });
  const remote = task('A', { title: 'Omega', fieldUpdatedAt: clocks({ title: omega }) });
  assert.equal(core.mergeTask(local, remote).title, 'Omega');
});

test('logical counter parser ignores legacy timestamps', () => {
  assert.equal(core.logicalCounter('2099-01-01T00:00:00.000Z'), 0);
  assert.equal(core.logicalCounter(core.makeLogicalClock(42, 'node')), 42);
});
