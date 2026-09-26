import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Text } from '@/components/Text';
import { PersonPickItem } from '@/features/chats/PersonPickItem';
import { useCreateChat } from '@/features/chats/useCreateChat';
import { useCurrentUserId } from '@/features/chats/useCurrentUserId';
import { useOnlineUsers } from '@/features/chats/useOnlineUsers';
import { usePeople } from '@/features/chats/usePeople';
import { useTheme } from '@/hooks/use-theme';
import { Spacing } from '@/theme';

/**
 * Выбор людей и создание чата. Один выбранный — личный диалог, несколько —
 * группа. Люди, с которыми переписка уже есть, не прячутся: новый чат с тем же
 * человеком допустим, когда в прежнем все приняли заявки.
 */
export default function NewChatScreen() {
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const currentUserId = useCurrentUserId();
  const onlineIds = useOnlineUsers(currentUserId);
  const { people, isLoading, error } = usePeople();
  const [selected, setSelected] = useState<string[]>([]);
  const [title, setTitle] = useState('');

  // replace, а не push: «назад» из нового чата ведёт к списку, а не обратно в выбор.
  const openChat = useCallback((chatId: string) => router.replace(`/chats/${chatId}`), [router]);
  const { isCreating, problem, create } = useCreateChat(openChat);

  const toggle = useCallback((personId: string) => {
    setSelected((current) =>
      current.includes(personId) ? current.filter((id) => id !== personId) : [...current, personId],
    );
  }, []);

  const createLabel =
    selected.length === 0
      ? 'Выберите, кого позвать'
      : selected.length === 1
        ? 'Позвать в диалог'
        : `Позвать в группу (${selected.length})`;

  return (
    <KeyboardAvoidingView
      behavior="padding"
      style={[styles.flex, { backgroundColor: theme.background }]}
    >
      <View style={styles.titleField}>
        <Input
          accessibilityLabel="Название чата"
          placeholder="Название — необязательно"
          value={title}
          onChangeText={setTitle}
          maxLength={80}
        />
      </View>

      {isLoading ? (
        <ActivityIndicator accessibilityLabel="Загрузка пользователей" />
      ) : (
        <FlatList
          style={styles.flex}
          contentContainerStyle={styles.list}
          data={people}
          keyExtractor={(person) => person.id}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <PersonPickItem
              person={item}
              isSelected={selected.includes(item.id)}
              isOnline={onlineIds.has(item.id)}
              onToggle={toggle}
            />
          )}
          ListEmptyComponent={
            error ? null : <Text color="textSecondary">Позвать пока некого: в Open вы первый.</Text>
          }
        />
      )}

      <View
        style={[
          styles.footer,
          { borderTopColor: theme.border, paddingBottom: Math.max(insets.bottom, Spacing.two) },
        ]}
      >
        {error ? <Text color="danger">{error}</Text> : null}

        {problem?.kind === 'duplicate' ? (
          <View style={styles.duplicate}>
            <Text variant="small" color="textSecondary">
              Вы уже позвали этих людей, и ответили ещё не все. Новый чат с ними можно будет
              создать, когда все примут заявки.
            </Text>
            <Button
              label="Открыть тот чат"
              variant="secondary"
              onPress={() => openChat(problem.chatId)}
            />
          </View>
        ) : null}

        {problem?.kind === 'failed' && problem.message ? (
          <Text variant="small" color="danger">
            {problem.message}
          </Text>
        ) : null}

        <Button
          label={createLabel}
          disabled={selected.length === 0}
          loading={isCreating}
          onPress={() => create({ inviteeIds: selected, title })}
        />

        <Text variant="caption" color="textSecondary">
          Чат публичный: прочитать его сможет кто угодно.
        </Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  titleField: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.two,
  },
  list: {
    paddingHorizontal: Spacing.three,
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    gap: Spacing.two,
  },
  duplicate: {
    gap: Spacing.two,
  },
});
