import { Stack, useNavigation, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';

import { styles } from './styles';
import { describeSaveChannelError, useSaveChannel, type PhotoDraft } from './useSaveChannel';

import type { Channel } from '@/api/channels';
import { Avatar } from '@/components/Avatar';
import { confirm } from '@/components/ConfirmDialog/store';
import { Input } from '@/components/Input';
import { LinkButton } from '@/components/LinkButton';
import { Text } from '@/components/Text';
import {
  CHANNEL_DESCRIPTION_COUNTER_FROM,
  CHANNEL_DESCRIPTION_MAX_LENGTH,
  CHANNEL_TITLE_MAX_LENGTH,
} from '@/features/channels/limits';
import { useChannel } from '@/features/channels/useChannel';
import { DescriptionField } from '@/features/chats/ChatEditScreen/DescriptionField';
import { openMediaSheet } from '@/features/chats/MediaPickerSheet';
import { MediaAvatarSheet } from '@/features/chats/MediaPickerSheet/MediaAvatarSheet';
import { useCurrentUserId } from '@/features/chats/useCurrentUserId';
import { usePreparedAvatar } from '@/features/chats/usePreparedAvatar';
import { validateUsername } from '@/features/profile/username';
import { UsernameField } from '@/features/profile/UsernameField';
import { useUsernameAvailability } from '@/features/profile/useUsernameAvailability';
import { useTheme } from '@/hooks/use-theme';
import { InfoPageSizes, Spacing } from '@/theme';

const SHEET_OWNER = 'avatar:channel-edit';

export type ChannelEditScreenProps = { channelId: string };

/**
 * «Изменить» канала: фото, название, описание и `@имя` — одним сохранением
 * по галочке. Только владелец: остальным карандаш не показывается, а база
 * им откажет.
 */
export function ChannelEditScreen({ channelId }: ChannelEditScreenProps) {
  const { data: channel } = useChannel(channelId);
  const currentUserId = useCurrentUserId();

  if (!channel) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator accessibilityLabel="Загрузка канала" />
      </View>
    );
  }

  if (channel.ownerId === null || channel.ownerId !== currentUserId) {
    return (
      <View style={styles.centered}>
        <Text color="textSecondary">Изменять канал может только его владелец.</Text>
      </View>
    );
  }

  return <ChannelEditForm channel={channel} />;
}

function ChannelEditForm({ channel }: { channel: Channel }) {
  const theme = useTheme();
  const router = useRouter();
  const navigation = useNavigation();
  const currentUserId = useCurrentUserId();
  const save = useSaveChannel(channel, currentUserId);

  const [photo, setPhoto] = useState<PhotoDraft>({ kind: 'keep' });
  const [title, setTitle] = useState(channel.title);
  const [description, setDescription] = useState(channel.description ?? '');
  const [username, setUsername] = useState(channel.username);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const leaving = useRef(false);

  const availability = useUsernameAvailability(username, {
    kind: 'channel',
    ownId: channel.id,
    current: channel.username,
  });

  const onPhotoReady = useCallback((uri: string) => setPhoto({ kind: 'set', uri }), []);
  const prepared = usePreparedAvatar(onPhotoReady);

  const cleanTitle = title.trim();
  const cleanDescription = description.trim();
  const cleanUsername = username.trim();
  const titleChanged = cleanTitle !== channel.title;
  const descriptionChanged = cleanDescription !== (channel.description ?? '');
  const usernameChanged = cleanUsername !== channel.username;
  const photoChanged = photo.kind !== 'keep';
  const dirty = titleChanged || descriptionChanged || usernameChanged || photoChanged;
  // Имя у канала обязательно: пустое, неверное, занятое или ещё не
  // проверенное не сохраняется.
  const usernameInvalid =
    cleanUsername === '' ||
    (usernameChanged &&
      (validateUsername(cleanUsername) !== null ||
        availability.status === 'taken' ||
        availability.status === 'checking'));
  const canSave =
    dirty && cleanTitle !== '' && !usernameInvalid && !saving && !prepared.preparing;

  const submit = useCallback(async () => {
    setError(null);
    setSaving(true);

    try {
      await save({
        title: titleChanged ? cleanTitle : undefined,
        description: descriptionChanged ? cleanDescription || null : undefined,
        username: usernameChanged ? cleanUsername : undefined,
        photo,
      });
      leaving.current = true;
      router.back();
    } catch (failure) {
      setError(describeSaveChannelError(failure));
    } finally {
      setSaving(false);
    }
  }, [
    cleanDescription,
    cleanTitle,
    cleanUsername,
    descriptionChanged,
    photo,
    router,
    save,
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
    photo.kind === 'set' ? photo.uri : photo.kind === 'remove' ? null : channel.avatarUrl;

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
              testID="channel-edit-save"
              accessibilityRole="button"
              accessibilityLabel="Сохранить"
              accessibilityState={{ disabled: !canSave }}
              disabled={!canSave}
              hitSlop={Spacing.three}
              onPress={() => void submit()}
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
        style={[styles.flex, { backgroundColor: theme.background }]}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        bottomOffset={Spacing.six}
      >
        <View style={styles.photo}>
          <Pressable
            testID="channel-edit-photo"
            accessibilityRole="button"
            accessibilityLabel="Фото канала"
            onPress={openSheet}
          >
            <Avatar
              uri={shownPhoto}
              name={cleanTitle || channel.title}
              size={InfoPageSizes.avatar}
            />
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
          testID="channel-edit-title"
          label="Название"
          value={title}
          onChangeText={setTitle}
          maxLength={CHANNEL_TITLE_MAX_LENGTH}
          placeholder="Название канала"
          error={cleanTitle === '' ? 'Без названия канала нет' : undefined}
        />

        <DescriptionField
          value={description}
          onChangeText={setDescription}
          maxLength={CHANNEL_DESCRIPTION_MAX_LENGTH}
          counterFrom={CHANNEL_DESCRIPTION_COUNTER_FROM}
          placeholder="О чём этот канал"
        />

        <UsernameField
          testID="channel-username"
          label="Имя канала"
          kind="channel"
          value={username}
          onChangeText={setUsername}
          availability={availability}
          error={cleanUsername === '' ? 'У канала должно быть имя' : null}
        />
        <Text variant="caption" color="textSecondary">
          По имени канал находят в поиске и открывают по ссылке. Старая ссылка после смены имени
          перестанет работать.
        </Text>

        {error ? (
          <Text testID="channel-edit-error" variant="small" color="danger">
            {error}
          </Text>
        ) : null}
      </KeyboardAwareScrollView>

      <MediaAvatarSheet owner={SHEET_OWNER} onDone={prepared.onDone} />
    </>
  );
}
