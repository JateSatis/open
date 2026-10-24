import { useRef, useState } from 'react';
import { Pressable, TextInput } from 'react-native';

import { styles } from './styles';

import { Text } from '@/components/Text';
import { SAVED_TAG_NAME_MAX } from '@/features/saved/limits';
import { useTheme } from '@/hooks/use-theme';
import { Typography } from '@/theme';

export type NewTagFieldProps = {
  /** Новый тег по имени — уже созданный и выбранный, когда промис выполнен. */
  onCreate: (name: string) => Promise<void>;
  /** На плашке цвета фона элемента (меню): «+» на тон темнее, иначе не виден. */
  onElement?: boolean;
  /** Тап по «+» — поле открылось. */
  onStart?: () => void;
};

/** «+» в ряду тегов: тап превращает его в поле имени прямо в ряду. */
export function NewTagField({ onCreate, onElement = false, onStart }: NewTagFieldProps) {
  const theme = useTheme();
  const [draft, setDraftState] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  // «Готово» и потеря фокуса приходят оба, потеря фокуса — и при уходе поля
  // со старым замыканием: имя читается из ссылки, тег создаётся один раз.
  const draftRef = useRef<string | null>(null);
  const finishing = useRef(false);
  const setDraft = (value: string | null) => {
    draftRef.current = value;
    setDraftState(value);
  };

  const finish = () => {
    if (finishing.current || draftRef.current === null) return;

    const name = draftRef.current.trim();

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

  if (draft === null) {
    return (
      <Pressable
        testID="saved-tag-add"
        accessibilityRole="button"
        accessibilityLabel="Новый тег"
        onPress={() => {
          setDraft('');
          onStart?.();
        }}
        style={[
          styles.chip,
          { backgroundColor: onElement ? theme.backgroundSelected : theme.backgroundElement },
        ]}
      >
        <Text variant="bodyBold" color="textSecondary">
          +
        </Text>
      </Pressable>
    );
  }

  return (
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
      style={[styles.input, Typography.small, { color: theme.text, borderColor: theme.primary }]}
    />
  );
}
