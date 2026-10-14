import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBlocks } from '../src/format.ts';

test('splits paragraphs on blank lines and keeps single newlines', () => {
  assert.deepEqual(parseBlocks('one\ntwo\n\nthree'), [{ kind: 'p', text: 'one\ntwo' }, { kind: 'p', text: 'three' }]);
});

test('fenced code keeps its text and language, and ends paragraphs', () => {
  assert.deepEqual(parseBlocks('before\n```ts\nconst a = 1;\n\nconst b = 2;\n```\nafter'), [
    { kind: 'p', text: 'before' }, { kind: 'code', text: 'const a = 1;\n\nconst b = 2;', lang: 'ts' }, { kind: 'p', text: 'after' },
  ]);
});

test('an unfinished fence (mid-stream) is still shown as code', () => {
  assert.deepEqual(parseBlocks('x\n```\nls -la'), [{ kind: 'p', text: 'x' }, { kind: 'code', text: 'ls -la', lang: '' }]);
});

test('markup stays plain text', () => {
  assert.deepEqual(parseBlocks('<img src=x onerror=alert(1)>'), [{ kind: 'p', text: '<img src=x onerror=alert(1)>' }]);
});

test('empty input gives no blocks', () => {
  assert.deepEqual(parseBlocks(''), []);
});
