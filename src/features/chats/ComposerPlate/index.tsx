import { Image } from 'expo-image';
import { Pressable, View } from 'react-native';

import { styles } from './styles';

import { Text } from '@/components/Text';
import { useTheme } from '@/hooks/use-theme';
import { Spacing } from '@/theme';

export type ComposerPlateProps = {
  /** «В ответ Марина», «Переслать 3 сообщения». */
  title: string;
  /** Что именно: фрагмент текста, «Фото», имена авторов. */
  snippet: string;
  thumbnailUrl?: string | null;
  /** Крестик: режим снимается, текст в поле остаётся. */
  onClose: () => void;
  closeLabel: string;
};

/**
 * Плашка над полем ввода: к чему относится то, что сейчас будет отправлено.
 * Одна на все режимы поля — ответ, пересылку, а дальше и правку: режимы
 * отличаются только словами.
 */
export function ComposerPlate({
  title,
  snippet,
  thumbnailUrl,
  onClose,
  closeLabel,
}: ComposerPlateProps) {
  const theme = useTheme();

  return (
    <View testID="composer-plate" style={styles.plate}>
      <View style={[styles.accent, { backgroundColor: theme.primary }]} />

      {thumbnailUrl ? (
        <Image
          source={{ uri: thumbnailUrl }}
          style={[styles.thumbnail, { backgroundColor: theme.backgroundSelected }]}
          contentFit="cover"
          accessibilityIgnoresInvertColors
        />
      ) : null}

      <View style={styles.body}>
        <Text variant="smallBold" color="primary" numberOfLines={1}>
          {title}
        </Text>
        <Text variant="small" numberOfLines={1}>
          {snippet}
        </Text>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={closeLabel}
        hitSlop={Spacing.two}
        onPress={onClose}
        style={styles.close}
      >
        <Text color="textSecondary">✕</Text>
      </Pressable>
    </View>
  );
}
