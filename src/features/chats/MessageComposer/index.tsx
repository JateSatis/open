import { TextInput, View } from 'react-native';

import { styles } from './styles';

import { Button } from '@/components/Button';
import { Text } from '@/components/Text';
import { perfMark, perfMarkStart } from '@/features/media/perf';
import { useSelectionCount } from '@/features/media/selectionStore';
import { useTheme } from '@/hooks/use-theme';

export type MessageComposerProps = {
  text: string;
  onChangeText: (text: string) => void;
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
  /**
   * Касание и уход пальца с кнопки медиа. Шит открывает отпускание
   * (`onAttachPress`), а касание только готовит его — пока палец на кнопке,
   * успевает родиться окно шита.
   */
  onAttachPressIn?: () => void;
  onAttachPressOut?: () => void;
};

export function MessageComposer({
  text,
  onChangeText,
  onSend,
  onTyping,
  canSend,
  onAttachPress,
  onAttachPressIn,
  onAttachPressOut,
}: MessageComposerProps) {
  const theme = useTheme();
  // Счётчик берётся из стора выбора, а не приходит пропом: иначе выбор файла
  // перерисовывал бы весь экран чата ради цифры в кружке.
  const mediaCount = useSelectionCount();

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
    if (!text.trim() && mediaCount === 0) return;

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
            disabled={!text.trim() && mediaCount === 0}
            onPress={submit}
          />

          {mediaCount > 0 ? (
            <View
              style={[
                styles.mediaBadge,
                { backgroundColor: theme.danger, borderColor: theme.background },
              ]}
            >
              <Text variant="caption" color="textInverse">
                {mediaCount}
              </Text>
            </View>
          ) : null}
        </View>

        {onAttachPress ? (
          // Буква вместо иконки — намеренно: набор иконок ещё не выбран, и
          // дизайн заменит эту кнопку на нормальную, не трогая остальной код.
          <Button
            label="M"
            variant="secondary"
            size="sm"
            onPressIn={() => {
              perfMarkStart('M: касание');
              onAttachPressIn?.();
            }}
            onPressOut={onAttachPressOut}
            onPress={() => {
              perfMark('M: отпускание');
              onAttachPress();
            }}
          />
        ) : null}
      </View>
    </View>
  );
}
