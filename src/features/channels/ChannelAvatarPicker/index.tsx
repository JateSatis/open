import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { styles } from './styles';

import { Text } from '@/components/Text';
import { openMediaSheet } from '@/features/chats/MediaPickerSheet';
import { MediaAvatarSheet } from '@/features/chats/MediaPickerSheet/MediaAvatarSheet';
import type { PreparedAvatar } from '@/features/media';
import { useTheme } from '@/hooks/use-theme';
import { Sizes } from '@/theme';

const SHEET_OWNER = 'avatar:channel';

export type ChannelAvatarPickerProps = {
  /** Уже обрезанное до квадрата фото на устройстве; null — не выбрано. */
  uri: string | null;
  onChange: (uri: string) => void;
  disabled?: boolean;
};

/**
 * Круг выбора аватарки. Тап открывает шит аватарки: фото раскрывается в
 * редактор с кругом будущей аватарки, «Готово» закрывает шит, и фото — уже
 * с правками, квадратное и сжатое — встаёт в круг.
 */
export function ChannelAvatarPicker({ uri, onChange, disabled }: ChannelAvatarPickerProps) {
  const theme = useTheme();
  const [preparing, setPreparing] = useState(false);
  const [failed, setFailed] = useState(false);

  const onDone = useCallback(
    (avatar: Promise<PreparedAvatar>) => {
      setPreparing(true);
      setFailed(false);
      avatar
        .then((prepared) => onChange(prepared.uri))
        .catch(() => setFailed(true))
        .finally(() => setPreparing(false));
    },
    [onChange],
  );

  return (
    <View style={styles.wrap}>
      <Pressable
        testID="channel-avatar-picker"
        accessibilityRole="button"
        accessibilityLabel={uri ? 'Сменить аватарку канала' : 'Выбрать аватарку канала'}
        disabled={disabled || preparing}
        onPress={() => openMediaSheet(SHEET_OWNER)}
        style={[styles.circle, { backgroundColor: theme.backgroundElement }]}
      >
        {preparing ? (
          <ActivityIndicator color={theme.textSecondary} />
        ) : uri ? (
          <Image testID="channel-avatar-preview" source={{ uri }} style={styles.image} />
        ) : (
          <SymbolView
            name={{ ios: 'camera', android: 'photo_camera', web: 'photo_camera' }}
            size={Sizes.channelAvatarPickerIcon}
            tintColor={theme.textSecondary}
          />
        )}
      </Pressable>

      {failed ? (
        <Text variant="small" color="danger">
          Не удалось открыть фото. Выберите другое.
        </Text>
      ) : null}

      <MediaAvatarSheet owner={SHEET_OWNER} onDone={onDone} />
    </View>
  );
}
