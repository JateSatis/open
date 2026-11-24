import { useScreenNotice } from '@/features/notifications/useScreenNotice';
import { useRequestClient } from '@/features/auth/RequestClientContext';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, type ReactNode } from 'react';
import { View } from 'react-native';

import { DateRangeFields } from './DateRangeFields';
import { FilterOption } from './FilterOption';
import { styles } from './styles';

import { createSavedTag, type SavedTag } from '@/api/saved';
import { Text } from '@/components/Text';
import { savedTagsQueryKey } from '@/features/saved/keys';
import { CATEGORY_LABELS, TYPE_LABELS, type SavedFilters } from '@/features/saved/savedFilters';
import {
  addFilterTag,
  setFilterDates,
  toggleFilterCategory,
  toggleFilterTag,
  toggleFilterType,
} from '@/features/saved/savedFiltersStore';
import { SavedTagChips } from '@/features/saved/SavedTagChips';

export type FilterContentProps = {
  filters: SavedFilters;
  tags: SavedTag[];
};

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.group}>
      <Text variant="smallBold" color="textSecondary">
        {title}
      </Text>
      {children}
    </View>
  );
}

/**
 * Группы листа фильтров: теги, источники, даты, тип. Выбор применяется
 * сразу — список под листом обновляется, пока он открыт.
 */
export function FilterContent({ filters, tags }: FilterContentProps) {
  const notice = useScreenNotice();
  const api = useRequestClient();
  const queryClient = useQueryClient();
  const selectedTags = useMemo(() => new Set(filters.tags), [filters.tags]);

  // Новый тег — как в листе пересылки: создаётся сразу и сразу выбран.
  const createTag = useCallback(
    async (name: string) => {
      try {
        const tag = await createSavedTag(name, api);

        queryClient.setQueryData<SavedTag[]>(savedTagsQueryKey, (list) =>
          list && !list.some((item) => item.id === tag.id) ? [...list, tag] : list,
        );
        addFilterTag(tag.id);
      } catch {
        notice('Не удалось создать тег', 'error');
      }
    },
    [api, notice, queryClient],
  );

  return (
    <View style={styles.content}>
      <Group title="Теги">
        <SavedTagChips
          tags={tags}
          selectedIds={selectedTags}
          onToggle={toggleFilterTag}
          onCreate={createTag}
        />
      </Group>

      <Group title="Источники">
        <View style={styles.options}>
          {CATEGORY_LABELS.map(({ value, label }) => (
            <FilterOption
              key={value}
              testID={`saved-filter-category-${value}`}
              label={label}
              selected={filters.categories.includes(value)}
              onPress={() => toggleFilterCategory(value)}
            />
          ))}
        </View>
      </Group>

      <Group title="Даты">
        <DateRangeFields from={filters.from} to={filters.to} onChange={setFilterDates} />
      </Group>

      <Group title="Тип сообщения">
        <View style={styles.options}>
          {TYPE_LABELS.map(({ value, label }) => (
            <FilterOption
              key={value}
              testID={`saved-filter-type-${value}`}
              label={label}
              selected={filters.types.includes(value)}
              onPress={() => toggleFilterType(value)}
            />
          ))}
          {/* Файловых сообщений в Open ещё нет: выбирать нечего. */}
          <FilterOption testID="saved-filter-type-files" label="Файлы" selected={false} disabled />
        </View>
      </Group>
    </View>
  );
}
