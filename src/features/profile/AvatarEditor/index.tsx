import { useState } from 'react';
import { ActivityIndicator, Linking, Pressable, View } from 'react-native';

import { styles } from './styles';

import type { Profile } from '@/api/profile';
import { Avatar } from '@/components/Avatar';
import { LinkButton } from '@/components/LinkButton';
import { OptionsSheet, type SheetOption } from '@/components/OptionsSheet';
import { Text } from '@/components/Text';
import { pickAvatar, type AvatarSource } from '@/features/media';
import { useChangeAvatar } from '@/features/profile/useChangeAvatar';
import { displayNameOf } from '@/features/profile/username';
import { useTheme } from '@/hooks/use-theme';
import { Spacing } from '@/theme';

const AVATAR_SIZE = Spacing.six * 1.5;

type Problem = { message: string; openSettings: boolean };

/** Аватар на экране редактирования: тап — выбор из галереи, камера или удаление. */
export function AvatarEditor({ profile }: { profile: Profile }) {
  const theme = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const change = useChangeAvatar();
  const busy = picking || change.isPending;

  const choose = async (source: AvatarSource) => {
    setProblem(null);
    setPicking(true);

    try {
      const result = await pickAvatar(source);

      if (result.status === 'denied') {
        setProblem({
          message:
            source === 'camera'
              ? 'Нет доступа к камере. Разрешите его в настройках телефона.'
              : 'Нет доступа к фото. Разрешите его в настройках телефона.',
          openSettings: true,
        });
      } else if (result.status === 'picked') {
        change.mutate({ kind: 'set', uri: result.avatar.uri, profile });
      }
    } catch {
      setProblem({ message: 'Не удалось открыть фото. Попробуйте ещё раз.', openSettings: false });
    } finally {
      setPicking(false);
    }
  };

  const options: SheetOption[] = [
    { label: 'Выбрать из галереи', onPress: () => void choose('library') },
    { label: 'Снять фото', onPress: () => void choose('camera') },
    ...(profile.avatarUrl
      ? [
          {
            label: 'Удалить фото',
            destructive: true,
            onPress: () => change.mutate({ kind: 'remove', profile }),
          },
        ]
      : []),
  ];

  const errorText =
    problem?.message ?? (change.error ? 'Не удалось сохранить фото. Попробуйте ещё раз.' : null);

  return (
    <View style={styles.container}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Изменить фото профиля"
        disabled={busy}
        onPress={() => setMenuOpen(true)}
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
        onPress={() => setMenuOpen(true)}
      />

      {errorText ? (
        <Text variant="small" color="danger" style={styles.error}>
          {errorText}
        </Text>
      ) : null}
      {problem?.openSettings ? (
        <LinkButton label="Открыть настройки" onPress={() => void Linking.openSettings()} />
      ) : null}

      <OptionsSheet
        visible={menuOpen}
        title="Фото профиля видно всем"
        options={options}
        onClose={() => setMenuOpen(false)}
      />
    </View>
  );
}
