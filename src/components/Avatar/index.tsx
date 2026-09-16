import { Image } from 'expo-image';
import { View } from 'react-native';

import { styles } from './styles';

import { Text } from '@/components/Text';
import { useTheme } from '@/hooks/use-theme';

export type AvatarProps = {
  uri?: string | null;
  /** Full display name, used to derive the fallback initial when there is no image. */
  name: string;
  size?: number;
};

export function Avatar({ uri, name, size = 40 }: AvatarProps) {
  const theme = useTheme();
  const dimension = { width: size, height: size, borderRadius: size / 2 };

  if (uri) {
    return (
      <Image
        source={{ uri }}
        accessibilityLabel={name}
        style={[styles.image, dimension]}
      />
    );
  }

  return (
    <View style={[styles.fallback, dimension, { backgroundColor: theme.backgroundSelected }]}>
      <Text variant="bodyBold" accessibilityLabel={name}>
        {name.trim().charAt(0).toUpperCase() || '?'}
      </Text>
    </View>
  );
}
