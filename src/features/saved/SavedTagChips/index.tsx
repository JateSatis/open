import { useRef, useState } from 'react';
import { Pressable, TextInput, View, useColorScheme } from 'react-native';

import { styles } from './styles';

import type { SavedTag } from '@/api/saved';
import { Text } from '@/components/Text';
import { SAVED_TAG_NAME_MAX, SAVED_TOP_TAGS } from '@/features/saved/limits';
import { useTheme } from '@/hooks/use-theme';
import { Typography, savedTagTone } from '@/theme';

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
  const theme = useTheme();
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  // «Готово» и потеря фокуса приходят оба — тег создаётся один раз.
  const finishing = useRef(false);
  const shown = expanded ? tags : tags.slice(0, SAVED_TOP_TAGS);

  const finish = () => {
    if (finishing.current) return;

    const name = draft?.trim() ?? '';

    // Пустое имя — передумал: поле уходит, ничего не создаётся.
    if (!name) {
      setDraft(null);
      return;
    }

    finishing.current = true;
    setCreating(true);
    void onCreate(name).finally(() => {
      finishing.current = false;
      setCreating(false);
      setDraft(null);
    });
  };

  return (
    <View style={styles.row}>
      {draft === null ? (
        <Pressable
          testID="saved-tag-add"
          accessibilityRole="button"
          accessibilityLabel="Новый тег"
          onPress={() => setDraft('')}
          style={[styles.chip, { backgroundColor: theme.backgroundElement }]}
        >
          <Text variant="bodyBold" color="textSecondary">
            +
          </Text>
        </Pressable>
      ) : (
        <TextInput
          testID="saved-tag-name"
          accessibilityLabel="Имя тега"
          placeholder="Тег"
          placeholderTextColor={theme.textSecondary}
          value={draft}
          onChangeText={setDraft}
          maxLength={SAVED_TAG_NAME_MAX}
          autoFocus
          editable={!creating}
          returnKeyType="done"
          submitBehavior="blurAndSubmit"
          onSubmitEditing={finish}
          onBlur={finish}
          style={[
            styles.input,
            Typography.small,
            { color: theme.text, borderColor: theme.primary },
          ]}
        />
      )}

      {shown.map((tag) => {
        const selected = selectedIds.has(tag.id);
        const tone = savedTagTone(scheme, tag.color);

        return (
          <Pressable
            key={tag.id}
            testID={`saved-tag-${tag.name}`}
            accessibilityRole="checkbox"
            accessibilityLabel={tag.name}
            accessibilityState={{ checked: selected }}
            onPress={() => onToggle(tag.id)}
            style={[
              styles.chip,
              { backgroundColor: selected ? tone.fill : theme.backgroundElement },
            ]}
          >
            <Text
              variant="smallBold"
              numberOfLines={1}
              style={{ color: selected ? tone.text : theme.textSecondary }}
            >
              {tag.name}
            </Text>
          </Pressable>
        );
      })}

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
