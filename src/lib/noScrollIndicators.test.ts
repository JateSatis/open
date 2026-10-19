// Правило приложения: нигде нет полосы прокрутки. Тест читает исходники и
// требует у каждого прокручиваемого компонента оба индикатора выключенными —
// новый список с полосой не пройдёт проверки.

import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

const ROOT = join(__dirname, '..');

/**
 * Прокручиваемые компоненты: RN, Reanimated, FlashList, клавиатурный скролл,
 * шиты. Тег JSX, а не параметр типа: перед `<` нет имени (`useRef<ScrollView>`).
 */
const SCROLLABLE =
  /(?<![\w.])<(ScrollView|FlatList|SectionList|FlashList|KeyboardAwareScrollView|Animated\.ScrollView|Animated\.FlatList|AnimatedFlashList|BottomSheetScrollView|BottomSheetFlatList)(?=[\s/<])/g;

const REQUIRED = ['showsVerticalScrollIndicator={false}', 'showsHorizontalScrollIndicator={false}'];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);

    if (statSync(path).isDirectory()) return sourceFiles(path);

    return /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [path] : [];
  });
}

/** Открывающий тег от `<` до его `>`: фигурные скобки внутри пропсов не считаются. */
function openingTag(source: string, start: number): string {
  let depth = 0;

  for (let i = start + 1; i < source.length; i += 1) {
    const char = source[i];

    if (char === '{') depth += 1;
    else if (char === '}') depth -= 1;
    else if (char === '>' && depth === 0) return source.slice(start, i + 1);
  }

  return source.slice(start);
}

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split('\n').length;
}

it('no scrollable component shows a scroll indicator', () => {
  const offenders: string[] = [];

  for (const file of sourceFiles(ROOT)) {
    const source = readFileSync(file, 'utf8');

    for (const match of source.matchAll(SCROLLABLE)) {
      const tag = openingTag(source, match.index);
      const missing = REQUIRED.filter((prop) => !tag.includes(prop));

      if (missing.length > 0) {
        offenders.push(
          `${relative(ROOT, file)}:${lineOf(source, match.index)} <${match[1]}> без ${missing.join(', ')}`,
        );
      }
    }
  }

  expect(offenders).toEqual([]);
});
