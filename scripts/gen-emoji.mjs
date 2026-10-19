// Собирает набор эмодзи для панели эмодзи из `unicode-emoji-json` (devDependency):
// только сами символы, по группам, без имён — в бандл идут килобайты, а не
// полмегабайта JSON. Запускать после обновления пакета:
//   node scripts/gen-emoji.mjs
// Результат — src/features/chats/EmojiPanel/emojiData.json, он коммитится.

import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const groups = JSON.parse(
  readFileSync(require.resolve('unicode-emoji-json/data-by-group.json'), 'utf8'),
);

/**
 * Новее этой версии эмодзи шрифты Android 13–14 ещё не рисуют — вместо них
 * был бы пустой квадрат. Поднимать вместе с минимальной версией системы.
 */
const MAX_EMOJI_VERSION = 15.0;

/** Группа набора → ключ вкладки панели. «Компоненты» (оттенки кожи сами по себе) не показываются. */
const KEYS = {
  smileys_emotion: 'smileys',
  people_body: 'people',
  animals_nature: 'animals',
  food_drink: 'food',
  travel_places: 'travel',
  activities: 'activities',
  objects: 'objects',
  symbols: 'symbols',
  flags: 'flags',
};

const out = [];

for (const group of groups) {
  const key = KEYS[group.slug];

  if (!key) continue;

  const emojis = group.emojis
    .filter((item) => Number(item.emoji_version) <= MAX_EMOJI_VERSION)
    .map((item) => item.emoji);

  out.push({ key, emojis });
}

const target = join(root, 'src/features/chats/EmojiPanel/emojiData.json');

writeFileSync(target, `${JSON.stringify(out)}\n`);
console.log(
  `${target}: ${out.map((group) => `${group.key} ${group.emojis.length}`).join(', ')}`,
);
