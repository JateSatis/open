import { Pressable, View } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';

import { styles } from './styles';
import { chipBackground, labelColors, type ReactionsTone } from './tones';

import { Avatar } from '@/components/Avatar';
import { Text } from '@/components/Text';
import { formatViewsCount } from '@/features/chats/ViewsCount/formatViewsCount';
import { useTheme } from '@/hooks/use-theme';
import { Sizes, Spacing } from '@/theme';

const APPEAR_MS = 160;

/** Поставивший, как его рисовать: фото или заглушка с буквой. */
export type ShownPerson = { key: string; name: string; avatarUrl: string | null };

export type ReactionBadgeProps = {
  emoji: string;
  count: number;
  /** Один-два поставивших — их аватары вместо числа. `null` — число. */
  people: readonly ShownPerson[] | null;
  mine: boolean;
  tone: ReactionsTone;
  /** Без обработчика значок не нажимается: чужой ряд или копия облачка в меню. */
  onPress?: () => void;
  /**
   * Чужой ряд в живом облачке: касание значок забирает себе и ничего не
   * делает — иначе оно ушло бы строке и открыло меню. В копии облачка
   * касание проходит насквозь.
   */
  swallowsTouch?: boolean;
};

const noop = () => undefined;

/**
 * Реакция участников: эмодзи в круге, под ним по центру, наезжая на нижний
 * край круга, — число или аватары одного-двух поставивших.
 */
export function ReactionBadge({
  emoji,
  count,
  people,
  mine,
  tone,
  onPress,
  swallowsTouch = false,
}: ReactionBadgeProps) {
  const theme = useTheme();
  const label = labelColors(tone);
  const ring = { borderColor: theme[label.background] };

  return (
    <Animated.View
      entering={FadeIn.duration(APPEAR_MS)}
      exiting={FadeOut.duration(APPEAR_MS)}
      layout={LinearTransition.duration(APPEAR_MS)}
    >
      <Pressable
        testID={`reaction-chip-${emoji}`}
        accessibilityRole="button"
        accessibilityLabel={`${emoji} ${count}`}
        accessibilityState={{ selected: mine, disabled: !onPress }}
        // Глотающий значок не выключен, но для чтеца «недоступен»: `disabled`
        // у Pressable перезаписал бы это состояние.
        disabled={onPress || swallowsTouch ? undefined : true}
        hitSlop={Spacing.half}
        onPress={onPress ?? (swallowsTouch ? noop : undefined)}
        style={styles.badge}
      >
        <View style={[styles.badgeCircle, { backgroundColor: theme[chipBackground(tone, mine)] }]}>
          <Text variant="reaction">{emoji}</Text>
        </View>

        <View style={styles.badgeLabel}>
          {people ? (
            <View testID={`reaction-people-${emoji}`} style={styles.people}>
              {people.map((person, index) => (
                <View
                  key={person.key}
                  style={[styles.personRing, ring, index > 0 && styles.personOverlap]}
                >
                  <Avatar uri={person.avatarUrl} name={person.name} size={Sizes.reactionAvatar} />
                </View>
              ))}
            </View>
          ) : (
            // Новое число проявляется, а не подменяется скачком.
            <Animated.View
              key={count}
              entering={FadeIn.duration(APPEAR_MS)}
              style={[styles.count, ring, { backgroundColor: theme[label.background] }]}
            >
              <Text variant="reactionCount" color={label.text}>
                {formatViewsCount(count)}
              </Text>
            </Animated.View>
          )}
        </View>
      </Pressable>
    </Animated.View>
  );
}
