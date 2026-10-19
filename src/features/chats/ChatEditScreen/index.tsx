import { useQueryClient } from '@tanstack/react-query';
import { Stack, useNavigation, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';

import { DescriptionField } from './DescriptionField';
import { styles } from './styles';

import { setChatTitle } from '@/api/chatInfo';
import type { ChatSummary } from '@/api/chats';
import { setChatDescription } from '@/api/groups';
import { Avatar } from '@/components/Avatar';
import { confirm } from '@/components/ConfirmDialog/store';
import { Input } from '@/components/Input';
import { LinkButton } from '@/components/LinkButton';
import { Text } from '@/components/Text';
import { chatTitle } from '@/features/chats/chatDisplay';
import { chatsQueryKey } from '@/features/chats/chatsKey';
import { GROUP_TITLE_MAX_LENGTH } from '@/features/chats/limits';
import { openMediaSheet } from '@/features/chats/MediaPickerSheet';
import { MediaAvatarSheet } from '@/features/chats/MediaPickerSheet/MediaAvatarSheet';
import { useChangeGroupAvatar } from '@/features/chats/useChangeGroupAvatar';
import { chatQueryKey, useChat } from '@/features/chats/useChat';
import { useCurrentUserId } from '@/features/chats/useCurrentUserId';
import { usePreparedAvatar } from '@/features/chats/usePreparedAvatar';
import {
  describeSetChatUsernameError,
  useSetChatUsername,
} from '@/features/chats/useSetChatUsername';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { validateUsername } from '@/features/profile/username';
import { UsernameField } from '@/features/profile/UsernameField';
import { useUsernameAvailability } from '@/features/profile/useUsernameAvailability';
import { useTheme } from '@/hooks/use-theme';
import { withDeadline } from '@/lib/deadline';
import { isNetworkError } from '@/lib/network';
import { InfoPageSizes, Spacing } from '@/theme';

const SHEET_OWNER = 'avatar:group-edit';
/** Дольше этого смену названия и описания не ждём — дальше это потеря связи. */
const TEXT_DEADLINE_MS = 20_000;

/** Фото в черновике: не трогали, новое (готовый файл) или убрать. */
type PhotoDraft = { kind: 'keep' } | { kind: 'set'; uri: string } | { kind: 'remove' };

export type ChatEditScreenProps = { chatId: string };

/**
 * «Изменить» группы: фото, название, описание и `@имя` — одним сохранением
 * по галочке. Только владелец: остальным карандаш не показывается, а база
 * им откажет.
 */
export function ChatEditScreen({ chatId }: ChatEditScreenProps) {
  const { chat } = useChat(chatId);
  const currentUserId = useCurrentUserId();

  if (!chat) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator accessibilityLabel="Загрузка чата" />
      </View>
    );
  }

  if (chat.ownerId === null || chat.ownerId !== currentUserId) {
    return (
      <View style={styles.centered}>
        <Text color="textSecondary">Изменять группу может только её владелец.</Text>
      </View>
    );
  }

  return <ChatEditForm chat={chat} />;
}

