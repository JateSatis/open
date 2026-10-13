import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { styles } from './styles';

import { Avatar } from '@/components/Avatar';
import { LinkButton } from '@/components/LinkButton';
import { Text } from '@/components/Text';
import { openMediaSheet } from '@/features/chats/MediaPickerSheet';
import { MediaAvatarSheet } from '@/features/chats/MediaPickerSheet/MediaAvatarSheet';
import { useChangeGroupAvatar } from '@/features/chats/useChangeGroupAvatar';
import type { PreparedAvatar } from '@/features/media';
import { useTheme } from '@/hooks/use-theme';
import { isNetworkError } from '@/lib/network';

const SHEET_OWNER = 'avatar:group';

export type GroupAvatarEditorProps = {
  chatId: string;
  userId: string | null;
  avatarUrl: string | null;
  /** Название группы — буква в круге, пока фото нет. */
  name: string;
  size: number;
};

/**
 * Фото группы на «О чате» для участника. Тап по нему или по ссылке под ним
 * сразу открывает шит аватарки; «Удалить фото» — отдельной ссылкой, когда
 * есть что удалять. Постороннему этот компонент не показывается.
 */
export function GroupAvatarEditor({ chatId, userId, avatarUrl, name, size }: GroupAvatarEditorProps) {
  const theme = useTheme();
  const [preparing, setPreparing] = useState(false);
  const [prepareFailed, setPrepareFailed] = useState(false);
  const change = useChangeGroupAvatar(chatId, userId);
  const { mutate, reset } = change;
  const busy = preparing || change.isPending;

  const onDone = useCallback(
    (avatar: Promise<PreparedAvatar>) => {
      setPrepareFailed(false);
      setPreparing(true);
      reset();
      avatar
        .then((prepared) => mutate({ kind: 'set', uri: prepared.uri }))
        .catch(() => setPrepareFailed(true))
        .finally(() => setPreparing(false));
    },
    [mutate, reset],
  );

  const open = () => {
    setPrepareFailed(false);
    openMediaSheet(SHEET_OWNER);
  };

  const errorText = prepareFailed
    ? 'Не удалось открыть фото. Попробуйте ещё раз.'
    : change.error
      ? isNetworkError(change.error)
        ? 'Нет связи. Проверьте интернет и попробуйте ещё раз.'
        : 'Не удалось сохранить фото. Попробуйте ещё раз.'
      : null;

  return (
    <View style={styles.container}>
      <Pressable
        testID="group-avatar-edit"
        accessibilityRole="button"
        accessibilityLabel="Изменить фото группы"
        disabled={busy}
        onPress={open}
      >
        <Avatar uri={avatarUrl} name={name} size={size} />
        {busy ? (
          <View style={[styles.busy, { backgroundColor: theme.mediaScrim }]}>
            <ActivityIndicator color={theme.textOnMedia} accessibilityLabel="Сохранение фото" />
          </View>
        ) : null}
      </Pressable>

      <LinkButton
        label={avatarUrl ? 'Изменить фото' : 'Добавить фото'}
        disabled={busy}
        onPress={open}
      />
      {avatarUrl ? (
        <LinkButton
          label="Удалить фото"
          color="danger"
          disabled={busy}
          onPress={() => {
            setPrepareFailed(false);
            change.mutate({ kind: 'remove' });
          }}
        />
      ) : null}

      {errorText ? (
        <Text variant="small" color="danger" style={styles.error}>
          {errorText}
        </Text>
      ) : null}

      <MediaAvatarSheet owner={SHEET_OWNER} onDone={onDone} />
    </View>
  );
}
