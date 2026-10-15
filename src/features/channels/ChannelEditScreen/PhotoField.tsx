import { ActivityIndicator, Pressable, View } from 'react-native';

import { styles } from './styles';

import { Avatar } from '@/components/Avatar';
import { LinkButton } from '@/components/LinkButton';
import { Text } from '@/components/Text';
import { useTheme } from '@/hooks/use-theme';
import { InfoPageSizes } from '@/theme';

export type PhotoFieldProps = {
  /** Что показать: черновик, текущее фото или ничего. */
  uri: string | null;
  name: string;
  preparing: boolean;
  failed: boolean;
  onPick: () => void;
  onRemove: () => void;
};

/** Фото канала в «Изменить»: аватарка, «Установить новое фото», «Удалить фото». */
export function PhotoField({ uri, name, preparing, failed, onPick, onRemove }: PhotoFieldProps) {
  const theme = useTheme();

  return (
    <View style={styles.photo}>
      <Pressable
        testID="channel-edit-photo"
        accessibilityRole="button"
        accessibilityLabel="Фото канала"
        onPress={onPick}
      >
        <Avatar uri={uri} name={name} size={InfoPageSizes.avatar} />
        {preparing ? (
          <View style={[styles.busy, { backgroundColor: theme.mediaScrim }]}>
            <ActivityIndicator color={theme.textOnMedia} />
          </View>
        ) : null}
      </Pressable>
      <LinkButton label="Установить новое фото" onPress={onPick} />
      {uri ? <LinkButton label="Удалить фото" color="danger" onPress={onRemove} /> : null}
      {failed ? (
        <Text variant="small" color="danger">
          Не удалось открыть фото. Попробуйте ещё раз.
        </Text>
      ) : null}
    </View>
  );
}
