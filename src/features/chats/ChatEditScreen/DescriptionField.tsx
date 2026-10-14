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
};

/** Описание группы: многострочное, у предела — сколько символов осталось. */
export function DescriptionField({ value, onChangeText }: DescriptionFieldProps) {
  const left = GROUP_DESCRIPTION_MAX_LENGTH - value.length;

  return (
    <View style={styles.field}>
      <Input
        testID="chat-edit-description"
        label="Описание (необязательно)"
        value={value}
        onChangeText={onChangeText}
        maxLength={GROUP_DESCRIPTION_MAX_LENGTH}
        multiline
        style={styles.input}
        placeholder="О чём эта группа"
      />
      {left <= GROUP_DESCRIPTION_COUNTER_FROM ? (
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
