import { View } from 'react-native';

import { styles } from './styles';

import { Avatar } from '@/components/Avatar';
import { useTheme } from '@/hooks/use-theme';
import { Sizes } from '@/theme';

export type AvatarPairPerson = { uri: string | null; name: string };

export type AvatarPairProps = {
  first: AvatarPairPerson;
  second: AvatarPairPerson;
  /** Сторона общего квадрата — та же, что у одиночной аватарки на этом месте. */
  size: number;
  testID?: string;
};

/**
 * Две аватарки внахлёст в квадрате одной: первая — слева сверху, вторая —
 * справа снизу поверх неё, отделённая кольцом цвета фона. Так выглядит чужая
 * переписка двоих — сразу видно, что она не моя с одним из них.
 */
export function AvatarPair({ first, second, size, testID }: AvatarPairProps) {
  const theme = useTheme();
  const inner = Math.round(size * Sizes.avatarPairShare);
  const ring = Sizes.avatarPairRing;
  const outer = inner + ring * 2;

  return (
    <View testID={testID} style={[styles.box, { width: size, height: size }]}>
      <View style={styles.first}>
        <Avatar uri={first.uri} name={first.name} size={inner} />
      </View>
      <View
        style={[
          styles.second,
          {
            width: outer,
            height: outer,
            borderRadius: outer / 2,
            padding: ring,
            backgroundColor: theme.background,
            right: -ring,
            bottom: -ring,
          },
        ]}
      >
        <Avatar uri={second.uri} name={second.name} size={inner} />
      </View>
    </View>
  );
}
