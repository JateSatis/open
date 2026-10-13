import { useState } from 'react';
import { View } from 'react-native';

import { styles } from './styles';

import { Button } from '@/components/Button';
import { Text } from '@/components/Text';
import {
  describeSetChatUsernameError,
  useSetChatUsername,
} from '@/features/chats/useSetChatUsername';
import { validateUsername } from '@/features/profile/username';
import { UsernameField } from '@/features/profile/UsernameField';
import { useUsernameAvailability } from '@/features/profile/useUsernameAvailability';

export type ChatUsernameFormProps = {
  chatId: string;
  /** Имя, которое стоит у группы сейчас. */
  current: string | null;
};

/**
 * `@имя` группы для участника: задать, сменить, стереть. Сохраняется только
 * изменённое; занятость спрашиваем на лету, а окончательно решает база.
 */
export function ChatUsernameForm({ chatId, current }: ChatUsernameFormProps) {
  const [value, setValue] = useState(current ?? '');
  const availability = useUsernameAvailability(value, {
    kind: 'group',
    ownId: chatId,
    current,
  });
  const save = useSetChatUsername(chatId);

  const username = value.trim();
  const changed = username !== (current ?? '');
  const canSave =
    changed &&
    validateUsername(username) === null &&
    availability.status !== 'taken' &&
    availability.status !== 'checking';

  const onChange = (text: string) => {
    if (save.error) save.reset();
    setValue(text);
  };

  return (
    <View style={styles.container}>
      <UsernameField
        testID="chat-username"
        kind="group"
        value={value}
        onChangeText={onChange}
        availability={availability}
        error={save.error ? describeSetChatUsernameError(save.error) : null}
      />

      <Text variant="caption" color="textSecondary">
        Имя группы может задать и поменять любой участник. Оставьте пустым, чтобы убрать.
      </Text>

      <Button
        testID="chat-username-save"
        label="Сохранить"
        disabled={!canSave}
        loading={save.isPending}
        onPress={() => save.mutate(username || null)}
      />
    </View>
  );
}
