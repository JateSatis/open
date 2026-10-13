import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { styles } from './styles';

import type { Profile } from '@/api/profile';
import { Avatar } from '@/components/Avatar';
import { LinkButton } from '@/components/LinkButton';
import { Text } from '@/components/Text';
import { openMediaSheet } from '@/features/chats/MediaPickerSheet';
import { MediaAvatarSheet } from '@/features/chats/MediaPickerSheet/MediaAvatarSheet';
import type { PreparedAvatar } from '@/features/media';
import { useChangeAvatar } from '@/features/profile/useChangeAvatar';
import { displayNameOf } from '@/features/profile/username';
import { useTheme } from '@/hooks/use-theme';
import { Spacing } from '@/theme';

const AVATAR_SIZE = Spacing.six * 1.5;

/**
 * Аватар на экране редактирования. Тап по нему или по ссылке под ним сразу
 * открывает шит аватарки; «Удалить фото» — отдельной ссылкой, когда есть что
 * удалять. Под ссылками честно сказано, что фото видно всем.
 */
export function AvatarEditor({ profile }: { profile: Profile }) {
  const theme = useTheme();
  const [preparing, setPreparing] = useState(false);
  const [prepareFailed, setPrepareFailed] = useState(false);
  const change = useChangeAvatar();
  const { mutate, reset } = change;
  const busy = preparing || change.isPending;

  const onDone = useCallback(
    (avatar: Promise<PreparedAvatar>) => {
      setPrepareFailed(false);
      setPreparing(true);
      reset();
      avatar
        .then((prepared) => mutate({ kind: 'set', uri: prepared.uri, profile }))
        .catch(() => setPrepareFailed(true))
        .finally(() => setPreparing(false));
    },
    [mutate, profile, reset],
  );

  const open = () => {
    setPrepareFailed(false);
    openMediaSheet('avatar');
  };

  const errorText = prepareFailed
    ? 'Не удалось открыть фото. Попробуйте ещё раз.'
    : change.error
      ? 'Не удалось сохранить фото. Проверьте интернет и попробуйте ещё раз.'
      : null;

  return (
    <View style={styles.container}>
      <Pressable
        testID="profile-avatar-edit"
        accessibilityRole="button"
        accessibilityLabel="Изменить фото профиля"
        disabled={busy}
        onPress={open}
      >
        <Avatar uri={profile.avatarUrl} name={displayNameOf(profile)} size={AVATAR_SIZE} />
        {busy ? (
          <View style={[styles.busy, { backgroundColor: theme.mediaScrim }]}>
            <ActivityIndicator color={theme.textOnMedia} accessibilityLabel="Сохранение фото" />
          </View>
        ) : null}
      </Pressable>

      <LinkButton
        label={profile.avatarUrl ? 'Изменить фото' : 'Добавить фото'}
        disabled={busy}
        onPress={open}
      />
      {profile.avatarUrl ? (
        <LinkButton
          label="Удалить фото"
          color="danger"
          disabled={busy}
          onPress={() => change.mutate({ kind: 'remove', profile })}
        />
      ) : null}

      <Text variant="caption" color="textSecondary" style={styles.note}>
        Фото профиля видно всем
      </Text>

      {errorText ? (
        <Text variant="small" color="danger" style={styles.error}>
          {errorText}
        </Text>
      ) : null}

      <MediaAvatarSheet onDone={onDone} />
    </View>
  );
}
