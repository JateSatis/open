import type { SearchEntity, SearchMessage } from '@/api/search';
import type { RecentSearch } from '@/features/search/recentSearches';

/** Сколько строк блока сущностей видно, пока он свёрнут. */
export const COLLAPSED_ROWS = 3;

export type SearchSectionKey = 'recent' | 'mine' | 'global' | 'messages';

/** Блоки, которые сворачиваются: «Показать ещё» / «Свернуть». */
export type ExpandableSection = 'mine' | 'global';

export type SearchRow =
  | { type: 'entity'; key: string; entity: SearchEntity }
  | { type: 'message'; key: string; message: SearchMessage }
  | { type: 'recent'; key: string; item: RecentSearch };

export type SearchSection = {
  key: SearchSectionKey;
  title: string;
  /** Блок длиннее свёрнутого: есть «Показать ещё» / «Свернуть». */
  expandable: boolean;
  expanded: boolean;
  data: SearchRow[];
};

const TITLES: Record<SearchSectionKey, string> = {
  recent: 'Недавние',
  mine: 'Чаты',
  global: 'Глобальный поиск',
  messages: 'Сообщения',
};

function entitySection(
  key: ExpandableSection,
  entities: SearchEntity[],
  expanded: ReadonlySet<ExpandableSection>,
): SearchSection | null {
  if (entities.length === 0) return null;

  const expandable = entities.length > COLLAPSED_ROWS;
  const open = expandable && expanded.has(key);
  const visible = open ? entities : entities.slice(0, COLLAPSED_ROWS);

  return {
    key,
    title: TITLES[key],
    expandable,
    expanded: open,
    data: visible.map((entity) => ({
      type: 'entity',
      key: `${key}:${entity.kind}:${entity.id}`,
      entity,
    })),
  };
}

/**
 * Блоки выдачи по порядку: «Чаты», «Глобальный поиск», «Сообщения». Пустой
 * блок не показывается. Пустой запрос — только «Недавние».
 */
export function buildSearchSections(input: {
  query: string;
  recent: RecentSearch[];
  mine: SearchEntity[];
  global: SearchEntity[];
  messages: SearchMessage[];
  expanded: ReadonlySet<ExpandableSection>;
}): SearchSection[] {
  if (input.query.trim() === '') {
    if (input.recent.length === 0) return [];

    return [
      {
        key: 'recent',
        title: TITLES.recent,
        expandable: false,
        expanded: false,
        data: input.recent.map((item) => ({
          type: 'recent',
          key:
            item.type === 'entity'
              ? `recent:${item.entity.kind}:${item.entity.id}`
              : `recent:message:${item.message.id}`,
          item,
        })),
      },
    ];
  }

  const sections: (SearchSection | null)[] = [
    entitySection('mine', input.mine, input.expanded),
    entitySection('global', input.global, input.expanded),
    input.messages.length > 0
      ? {
          key: 'messages',
          title: TITLES.messages,
          expandable: false,
          expanded: false,
          data: input.messages.map((message) => ({
            type: 'message',
            key: `message:${message.id}`,
            message,
          })),
        }
      : null,
  ];

  return sections.filter((section): section is SearchSection => section !== null);
}
