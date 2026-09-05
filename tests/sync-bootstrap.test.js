const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../nest-core.js');

function chunk(id, part, total, data, createdAt, extra = {}) {
  return { id, part, total, data, iv: `iv-${id}`, room: 'room', createdAt, commentId: `${id}-${part}`, ...extra };
}

test('bootstrap assembles multipart snapshots in part order', () => {
  const groups = core.completeEnvelopeGroups([
    chunk('A', 2, 3, 'BB', '2026-09-05T10:00:02Z'),
    chunk('A', 1, 3, 'AA', '2026-09-05T10:00:01Z'),
    chunk('A', 3, 3, 'CC', '2026-09-05T10:00:03Z')
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].data, 'AABBCC');
});

test('newest incomplete snapshot is skipped in favor of newest complete snapshot', () => {
  const groups = core.completeEnvelopeGroups([
    chunk('new', 1, 2, 'new-a', '2026-09-05T12:10:00Z'),
    chunk('old', 1, 2, 'old-a', '2026-09-05T12:00:00Z'),
    chunk('old', 2, 2, 'old-b', '2026-09-05T12:00:01Z')
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].id, 'old');
});

test('complete snapshots are sorted newest first', () => {
  const groups = core.completeEnvelopeGroups([
    chunk('old', 1, 1, 'old', '2026-09-05T12:00:00Z'),
    chunk('new', 1, 1, 'new', '2026-09-05T12:10:00Z')
  ]);
  assert.deepEqual(groups.map(group => group.id), ['new', 'old']);
});

test('mismatched envelope metadata invalidates a group', () => {
  assert.deepEqual(core.completeEnvelopeGroups([
    chunk('bad', 1, 2, 'a', '2026-09-05T12:00:00Z'),
    chunk('bad', 2, 3, 'b', '2026-09-05T12:00:01Z')
  ]), []);
});
