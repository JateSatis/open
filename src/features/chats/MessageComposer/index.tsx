import { TextInput, View } from 'react-native';

import { styles } from './styles';

import { Button } from '@/components/Button';
import { Text } from '@/components/Text';
import type { LibraryAsset } from '@/features/media';
import { useTheme } from '@/hooks/use-theme';

export type MessageComposerProps = {
  text: string;
  onChangeText: (text: string) => void;
  media: LibraryAsset[];
  onSend: () => void;
  onTyping: () => void;
  /**
   * Members write, everyone else reads. The server decides — hiding the field
   * is only the polite half of that rule.
   */
  canSend: boolean;
  /**
   * Открывает шит выбора медиа. Не передаётся у копии composer'а внутри
   * самого шита — там прикреплять уже нечем открывать.
   */
  onAttachPress?: () => void;
};

export function MessageComposer({
  text,
  onChangeText,
  media,
  onSend,
  onTyping,
  canSend,
  onAttachPress,
}: MessageComposerProps) {
  const theme = useTheme();

  if (!canSend) {
    return (
      <View style={[styles.notice, { borderTopColor: theme.border }]}>
        <Text variant="small" color="textSecondary">
          Читать этот чат может кто угодно, писать — только участники.
        </Text>
      </View>
    );
  }

  const submit = () => {
    if (!text.trim() && media.length === 0) return;

    onSend();
  };

  return (
    <View style={[styles.container, { borderTopColor: theme.border }]}>
      <View style={styles.row}>
        <TextInput
          accessibilityLabel="Сообщение"
          placeholder="Сообщение"
          placeholderTextColor={theme.textSecondary}
          value={text}
          multiline
          onChangeText={(value) => {
            onChangeText(value);
            onTyping();
          }}
          style={[styles.field, { color: theme.text, borderColor: theme.border }]}
        />

        <View style={styles.sendWrapper}>
          <Button
            label="Отправить"
            size="sm"
            disabled={!text.trim() && media.length === 0}
            onPress={submit}
          />

          {media.length > 0 ? (
            <View
              style={[
                styles.mediaBadge,
                { backgroundColor: theme.danger, borderColor: theme.background },
              ]}
            >
              <Text variant="caption" color="textInverse">
                {media.length}
              </Text>
            </View>
          ) : null}
        </View>

        {onAttachPress ? (
          // Буква вместо иконки — намеренно: набор иконок ещё не выбран, и
          // дизайн заменит эту кнопку на нормальную, не трогая остальной код.
          <Button label="M" variant="secondary" size="sm" onPress={onAttachPress} />
        ) : null}
      </View>
    </View>
  );
}
