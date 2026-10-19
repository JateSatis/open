import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import { clamp01, type InfoGeometry } from './geometry';
import type { InfoAction, InfoAvatar } from './types';

import type { AvatarPairPerson } from '@/components/AvatarPair';
import { Text } from '@/components/Text';
import { initialOf } from '@/lib/initialOf';
import { useTheme } from '@/hooks/use-theme';
import { InfoPageOpacity, InfoPageSizes, Opacity, Radii, Spacing } from '@/theme';

const S = InfoPageSizes;

/**
 * Где фото при прокрутке `y`: в покое — от верха экрана на всю высоту шапки,
 * дальше уезжает вверх вместе с содержимым. Потягивание вниз за покой
 * удлиняет фото сверху, а не сдвигает его: над ним не открывается пустота.
 */
export function photoRect(y: number, geometry: InfoGeometry) {
  'worklet';
  const { width, heroHeight } = geometry;

  return {
    x: 0,
    y: -Math.min(Math.max(y, 0), heroHeight),
    width,
    height: heroHeight - Math.min(y, 0),
  };
}

export type InfoHeroProps = {
  geometry: InfoGeometry;
  scrollY: SharedValue<number>;
  avatar: InfoAvatar;
  actions: InfoAction[];
};

/**
 * Фото во всю ширину и ряд кнопок на нём. Нет фото — блок того же размера
 * цвета аватарки с крупной буквой; двое — две половины. Положение — из одной
 * величины прокрутки: фото едет вверх вместе с содержимым, кнопки тают,
 * подходя к панели.
 */
export function InfoHero({ geometry, scrollY, avatar, actions }: InfoHeroProps) {
  const theme = useTheme();

  const photoStyle = useAnimatedStyle(() => {
    const rect = photoRect(scrollY.value, geometry);

    return { top: rect.y, height: rect.height };
  });

  return (
    <>
      {/* Касания проходят сквозь фото к списку: за него листают страницу.
          Тап по нему ловит страница (`photoRect`). */}
      <Animated.View
        testID="info-avatar"
        pointerEvents="none"
        style={[styles.photo, { width: geometry.width }, photoStyle]}
      >
        <PhotoFace
          avatar={avatar}
          // Буква — посередине места между панелью и именем, а не под именем.
          letterSpace={{
            paddingTop: geometry.barBottom,
            paddingBottom: geometry.heroHeight - geometry.nameTop,
          }}
        />
        <View
          style={[
            styles.scrimTop,
            {
              height: S.photoScrimTop + geometry.barBottom - S.barHeight,
              experimental_backgroundImage: `linear-gradient(to bottom, ${theme.mediaScrim} 0%, transparent 100%)`,
            },
          ]}
        />
        <View
          style={[
            styles.scrimBottom,
            {
              height: S.photoScrimBottom,
              experimental_backgroundImage: `linear-gradient(to top, ${theme.mediaScrim} 0%, transparent 100%)`,
            },
          ]}
        />
      </Animated.View>

      {actions.length > 0 ? (
        <InfoActions geometry={geometry} scrollY={scrollY} actions={actions} />
      ) : null}
    </>
  );
}

type LetterSpace = { paddingTop: number; paddingBottom: number };

function PhotoFace({ avatar, letterSpace }: { avatar: InfoAvatar; letterSpace: LetterSpace }) {
  const theme = useTheme();

  if (avatar.kind === 'pair') {
    return (
      <View testID="info-avatar-pair" style={[styles.pair, { backgroundColor: theme.background }]}>
        <PersonFace person={avatar.first} letterSpace={letterSpace} testID="info-avatar-first" />
        <PersonFace person={avatar.second} letterSpace={letterSpace} testID="info-avatar-second" />
      </View>
    );
  }

  return <PersonFace person={{ uri: avatar.uri, name: avatar.name }} letterSpace={letterSpace} />;
}

/** Одно лицо во весь свой блок: фото или буква на цвете аватарки. */
function PersonFace({
  person,
  letterSpace,
  testID,
}: {
  person: AvatarPairPerson;
  letterSpace: LetterSpace;
  testID?: string;
}) {
  const theme = useTheme();

  if (person.uri) {
    return (
      <Image
        testID={testID}
        source={{ uri: person.uri }}
        style={styles.face}
        contentFit="cover"
        accessibilityLabel={person.name}
        transition={0}
      />
    );
  }

  return (
    <View
      testID={testID}
      style={[
        styles.face,
        styles.letterBox,
        letterSpace,
        { backgroundColor: theme.backgroundSelected },
      ]}
    >
      <LetterOf name={person.name} />
    </View>
  );
}

/** Крупная буква имени — как у аватарки без фото, только во весь блок. */
function LetterOf({ name }: { name: string }) {
  return (
    <Text variant="title" color="textSecondary" accessibilityLabel={name} style={styles.letter}>
      {initialOf(name)}
    </Text>
  );
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
  const { actionsTop, barBottom } = geometry;

  const rowStyle = useAnimatedStyle(() => {
    const y = scrollY.value;
    const top = actionsTop - y;

    return {
      top,
      // Подходя к панели, кнопки тают: под неё они не заезжают.
      opacity: clamp01((top - barBottom) / S.actionHeight),
    };
  });

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
          <View
            style={[styles.actionFill, { backgroundColor: theme.viewerBackground }]}
            pointerEvents="none"
          />
          <SymbolView name={action.icon} size={S.actionIcon} tintColor={theme.textOnMedia} />
          <Text variant="caption" color="textOnMedia" numberOfLines={1}>
            {action.label}
          </Text>
        </Pressable>
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  photo: {
    position: 'absolute',
    left: 0,
    overflow: 'hidden',
  },
  face: {
    flex: 1,
    alignSelf: 'stretch',
  },
  pair: {
    flex: 1,
    flexDirection: 'row',
    gap: S.pairGap,
  },
  letterBox: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  letter: {
    fontSize: S.photoLetter,
    lineHeight: S.photoLetterLine,
    textAlign: 'center',
  },
  scrimTop: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
  },
  scrimBottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
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
    opacity: InfoPageOpacity.actionFillOnPhoto,
  },
  pressed: {
    opacity: Opacity.pressed,
  },
});
