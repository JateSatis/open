import { StyleSheet, View } from 'react-native';

import { Input } from '@/components/Input';
import { Text } from '@/components/Text';
import {
  GROUP_DESCRIPTION_COUNTER_FROM,
  GROUP_DESCRIPTION_MAX_LENGTH,
} from '@/features/chats/limits';
import { Spacing } from '@/theme';

export type DescriptionFieldProps = {
  value: string;
  onChangeText: (value: string) => void;
  /** Пределы и подсказка — по умолчанию группы; канал передаёт свои. */
  maxLength?: number;
  counterFrom?: number;
  placeholder?: string;
};

/** Описание группы или канала: многострочное, у предела — сколько символов осталось. */
export function DescriptionField({
  value,
  onChangeText,
  maxLength = GROUP_DESCRIPTION_MAX_LENGTH,
  counterFrom = GROUP_DESCRIPTION_COUNTER_FROM,
  placeholder = 'О чём эта группа',
}: DescriptionFieldProps) {
  const left = maxLength - value.length;

  return (
    <View style={styles.field}>
      <Input
        testID="chat-edit-description"
        label="Описание (необязательно)"
        value={value}
        onChangeText={onChangeText}
        maxLength={maxLength}
        multiline
        style={styles.input}
        placeholder={placeholder}
      />
      {left <= counterFrom ? (
        <Text
          testID="chat-edit-description-left"
          variant="caption"
          color={left === 0 ? 'danger' : 'textSecondary'}
          style={styles.counter}
        >
          {left}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    gap: Spacing.one,
  },
  input: {
    minHeight: Spacing.six + Spacing.five,
    textAlignVertical: 'top',
  },
  counter: {
    alignSelf: 'flex-end',
  },
});