function ChatEditForm({ chat }: { chat: ChatSummary }) {
  // Форма доходит до края окна: панели вкладок под экраном нет.
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const router = useRouter();
  const navigation = useNavigation();
  const queryClient = useQueryClient();
  const currentUserId = useCurrentUserId();

  const [photo, setPhoto] = useState<PhotoDraft>({ kind: 'keep' });
  const [username, setUsername] = useState(chat.username ?? '');
  const [title, setTitle] = useState(chat.title ?? '');
  const [description, setDescription] = useState(chat.description ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const leaving = useRef(false);

  const availability = useUsernameAvailability(username, {
    kind: 'group',
    ownId: chat.id,
    current: chat.username,
  });
  const saveUsername = useSetChatUsername(chat.id);
  const changePhoto = useChangeGroupAvatar(chat.id, currentUserId);

  const onPhotoReady = useCallback((uri: string) => setPhoto({ kind: 'set', uri }), []);
  const prepared = usePreparedAvatar(onPhotoReady);

  const cleanUsername = username.trim();
  const cleanTitle = title.trim();
  const cleanDescription = description.trim();
  const usernameChanged = cleanUsername !== (chat.username ?? '');
  const titleChanged = cleanTitle !== (chat.title ?? '');
  const descriptionChanged = cleanDescription !== (chat.description ?? '');
  const photoChanged = photo.kind !== 'keep';
  const dirty = usernameChanged || titleChanged || descriptionChanged || photoChanged;
  const usernameInvalid =
    usernameChanged &&
    (validateUsername(cleanUsername) !== null ||
      availability.status === 'taken' ||
      availability.status === 'checking');
  const canSave = dirty && !usernameInvalid && !saving && !prepared.preparing;

  const save = useCallback(async () => {
    setError(null);
    setSaving(true);

    try {
      if (titleChanged) {
        await withDeadline(setChatTitle(chat.id, cleanTitle || null), TEXT_DEADLINE_MS);
        queryClient.setQueryData<ChatSummary>(chatQueryKey(chat.id), (current) =>
          current ? { ...current, title: cleanTitle || null } : current,
        );
      }

      if (descriptionChanged) {
        await withDeadline(setChatDescription(chat.id, cleanDescription || null), TEXT_DEADLINE_MS);
        // Страница под этим экраном показывает новое описание сразу, не
        // дожидаясь перечитывания.
        queryClient.setQueryData<ChatSummary>(chatQueryKey(chat.id), (current) =>
          current ? { ...current, description: cleanDescription || null } : current,
        );
      }

      if (usernameChanged) await saveUsername.mutateAsync(cleanUsername || null);

      if (photo.kind === 'set') await changePhoto.mutateAsync({ kind: 'set', uri: photo.uri });
      if (photo.kind === 'remove') await changePhoto.mutateAsync({ kind: 'remove' });

      void queryClient.invalidateQueries({ queryKey: chatQueryKey(chat.id), exact: true });
      void queryClient.invalidateQueries({ queryKey: chatsQueryKey });
      leaving.current = true;
      router.back();
    } catch (failure) {
      setError(
        isNetworkError(failure)
          ? 'Нет связи. Проверьте интернет и попробуйте ещё раз.'
          : describeSetChatUsernameError(failure),
      );
    } finally {
      setSaving(false);
    }
  }, [
    changePhoto,
    chat.id,
    cleanDescription,
    cleanTitle,
    cleanUsername,
    descriptionChanged,
    photo,
    queryClient,
    router,
    saveUsername,
    titleChanged,
    usernameChanged,
  ]);

  // Уход с несохранённым — только после вопроса.
  useEffect(
    () =>
      navigation.addListener('beforeRemove', (event) => {
        if (!dirty || leaving.current) return;

        event.preventDefault();
        void confirm({
          title: 'Отменить изменения?',
          message: 'Новое фото, название, описание и имя не сохранятся.',
          confirmLabel: 'Выйти',
          cancelLabel: 'Остаться',
          destructive: true,
        }).then((confirmed) => {
          if (!confirmed) return;

          leaving.current = true;
          navigation.dispatch(event.data.action);
        });
      }),
    [dirty, navigation],
  );

  const shownPhoto =
    photo.kind === 'set' ? photo.uri : photo.kind === 'remove' ? null : chat.avatarUrl;
  const name = cleanTitle || chatTitle(chat, currentUserId);

  const openSheet = () => {
    prepared.clearFailed();
    openMediaSheet(SHEET_OWNER);
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Изменить',
          headerRight: () => (
            <Pressable
              testID="chat-edit-save"
              accessibilityRole="button"
              accessibilityLabel="Сохранить"
              accessibilityState={{ disabled: !canSave }}
              disabled={!canSave}
              hitSlop={Spacing.three}
              onPress={() => void save()}
            >
              {saving ? (
                <ActivityIndicator accessibilityLabel="Сохранение" />
              ) : (
                <SymbolView
                  name={{ ios: 'checkmark', android: 'check', web: 'check' }}
                  size={InfoPageSizes.barIcon}
                  tintColor={canSave ? theme.primary : theme.textSecondary}
                />
              )}
            </Pressable>
          ),
        }}
      />
      <KeyboardAwareScrollView
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        style={[styles.flex, { backgroundColor: theme.background }]}
        contentContainerStyle={[styles.content, { paddingBottom: Spacing.four + insets.bottom }]}
        keyboardShouldPersistTaps="handled"
        bottomOffset={Spacing.six}
      >
        <View style={styles.photo}>
          <Pressable
            testID="chat-edit-photo"
            accessibilityRole="button"
            accessibilityLabel="Фото группы"
            onPress={openSheet}
          >
            <Avatar uri={shownPhoto} name={name} size={InfoPageSizes.avatar} />
            {prepared.preparing ? (
              <View style={[styles.busy, { backgroundColor: theme.mediaScrim }]}>
                <ActivityIndicator color={theme.textOnMedia} />
              </View>
            ) : null}
          </Pressable>
          <LinkButton label="Установить новое фото" onPress={openSheet} />
          {shownPhoto ? (
            <LinkButton
              label="Удалить фото"
              color="danger"
              onPress={() => setPhoto({ kind: 'remove' })}
            />
          ) : null}
          {prepared.failed ? (
            <Text variant="small" color="danger">
              Не удалось открыть фото. Попробуйте ещё раз.
            </Text>
          ) : null}
        </View>

        <Input
          testID="chat-edit-title"
          label="Название"
          value={title}
          onChangeText={setTitle}
          maxLength={GROUP_TITLE_MAX_LENGTH}
          placeholder="Групповой чат"
        />

        <DescriptionField value={description} onChangeText={setDescription} />

        <UsernameField
          testID="chat-username"
          label="Имя группы"
          kind="group"
          value={username}
          onChangeText={setUsername}
          availability={availability}
        />
        <Text variant="caption" color="textSecondary">
          По имени группу находят в поиске. Оставьте пустым, чтобы убрать.
        </Text>

        {error ? (
          <Text testID="chat-edit-error" variant="small" color="danger">
            {error}
          </Text>
        ) : null}
      </KeyboardAwareScrollView>

      <MediaAvatarSheet owner={SHEET_OWNER} onDone={prepared.onDone} />
    </>
  );
}
