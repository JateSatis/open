import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { styles } from './styles';

import type { SavedTag } from '@/api/saved';
import { Text } from '@/components/Text';
import { SAVED_TOP_TAGS } from '@/features/saved/limits';
import { NewTagField } from '@/features/saved/NewTagField';
import { SavedTagChip } from '@/features/saved/SavedTagChip';

export type SavedTagChipsProps = {
  /** В порядке показа: новые этого листа первыми, дальше — самые используемые. */
  tags: SavedTag[];
  selectedIds: ReadonlySet<string>;
  onToggle: (tagId: string) => void;
  /** Новый тег по имени — уже созданный и выбранный, когда промис выполнен. */
  onCreate: (name: string) => Promise<void>;
};

/**
 * Ряд чипов тегов: «+», затем десять самых используемых, остальные — за
 * «Показать все». Невыбранный — серый, выбранный — в цвете тега. «+»
 * превращается в поле имени прямо в ряду.
 */
export function SavedTagChips({ tags, selectedIds, onToggle, onCreate }: SavedTagChipsProps) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? tags : tags.slice(0, SAVED_TOP_TAGS);

  return (
    <View style={styles.row}>
      <NewTagField onCreate={onCreate} />

      {shown.map((tag) => (
        <SavedTagChip
          key={tag.id}
          tag={tag}
          selected={selectedIds.has(tag.id)}
          onPress={() => onToggle(tag.id)}
        />
      ))}

      {tags.length > SAVED_TOP_TAGS ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => setExpanded((value) => !value)}
          style={styles.more}
        >
          <Text variant="small" color="primary">
            {expanded ? 'Свернуть' : 'Показать все'}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
