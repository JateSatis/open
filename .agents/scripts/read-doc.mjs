// Read one reference section, or list headings without loading the document into agent context.
import { readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { docSections } from './doc-sections.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
try {
  if (process.argv.length !== 3)
    throw new Error(
      'Usage: node .agents/scripts/read-doc.mjs "docs/file.md#section" (без # — оглавление)',
    );
  const [file, anchor, ...extra] = process.argv[2].split('#');
  const path = resolve(root, file);
  if (extra.length || !path.startsWith(resolve(root, 'docs') + sep) || !file.endsWith('.md')) {
    throw new Error('Укажи Markdown-файл внутри docs/ и не более одного #раздела.');
  }
  const { lines, headings } = docSections(readFileSync(path, 'utf8'));
  const outline = (items) =>
    items
      .map(
        (h) => `${'  '.repeat(h.level - 1)}${file}#${h.id} — ${h.title} [${h.line + 1}–${h.end}]`,
      )
      .join('\n');
  if (anchor === undefined) {
    console.log(outline(headings) || 'Заголовков нет. Найди нужный фрагмент через rg.');
  } else {
    const heading = headings.find((h) => h.id === decodeURIComponent(anchor));
    if (!heading) throw new Error(`Раздел #${anchor} не найден; без # команда покажет оглавление.`);
    const section = lines.slice(heading.line, heading.end).join('\n').trimEnd();
    if (heading.end - heading.line > 100 || section.length > 12000) {
      console.error(
        'Раздел слишком велик для одной загрузки. Выбери подраздел или точный диапазон по вопросу:',
      );
      console.log(
        outline(headings.filter((h) => h.line > heading.line && h.line < heading.end)) ||
          `${file}:${heading.line + 1}–${heading.end}`,
      );
      process.exitCode = 2;
    } else {
      console.log(`${file}:${heading.line + 1}–${heading.end}\n\n${section}`);
    }
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
