import type { SearchChannel, SearchPop } from '@/api/search';
import { COLLAPSED_ROWS } from '@/features/search/searchSections';

/** Попсов в ряду сетки выдачи. */
export const FEED_POP_COLUMNS = 2;

export type FeedSearchRow =
  | { type: 'header'; key: string; section: 'recent' | 'channels' | 'pops' }
  | { type: 'recent'; key: string; query: string }
  | { type: 'channel'; key: string; channel: SearchChannel }
  | { type: 'pops'; key: string; pops: SearchPop[] };

/**
 * Строки одной ленты выдачи «Ленты»: пустой запрос — «Недавние»; иначе блок
 * «Каналы» (свёрнут до трёх строк) и «Попсы» рядами по два. Пустой блок не
 * показывается.
 */
export function buildFeedSearchRows(input: {
  query: string;
  recent: string[];
  channels: SearchChannel[];
  pops: SearchPop[];
  channelsExpanded: boolean;
}): FeedSearchRow[] {
  if (input.query.trim() === '') {
    if (input.recent.length === 0) return [];

    return [
      { type: 'header', key: 'header:recent', section: 'recent' },
      ...input.recent.map((query) => ({ type: 'recent' as const, key: `recent:${query}`, query })),
    ];
  }

  const rows: FeedSearchRow[] = [];

  if (input.channels.length > 0) {
    const visible = input.channelsExpanded
      ? input.channels
      : input.channels.slice(0, COLLAPSED_ROWS);

    rows.push({ type: 'header', key: 'header:channels', section: 'channels' });
    visible.forEach((channel) =>
      rows.push({ type: 'channel', key: `channel:${channel.id}`, channel }),
    );
  }

  if (input.pops.length > 0) {
    rows.push({ type: 'header', key: 'header:pops', section: 'pops' });

    for (let at = 0; at < input.pops.length; at += FEED_POP_COLUMNS) {
      // Ключ ряда — его номер: догрузка дописывает ряды, а не пересобирает.
      rows.push({
        type: 'pops',
        key: `pops:${at / FEED_POP_COLUMNS}`,
        pops: input.pops.slice(at, at + FEED_POP_COLUMNS),
      });
    }
  }

  return rows;
}

/** Ряд сетки, в котором стоит поп; -1 — его нет. */
export function rowOfPop(rows: FeedSearchRow[], popId: string): number {
  return rows.findIndex((row) => row.type === 'pops' && row.pops.some((pop) => pop.id === popId));
}
