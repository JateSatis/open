import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { styles } from './styles';

import { Text } from '@/components/Text';
import { MediaPickSheet, openMediaSheet } from '@/features/chats/MediaPickerSheet';
import { prepareAvatar, resolveAssetUri, type MediaLibraryItem } from '@/features/media';
import { useTheme } from '@/hooks/use-theme';
import { Sizes } from '@/theme';

/** Аватарка канала — только фото: видео в сетке видны, но не выбираются. */
const acceptsPhoto = (asset: MediaLibraryItem) => asset.kind === 'photo';

export type ChannelAvatarPickerProps = {
  /** Уже обрезанное до квадрата фото на устройстве; null — не выбрано. */
  uri: string | null;
  onChange: (uri: string) => void;
  disabled?: boolean;
};

/**
 * Круг выбора аватарки. Тап открывает шит медиа в режиме одного фото; после
 * выбора шит закрывается сам, а фото обрезается до центрального квадрата —
 * редактора обрезки нет.
 */
export function ChannelAvatarPicker({ uri, onChange, disabled }: ChannelAvatarPickerProps) {
  const theme = useTheme();
  const [preparing, setPreparing] = useState(false);
  const [failed, setFailed] = useState(false);

  const onPick = useCallback(
    (asset: MediaLibraryItem) => {
      setPreparing(true);
      setFailed(false);
      // Размеры из медиатеки не учитывают поворот снимка — обрезка берёт их
      // у самой картинки.
      resolveAssetUri(asset.id)
        .then((source) => prepareAvatar(source, null, null))
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
        onPress={() => openMediaSheet('pick')}
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

      <MediaPickSheet accepts={acceptsPhoto} onPick={onPick} />
    </View>
  );
}
