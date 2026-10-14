import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import { clamp01, lerp, type InfoGeometry } from './geometry';
import type { InfoAction, InfoAvatar } from './types';

import { Avatar } from '@/components/Avatar';
import { AvatarPair } from '@/components/AvatarPair';
import { Text } from '@/components/Text';
import { useTheme } from '@/hooks/use-theme';
import { InfoPageOpacity, InfoPageSizes, Opacity, Radii, Spacing } from '@/theme';

const S = InfoPageSizes;

/**
 * Где аватарка при прокрутке `y`: из круга в раскрытое фото выше покоя, вверх
 * с содержимым ниже (уменьшение и растворение — поверх, в стиле).
 */
export function avatarRect(y: number, geometry: InfoGeometry) {
  'worklet';
  const { width, expand, avatarTop, expandedHeight } = geometry;
  const q = expand > 0 ? clamp01((expand - y) / expand) : 0;
  const size = S.avatar;
  const lift = y > expand ? (y - expand) * 0.6 : 0;

  return {
    x: lerp((width - size) / 2, 0, q),
    y: lerp(avatarTop, 0, q) - lift,
    width: lerp(size, width, q),
    height: lerp(size, expandedHeight, q),
    radius: lerp(size / 2, 0, Math.min(1, q * 1.4)),
  };
}

export type InfoHeroProps = {
  geometry: InfoGeometry;
  scrollY: SharedValue<number>;
  avatar: InfoAvatar;
  actions: InfoAction[];
};

/**
 * Аватарка и ряд кнопок шапки. Положение — из одной величины прокрутки:
 * выше покоя аватарка растёт из круга в фото на всю ширину, ниже —
 * уменьшается, уезжает вверх и тает; кнопки сжимаются и тают.
 */
export function InfoHero({ geometry, scrollY, avatar, actions }: InfoHeroProps) {
  const { expand, collapse } = geometry;
  // Двое внахлёст — сами по себе два круга: круглая маска срезала бы второго.
  const masked = avatar.kind === 'single';

  const avatarStyle = useAnimatedStyle(() => {
    const rect = avatarRect(scrollY.value, geometry);
    const p = clamp01((scrollY.value - expand) / collapse);

    return {
      left: rect.x,
      top: rect.y,
      width: rect.width,
      height: rect.height,
      borderRadius: masked ? rect.radius : 0,
      opacity: 1 - clamp01(p * 1.6),
      transform: [{ scale: lerp(1, 0.4, p) }],
    };
  });

  return (
    <>
      {/* Касания проходят сквозь аватарку к списку: за неё тянут шапку. Тап по
          ней ловит страница (`avatarRect`). */}
      <Animated.View
        testID="info-avatar"
        pointerEvents="none"
        style={[styles.avatar, masked && styles.masked, avatarStyle]}
      >
        <AvatarFace avatar={avatar} />
      </Animated.View>

      {actions.length > 0 ? (
        <InfoActions geometry={geometry} scrollY={scrollY} actions={actions} />
      ) : null}
    </>
  );
}

function AvatarFace({ avatar }: { avatar: InfoAvatar }) {
  if (avatar.kind === 'pair') {
    return <AvatarPair first={avatar.first} second={avatar.second} size={S.avatar} />;
  }

  if (avatar.uri) {
    return (
      <Image
        source={{ uri: avatar.uri }}
        style={styles.fill}
        contentFit="cover"
        accessibilityLabel={avatar.name}
        transition={0}
      />
    );
  }

  return <Avatar uri={null} name={avatar.name} size={S.avatar} />;
}

function InfoActions({
  geometry,
  scrollY,
  actions,
}: {
  geometry: InfoGeometry;
  scrollY: SharedValue<number>;
  actions: InfoAction[];
}) {
  const theme = useTheme();
  const { expand, collapse, actionsTop, expandedHeight } = geometry;
  const photoTop = expandedHeight - S.heroBottom - S.actionHeight;

  const rowStyle = useAnimatedStyle(() => {
    const y = scrollY.value;
    const q = expand > 0 ? clamp01((expand - y) / expand) : 0;
    const p = clamp01((y - expand) / collapse);

    return {
      top: lerp(actionsTop, photoTop, q),
      opacity: 1 - clamp01(p * 2.2),
      transform: [
        { translateY: -Math.max(0, y - expand) },
        { scaleY: lerp(1, 0.5, clamp01(p * 2)) },
      ],
    };
  });
  const plainStyle = useAnimatedStyle(() => ({
    opacity: expand > 0 ? 1 - clamp01((expand - scrollY.value) / expand) : 1,
  }));
  const photoStyle = useAnimatedStyle(() => ({
    opacity: expand > 0 ? clamp01((expand - scrollY.value) / expand) : 0,
  }));

  return (
    <Animated.View style={[styles.actions, rowStyle]} pointerEvents="box-none">
      {actions.map((action) => (
        <Pressable
          key={action.id}
          testID={`info-action-${action.id}`}
          accessibilityRole="button"
          accessibilityLabel={action.label}
          disabled={action.disabled}
          onPress={action.onPress}
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}
        >
          <Animated.View style={[StyleSheet.absoluteFill, plainStyle]} pointerEvents="none">
            <View style={[styles.actionFill, { backgroundColor: theme.text }]} />
          </Animated.View>
          <Animated.View style={[StyleSheet.absoluteFill, photoStyle]} pointerEvents="none">
            <View style={[styles.actionFillPhoto, { backgroundColor: theme.viewerBackground }]} />
          </Animated.View>
          <View>
            <Animated.View style={plainStyle}>
              <SymbolView name={action.icon} size={S.actionIcon} tintColor={theme.primary} />
            </Animated.View>
            <Animated.View style={[StyleSheet.absoluteFill, photoStyle]}>
              <SymbolView name={action.icon} size={S.actionIcon} tintColor={theme.textOnMedia} />
            </Animated.View>
          </View>
          <View>
            <Animated.View style={plainStyle}>
              <Text variant="caption" color="primary" numberOfLines={1}>
                {action.label}
              </Text>
            </Animated.View>
            <Animated.View style={[StyleSheet.absoluteFill, photoStyle]}>
              <Text variant="caption" color="textOnMedia" numberOfLines={1}>
                {action.label}
              </Text>
            </Animated.View>
          </View>
        </Pressable>
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  avatar: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  masked: {
    overflow: 'hidden',
  },
  fill: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actions: {
    position: 'absolute',
    left: Spacing.three,
    right: Spacing.three,
    height: S.actionHeight,
    flexDirection: 'row',
    gap: Spacing.two,
  },
  action: {
    flex: 1,
    borderRadius: Radii.md,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
  },
  actionFill: {
    ...StyleSheet.absoluteFill,
    opacity: InfoPageOpacity.actionFill,
  },
  actionFillPhoto: {
    ...StyleSheet.absoluteFill,
    opacity: InfoPageOpacity.actionFillOnPhoto,
  },
  pressed: {
    opacity: Opacity.pressed,
  },
});
