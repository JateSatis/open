import type { AndroidSymbol, SFSymbol } from 'expo-symbols';

import emojiData from './emojiData.json';

export type EmojiSectionKey =
  | 'recent'
  | 'smileys'
  | 'people'
  | 'animals'
  | 'food'
  | 'travel'
  | 'activities'
  | 'objects'
  | 'symbols'
  | 'flags';

export type EmojiSection = {
  key: EmojiSectionKey;
  title: string;
  icon: { ios: SFSymbol; android: AndroidSymbol; web: AndroidSymbol };
};

/** Разделы в порядке вкладок: «Недавние» — первыми. */
export const EMOJI_SECTIONS: readonly EmojiSection[] = [
  {
    key: 'recent',
    title: 'Недавние',
    icon: { ios: 'clock', android: 'schedule', web: 'schedule' },
  },
  {
    key: 'smileys',
    title: 'Смайлы и эмоции',
    icon: { ios: 'face.smiling', android: 'mood', web: 'mood' },
  },
  {
    key: 'people',
    title: 'Люди',
    icon: { ios: 'hand.wave', android: 'waving_hand', web: 'waving_hand' },
  },
  {
    key: 'animals',
    title: 'Животные и природа',
    icon: { ios: 'pawprint', android: 'pets', web: 'pets' },
  },
  {
    key: 'food',
    title: 'Еда и напитки',
    icon: { ios: 'fork.knife', android: 'restaurant', web: 'restaurant' },
  },
  {
    key: 'travel',
    title: 'Путешествия и места',
    icon: { ios: 'car', android: 'directions_car', web: 'directions_car' },
  },
  {
    key: 'activities',
    title: 'Занятия',
    icon: { ios: 'soccerball', android: 'sports_soccer', web: 'sports_soccer' },
  },
  {
    key: 'objects',
    title: 'Предметы',
    icon: { ios: 'lightbulb', android: 'lightbulb', web: 'lightbulb' },
  },
  {
    key: 'symbols',
    title: 'Символы',
    icon: { ios: 'heart', android: 'emoji_symbols', web: 'emoji_symbols' },
  },
  { key: 'flags', title: 'Флаги', icon: { ios: 'flag', android: 'flag', web: 'flag' } },
];

const groups = emojiData as { key: Exclude<EmojiSectionKey, 'recent'>; emojis: string[] }[];

export type EmojiRow =
  | { type: 'header'; key: string; section: EmojiSectionKey; title: string }
  | { type: 'row'; key: string; section: EmojiSectionKey; emojis: string[] };

export type EmojiGrid = {
  rows: EmojiRow[];
  /** С какой строки начинается раздел: туда листает вкладка. */
  starts: Record<EmojiSectionKey, number>;
};

/**
 * Сетка панели строками по `columns` эмодзи, с подписью над каждым разделом.
 * Пустых «Недавних» в сетке нет — их вкладка ведёт в самое начало.
 */
export function buildEmojiGrid(recent: readonly string[], columns: number): EmojiGrid {
  const rows: EmojiRow[] = [];
  const starts = {} as Record<EmojiSectionKey, number>;
  const per = Math.max(1, columns);

  const add = (section: EmojiSection, emojis: readonly string[]) => {
    starts[section.key] = rows.length;

    if (emojis.length === 0) return;

    rows.push({
      type: 'header',
      key: `h-${section.key}`,
      section: section.key,
      title: section.title,
    });

    for (let at = 0; at < emojis.length; at += per) {
      rows.push({
        type: 'row',
        key: `${section.key}-${at}`,
        section: section.key,
        emojis: emojis.slice(at, at + per),
      });
    }
  };

  for (const section of EMOJI_SECTIONS) {
    add(
      section,
      section.key === 'recent'
        ? recent
        : (groups.find((group) => group.key === section.key)?.emojis ?? []),
    );
  }

  return { rows, starts };
}
