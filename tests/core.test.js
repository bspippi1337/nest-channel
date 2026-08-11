const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../nest-core.js');

function task(id, overrides = {}) {
  const baseTime = '2026-08-11T12:00:00.000Z';
  return {
    id,
    title: id,
    assignee: '',
    done: false,
    deleted: false,
    labels: [],
    dependsOn: [],
    comments: [],
    createdAt: baseTime,
    updatedAt: baseTime,
    fieldUpdatedAt: {
      title: baseTime,
      assignee: baseTime,
      done: baseTime,
      deleted: baseTime,
      labels: baseTime,
      dependsOn: baseTime
    },
    ...overrides
  };
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

test('field-level merge preserves simultaneous edits to different fields', () => {
  const local = task('A', {
    title: 'Original',
    assignee: 'Mina',
    updatedAt: '2026-08-11T12:05:00.000Z',
    fieldUpdatedAt: {
      title: '2026-08-11T12:00:00.000Z',
      assignee: '2026-08-11T12:05:00.000Z',
      done: '2026-08-11T12:00:00.000Z',
      deleted: '2026-08-11T12:00:00.000Z',
      labels: '2026-08-11T12:00:00.000Z',
      dependsOn: '2026-08-11T12:00:00.000Z'
    }
  });
  const remote = task('A', {
    title: 'Ny tittel',
    assignee: '',
    updatedAt: '2026-08-11T12:04:00.000Z',
    fieldUpdatedAt: {
      title: '2026-08-11T12:04:00.000Z',
      assignee: '2026-08-11T12:00:00.000Z',
      done: '2026-08-11T12:00:00.000Z',
      deleted: '2026-08-11T12:00:00.000Z',
      labels: '2026-08-11T12:00:00.000Z',
      dependsOn: '2026-08-11T12:00:00.000Z'
    }
  });

  const merged = core.mergeTask(local, remote);
  assert.equal(merged.title, 'Ny tittel');
  assert.equal(merged.assignee, 'Mina');
});

test('comments merge independently of task field clocks', () => {
  const local = task('A', {
    comments: [{ id: 'c1', author: 'A', text: 'lokal', createdAt: '2026-08-11T12:01:00.000Z' }]
  });
  const remote = task('A', {
    comments: [{ id: 'c2', author: 'B', text: 'remote', createdAt: '2026-08-11T12:02:00.000Z' }]
  });
  const merged = core.mergeTask(local, remote);
  assert.deepEqual(merged.comments.map(item => item.id), ['c1', 'c2']);
});

test('newer delete flag wins without clobbering newer title', () => {
  const local = task('A', {
    title: 'Lokal ny tittel',
    deleted: false,
    updatedAt: '2026-08-11T12:10:00.000Z',
    fieldUpdatedAt: {
      title: '2026-08-11T12:10:00.000Z',
      assignee: '2026-08-11T12:00:00.000Z',
      done: '2026-08-11T12:00:00.000Z',
      deleted: '2026-08-11T12:00:00.000Z',
      labels: '2026-08-11T12:00:00.000Z',
      dependsOn: '2026-08-11T12:00:00.000Z'
    }
  });
  const remote = task('A', {
    title: 'Gammel tittel',
    deleted: true,
    updatedAt: '2026-08-11T12:08:00.000Z',
    fieldUpdatedAt: {
      title: '2026-08-11T12:00:00.000Z',
      assignee: '2026-08-11T12:00:00.000Z',
      done: '2026-08-11T12:00:00.000Z',
      deleted: '2026-08-11T12:08:00.000Z',
      labels: '2026-08-11T12:00:00.000Z',
      dependsOn: '2026-08-11T12:00:00.000Z'
    }
  });
  const merged = core.mergeTask(local, remote);
  assert.equal(merged.title, 'Lokal ny tittel');
  assert.equal(merged.deleted, true);
});
