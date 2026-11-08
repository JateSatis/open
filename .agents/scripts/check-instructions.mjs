// Keep Claude adapters derived from the common skills. No application checks or dependencies.
// node .agents/scripts/check-instructions.mjs [--write]
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { docSections } from './doc-sections.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const write = process.argv.includes('--write');
if (process.argv.slice(2).some((arg) => arg !== '--write')) {
  console.error('Usage: node .agents/scripts/check-instructions.mjs [--write]');
  process.exit(1);
}
const errors = [];
const read = (path) => readFileSync(join(root, path), 'utf8').replace(/\r\n/g, '\n');
const skillsRoot = '.agents/skills';
const skills = readdirSync(join(root, skillsRoot)).filter((name) =>
  existsSync(join(root, skillsRoot, name, 'SKILL.md')),
);
const references = ['docs/product.md', 'docs/backend.md', 'docs/stack.md', 'docs/development.md'];
const referencePaths = new Set(references.map((file) => resolve(root, file)));
const sources = ['AGENTS.md', 'CLAUDE.md', ...references];
const mapSources = ['docs/map.md'];
function collectCards(directory) {
  if (!existsSync(join(root, directory))) return;
  for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) collectCards(path);
    else if (entry.name.endsWith('.md')) mapSources.push(path);
  }
}
collectCards('docs/map');
sources.push(...mapSources);
const mappedPaths = new Set();

function adapter(path, expected) {
  if (write) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), expected);
  } else if (!existsSync(join(root, path)) || read(path) !== expected) {
    errors.push(`${path}: отличается от общего источника; обнови с --write`);
  }
}

for (const name of skills) {
  const source = `${skillsRoot}/${name}/SKILL.md`;
  sources.push(source);
  const front = read(source).match(/^---\n([\s\S]*?)\n---\n/);
  const declared = front?.[1].match(/^name: (.+)$/m)?.[1];
  const description = front?.[1].match(/^description: (.+)$/m)?.[1];
  if (declared !== name || !description) {
    errors.push(`${source}: нужны name по имени папки и однострочный description`);
    continue;
  }
  adapter(
    `.claude/skills/${name}/SKILL.md`,
    `---\nname: ${name}\ndescription: ${description}\nargument-hint: <задача>\n---\n\n` +
      `# /${name}\n\n` +
      `Прочитай и выполни [общий навык](../../../.agents/skills/${name}/SKILL.md).\n` +
      'Задача: $ARGUMENTS. Если аргументов нет — запрос человека в текущем чате.\n\n' +
      'Этот адаптер создаётся командой `node .agents/scripts/check-instructions.mjs --write`.\n' +
      'Правила работы меняй в общем навыке.\n',
  );
}

const review = '.agents/skills/implement/references/acceptance-verifier.md';
sources.push(review);
adapter(
  '.claude/agents/acceptance-verifier.md',
  '---\nname: acceptance-verifier\n' +
    'description: Независимое чтение изменений Open по критериям приёмки; вызывается по просьбе человека или существенному риску изменения.\n' +
    'tools: Read, Grep, Glob, Bash\n---\n\n' +
    `Прочитай и выполни [общие правила проверки](../../${review}).\n\n` +
    'Этот адаптер создаётся командой `node .agents/scripts/check-instructions.mjs --write`.\n' +
    'Правила проверки меняй в общем файле.\n',
);

// Reject stale copies of deleted/renamed common skills rather than silently leaving two workflows.
for (const name of readdirSync(join(root, '.claude/skills'))) {
  if (existsSync(join(root, '.claude/skills', name, 'SKILL.md')) && !skills.includes(name)) {
    errors.push(`.claude/skills/${name}: нет общего навыка в ${skillsRoot}`);
  }
}
for (const source of sources) {
  if (!existsSync(join(root, source))) {
    errors.push(`${source}: файл отсутствует`);
    continue;
  }
  for (const [, target] of read(source).matchAll(/\[[^\]]*\]\(([^\s)]+)\)/g)) {
    if (/^[a-z]+:/i.test(target)) continue;
    const [local, fragment] = target.split('#').map(decodeURIComponent);
    const absolute = local ? resolve(root, dirname(source), local) : resolve(root, source);
    if (mapSources.includes(source)) mappedPaths.add(absolute);
    if (!existsSync(absolute)) {
      errors.push(`${source}: отсутствует цель ссылки ${target}`);
      continue;
    }
    if (referencePaths.has(absolute) && !fragment) {
      errors.push(`${source}: ссылка на справочник должна указывать #раздел: ${target}`);
    }
    if (fragment && absolute.endsWith('.md')) {
      const { headings } = docSections(readFileSync(absolute, 'utf8'));
      if (!headings.some((heading) => heading.id === fragment)) {
        errors.push(`${source}: отсутствует раздел ${target}`);
      }
    }
  }
}
// A feature must have an entry point somewhere in the map; no source files are loaded.
const features = readdirSync(join(root, 'src/features'), { withFileTypes: true }).filter((entry) =>
  entry.isDirectory(),
);
for (const feature of features) {
  const directory = resolve(root, 'src/features', feature.name);
  if (![...mappedPaths].some((path) => path === directory || path.startsWith(directory + sep))) {
    errors.push(`docs/map.md: область src/features/${feature.name} не представлена в карте`);
  }
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log(
    `${write ? 'Обновлены' : 'Проверены'} ${skills.length} адаптера навыков и ревьюер; ` +
      `ссылки в порядке, карта покрывает ${features.length} областей.`,
  );
}
