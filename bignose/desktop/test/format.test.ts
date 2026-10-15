import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBlocks, parseInline } from '../src/format.ts';

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

test('headings, lists and a list that follows a line of text', () => {
  assert.deepEqual(parseBlocks('# Title\n### Small\ntext\n- one\n- two\n  wrapped\n\n1. a\n2) b\nafter'), [
    { kind: 'h', level: 2, text: 'Title' }, { kind: 'h', level: 3, text: 'Small' }, { kind: 'p', text: 'text' },
    { kind: 'ul', items: ['one', 'two\nwrapped'] }, { kind: 'ol', items: ['a', 'b'] }, { kind: 'p', text: 'after' },
  ]);
});

test('things that only look like markup stay paragraphs', () => {
  assert.deepEqual(parseBlocks('#hashtag\n2024. a year\n**not a list**\n-dash'), [{ kind: 'p', text: '#hashtag\n2024. a year\n**not a list**\n-dash' }]);
});

test('bold and inline code split a line; an unclosed one stays literal while streaming', () => {
  assert.deepEqual(parseInline('a **b** and `c` d'), [
    { kind: 'text', text: 'a ' }, { kind: 'strong', text: 'b' }, { kind: 'text', text: ' and ' }, { kind: 'code', text: 'c' }, { kind: 'text', text: ' d' },
  ]);
  assert.deepEqual(parseInline('half **bold'), [{ kind: 'text', text: 'half **bold' }]);
  assert.deepEqual(parseInline('<b>x</b>'), [{ kind: 'text', text: '<b>x</b>' }]);
});
