import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { docSections } from './doc-sections.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const run = (script, args = []) =>
  spawnSync(process.execPath, [script, ...args], { cwd: tmpdir(), encoding: 'utf8' });
const read = (target) => run(join(root, '.agents/scripts/read-doc.mjs'), [target]);

test('оглавление не выводит содержимое большого справочника', () => {
  const result = read('docs/backend.md');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /#профили-и-приватность/);
  assert.doesNotMatch(result.stdout, /`profiles`/);
  assert.ok(result.stdout.length < readFileSync(join(root, 'docs/backend.md'), 'utf8').length / 3);
});

test('раздел RLS читается из другой рабочей директории без соседних разделов', () => {
  const result = read('docs/backend.md#row-level-security');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /## Row Level Security/);
  assert.match(result.stdout, /SELECT/);
  assert.doesNotMatch(result.stdout, /## Realtime|## Модель данных|## Миграции/);
  assert.ok(result.stdout.length < readFileSync(join(root, 'docs/backend.md'), 'utf8').length / 3);
});

test('узкое правило медиа не тянет блокировки и остальной продукт', () => {
  const result = read('docs/product.md#' + encodeURIComponent('контент-и-медиа'));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /sanitize-media/);
  assert.doesNotMatch(result.stdout, /blocked_pair|person_card/);
});

test('широкий или неверный запрос не превращается в полный дамп', () => {
  const broad = read('docs/backend.md#модель-данных');
  assert.equal(broad.status, 2);
  assert.match(broad.stdout, /#сохранённые/);
  assert.doesNotMatch(broad.stdout, /`profiles`/);
  const missing = read('docs/backend.md#нет-раздела');
  assert.equal(missing.status, 1);
  assert.equal(missing.stdout, '');
});

test('заголовки внутри кода игнорируются, вложенность и повторы поддерживаются', () => {
  const { lines, headings } = docSections(
    '# Doc\r\n## Тема\r\na\r\n```md\r\n## Не раздел\r\n```\r\n### Деталь\r\nb\r\n## Тема\r\nc',
  );
  assert.deepEqual(
    headings.map((h) => h.id),
    ['doc', 'тема', 'деталь', 'тема-1'],
  );
  const first = headings[1];
  assert.match(lines.slice(first.line, first.end).join('\n'), /### Деталь/);
  assert.equal(first.end, headings[3].line);
});

test('проверка инструкций отклоняет исчезнувший раздел и ссылку на весь справочник', (t) => {
  const fixture = mkdtempSync(join(tmpdir(), 'openger-doc-links-'));
  t.after(() => {
    // Only the directory created by this test, directly under the system temp directory.
    assert.equal(dirname(resolve(fixture)), resolve(tmpdir()));
    assert.ok(basename(fixture).startsWith('openger-doc-links-'));
    rmSync(fixture, { recursive: true, force: true });
  });
  const put = (path, content) => {
    mkdirSync(dirname(join(fixture, path)), { recursive: true });
    writeFileSync(join(fixture, path), content);
  };
  for (const file of [
    'AGENTS.md',
    'CLAUDE.md',
    'docs/product.md',
    'docs/backend.md',
    'docs/stack.md',
    'docs/development.md',
    '.agents/skills/implement/references/acceptance-verifier.md',
  ])
    put(file, '# Правила\n');
  put('.agents/skills/implement/SKILL.md', '---\nname: implement\ndescription: Fixture\n---\n');
  put('src/features/chats/index.ts', '');
  mkdirSync(join(fixture, '.claude/skills'), { recursive: true });
  mkdirSync(join(fixture, '.agents/scripts'), { recursive: true });
  for (const file of ['check-instructions.mjs', 'doc-sections.mjs'])
    copyFileSync(join(root, '.agents/scripts', file), join(fixture, '.agents/scripts', file));
  const map = '[Чаты](../src/features/chats/index.ts)\n';
  put('docs/map.md', map + '[Правила](backend.md#правила)\n');
  const check = (args) => run(join(fixture, '.agents/scripts/check-instructions.mjs'), args);
  const valid = check(['--write']);
  assert.equal(valid.status, 0, valid.stderr);
  put('docs/map.md', map + '[Правила](backend.md#пропавший-раздел)\n');
  const missing = check([]);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /отсутствует раздел/);
  put('docs/map.md', map + '[Правила](backend.md)\n');
  const broad = check([]);
  assert.equal(broad.status, 1);
  assert.match(broad.stderr, /должна указывать #раздел/);
});
