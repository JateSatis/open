import { Image } from 'expo-image';
import { View } from 'react-native';

import { styles } from './styles';

import { Text } from '@/components/Text';
import { initialOf } from '@/lib/initialOf';
import { useTheme } from '@/hooks/use-theme';
import { Sizes } from '@/theme';

export type AvatarProps = {
  uri?: string | null;
  /** Full display name, used to derive the fallback initial when there is no image. */
  name: string;
  size?: number;
};

function largeLetter(size: number) {
  return { fontSize: size * 0.4, lineHeight: size * 0.5 };
}

export function Avatar({ uri, name, size = 40 }: AvatarProps) {
  const theme = useTheme();
  const dimension = { width: size, height: size, borderRadius: size / 2 };

  if (uri) {
    return <Image source={{ uri }} accessibilityLabel={name} style={[styles.image, dimension]} />;
  }

  return (
    <View style={[styles.fallback, dimension, { backgroundColor: theme.backgroundSelected }]}>
      {/* Мелкий аватар (под реакцией) — буква мельче, иначе вылезает за круг. */}
      <Text
        variant={size <= Sizes.reactionAvatar ? 'meta' : 'bodyBold'}
        // Крупная аватарка (шапка страницы) — буква по размеру круга, а не строчная.
        style={size >= Sizes.avatarLargeLetter ? largeLetter(size) : undefined}
        accessibilityLabel={name}
      >
        {initialOf(name)}
      </Text>
    </View>
  );
}
