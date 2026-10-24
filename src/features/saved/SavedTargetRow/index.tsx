import { SymbolView } from 'expo-symbols';
import { Pressable, View } from 'react-native';

import { styles } from './styles';

import type { SavedTag } from '@/api/saved';
import { SelectionCheck } from '@/components/SelectionCheck';
import { Text } from '@/components/Text';
import { SavedTagChips } from '@/features/saved/SavedTagChips';
import { useTheme } from '@/hooks/use-theme';
import { Sizes, Spacing } from '@/theme';

export type SavedTargetRowProps = {
  /** «Сохранённые» выбраны адресатом. */
  selected: boolean;
  onToggle: () => void;
  /** Область настроек раскрыта. */
  open: boolean;
  onToggleOpen: () => void;
  tags: SavedTag[];
  selectedTagIds: ReadonlySet<string>;
  onToggleTag: (tagId: string) => void;
  onCreateTag: (name: string) => Promise<void>;
  watchLater: boolean;
  onToggleWatchLater: () => void;
};

/**
 * Первая строка листа «Кому переслать»: «★ Сохранённые сообщения» — адресат,
 * как любой чат. «Настроить» раскрывает под ней теги и «Посмотреть позже».
 */
export function SavedTargetRow({
  selected,
  onToggle,
  open,
  onToggleOpen,
  tags,
  selectedTagIds,
  onToggleTag,
  onCreateTag,
  watchLater,
  onToggleWatchLater,
}: SavedTargetRowProps) {
  const theme = useTheme();

  return (
    <View testID="forward-saved" style={[styles.container, { borderBottomColor: theme.border }]}>
      <Pressable
        testID="forward-saved-row"
        accessibilityRole="checkbox"
        accessibilityLabel="Сохранённые сообщения"
        accessibilityState={{ checked: selected }}
        onPress={onToggle}
        style={styles.row}
      >
        <View style={[styles.star, { backgroundColor: theme.primary }]}>
          <SymbolView
            name={{ ios: 'star.fill', android: 'star', web: 'star' }}
            size={Sizes.savedStarIcon}
            tintColor={theme.primaryText}
          />
        </View>

        <Text variant="bodyBold" numberOfLines={2} style={styles.title}>
          Сохранённые сообщения
        </Text>

        <Pressable
          testID="forward-saved-configure"
          accessibilityRole="button"
          accessibilityLabel="Настроить"
          accessibilityState={{ expanded: open }}
          onPress={onToggleOpen}
          hitSlop={Spacing.two}
          style={styles.configure}
        >
          {/* Раскрыто — та же подпись жирнее: «Свернуть» уже есть у тегов. */}
          <Text variant={open ? 'smallBold' : 'small'} color="primary">
            Настроить
          </Text>
        </Pressable>

        <SelectionCheck checked={selected} />
      </Pressable>

      {open ? (
        <View testID="forward-saved-settings" style={styles.settings}>
          <Text variant="smallBold" color="textSecondary">
            Теги
          </Text>
          <SavedTagChips
            tags={tags}
            selectedIds={selectedTagIds}
            onToggle={onToggleTag}
            onCreate={onCreateTag}
          />

          <Pressable
            testID="forward-saved-watch-later"
            accessibilityRole="checkbox"
            accessibilityLabel="Посмотреть позже"
            accessibilityState={{ checked: watchLater }}
            onPress={onToggleWatchLater}
            style={styles.watchLater}
          >
            <SelectionCheck checked={watchLater} />
            <Text variant="body">Посмотреть позже</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
