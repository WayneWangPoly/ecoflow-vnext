import fs from 'node:fs';

const path = 'scripts/transform-007-shadow-bootstrap.test.mjs';
let source = fs.readFileSync(path, 'utf8');

function replaceOnce(before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Missing expected block: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`Expected one block only: ${label}`);
  source = source.slice(0, first) + after + source.slice(first + before.length);
}

replaceOnce(
`test('resolver still fails closed when stable base identity changes during file enumeration', () => {
  const output = runResolver([migration()], {
    rereadPr: pullRequest({ changedFiles: 1, mergeSha: mergeB, baseSha: 'f'.repeat(40) }),
  });
  assert.equal(output.verdict, 'blocked');
  assert.equal(output.reason, 'REQUEST_PR_CHANGED');
});
`,
`test('resolver still fails closed when stable base identity changes during file enumeration', () => {
  const output = runResolver([migration()], {
    rereadPr: pullRequest({ changedFiles: 1, mergeSha: mergeB, baseSha: 'f'.repeat(40) }),
  });
  assert.equal(output.verdict, 'blocked');
  assert.equal(output.reason, 'REQUEST_PR_CHANGED');
});

test('resolver still fails closed when exact head changes during file enumeration', () => {
  const output = runResolver([migration()], {
    rereadPr: pullRequest({ changedFiles: 1, mergeSha: mergeB, headSha: 'f'.repeat(40) }),
  });
  assert.equal(output.verdict, 'blocked');
  assert.equal(output.reason, 'REQUEST_PR_CHANGED');
});

test('resolver still fails closed when PR state, base ref or repository provenance changes', () => {
  for (const rereadPr of [
    pullRequest({ changedFiles: 1, mergeSha: mergeB, state: 'closed' }),
    pullRequest({ changedFiles: 1, mergeSha: mergeB, baseRef: 'release' }),
    pullRequest({ changedFiles: 1, mergeSha: mergeB, headRepo: 'other/repository' }),
  ]) {
    const output = runResolver([migration()], { rereadPr });
    assert.equal(output.verdict, 'blocked');
    assert.equal(output.reason, 'REQUEST_PR_CHANGED');
  }
});
`,
'resolver stable authority negatives');

replaceOnce(
`test('finalizer fails closed if stable base identity changed', () => {
  const { result, statuses } = runFinalizer(pullRequest({ mergeSha: mergeB, baseSha: 'f'.repeat(40) }));
  assert.notEqual(result.status, 0);
  assert.equal(statuses, '');
});
`,
`test('finalizer fails closed if stable base identity changed', () => {
  const { result, statuses } = runFinalizer(pullRequest({ mergeSha: mergeB, baseSha: 'f'.repeat(40) }));
  assert.notEqual(result.status, 0);
  assert.equal(statuses, '');
});

test('finalizer fails closed before publication on head, state, base-ref or repository provenance drift', () => {
  for (const currentPr of [
    pullRequest({ mergeSha: mergeB, headSha: 'f'.repeat(40) }),
    pullRequest({ mergeSha: mergeB, state: 'closed' }),
    pullRequest({ mergeSha: mergeB, baseRef: 'release' }),
    pullRequest({ mergeSha: mergeB, headRepo: 'other/repository' }),
  ]) {
    const { result, statuses } = runFinalizer(currentPr);
    assert.notEqual(result.status, 0);
    assert.equal(statuses, '');
  }
});

test('finalizer fails closed when current synthetic merge is unavailable or aliases the exact head', () => {
  for (const currentPr of [
    pullRequest({ mergeSha: mergeB, mergeable: false }),
    pullRequest({ mergeSha: headA }),
  ]) {
    const { result, statuses } = runFinalizer(currentPr);
    assert.notEqual(result.status, 0);
    assert.equal(statuses, '');
  }
});
`,
'finalizer stable authority negatives');

fs.writeFileSync(path, source);
console.log('Applied #355 negative regression hardening.');
