import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { useEffect } from 'react';
import { ActivityIndicator, Keyboard, Pressable, View } from 'react-native';

import { styles } from './styles';

import { Text } from '@/components/Text';
import { openMediaSheet } from '@/features/chats/MediaPickerSheet';
import { MediaAvatarSheet } from '@/features/chats/MediaPickerSheet/MediaAvatarSheet';
import { usePreparedAvatar } from '@/features/chats/usePreparedAvatar';
import { showNotice } from '@/features/notifications/alertsStore';
import { useTheme } from '@/hooks/use-theme';
import { Opacity, Sizes } from '@/theme';

const FAILED_TEXT = 'Не удалось открыть фото. Выберите другое.';

export type AvatarPickerProps = {
  /** Хозяин шита (`avatar:<имя>`): у каждой формы свой. */
  owner: `avatar:${string}`;
  /** Уже обрезанное до квадрата фото на устройстве; null — не выбрано. */
  uri: string | null;
  onChange: (uri: string) => void;
  /** Подписи для чтения с экрана: пустой круг и круг с фото. */
  labels: { pick: string; change: string };
  testID?: string;
  /** Не нажимается (идёт создание). */
  disabled?: boolean;
  /** Притушен и не нажимается, но фото в нём видно: сейчас аватарка неприменима. */
  idle?: boolean;
  /** Маленький круг рядом с полем ввода вместо большого над формой. */
  compact?: boolean;
};

/**
 * Круг выбора аватарки в форме создания. Тап открывает шит аватарки: фото
 * раскрывается в редактор с кругом будущей аватарки, «Готово» закрывает шит,
 * и фото — уже с правками, квадратное и сжатое — встаёт в круг.
 */
export function AvatarPicker({
  owner,
  uri,
  onChange,
  labels,
  testID,
  disabled,
  idle,
  compact,
}: AvatarPickerProps) {
  const theme = useTheme();
  const { preparing, failed, onDone } = usePreparedAvatar(onChange);

  // Маленький круг стоит в строке рядом с полем: текст под ним распёр бы
  // строку и сжал поле. Там сбой говорит всплывашка.
  useEffect(() => {
    if (failed && compact) showNotice(FAILED_TEXT, 'error');
  }, [compact, failed]);

  return (
    <View style={styles.wrap}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={uri ? labels.change : labels.pick}
        accessibilityState={{ disabled: Boolean(disabled || idle) }}
        disabled={disabled || idle || preparing}
        onPress={() => {
          // Шит закрывает поле ввода — клавиатура под ним не нужна и после него не вернётся.
          Keyboard.dismiss();
          openMediaSheet(owner);
        }}
        style={[
          compact ? styles.compact : styles.circle,
          { backgroundColor: theme.backgroundElement },
          idle && { opacity: Opacity.avatarPickerIdle },
        ]}
      >
        {preparing ? (
          <ActivityIndicator color={theme.textSecondary} />
        ) : uri ? (
          <Image
            testID={testID ? `${testID}-preview` : undefined}
            source={{ uri }}
            style={styles.image}
          />
        ) : (
          <SymbolView
            name={{ ios: 'camera', android: 'photo_camera', web: 'photo_camera' }}
            size={compact ? Sizes.avatarPickerCompactIcon : Sizes.avatarPickerIcon}
            tintColor={theme.textSecondary}
          />
        )}
      </Pressable>

      {failed && !compact ? (
        <Text variant="small" color="danger">
          {FAILED_TEXT}
        </Text>
      ) : null}

      <MediaAvatarSheet owner={owner} onDone={onDone} />
    </View>
  );
}
