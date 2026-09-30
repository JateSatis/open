import { StyleSheet } from 'react-native';

import { Radii, Sizes, Spacing } from '@/theme';

export const styles = StyleSheet.create({
  screen: {
    flex: 1,
    paddingHorizontal: Spacing.three,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  headerTitle: {
    flex: 1,
    alignItems: 'center',
  },
  /** Уравновешивает стрелку слева, чтобы заголовок стоял по центру. */
  headerSpacer: {
    width: Sizes.callControlIcon,
  },
  onAir: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: Spacing.two,
    borderRadius: Radii.full,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    marginTop: Spacing.four,
  },
  onAirHint: {
    textAlign: 'center',
    marginTop: Spacing.two,
  },
  dot: {
    width: Sizes.onAirDot,
    height: Sizes.onAirDot,
    borderRadius: Sizes.onAirDot / 2,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: Spacing.four,
    paddingVertical: Spacing.five,
  },
  tile: {
    width: Sizes.callAvatar + Spacing.four,
    alignItems: 'center',
    gap: Spacing.two,
  },
  ring: {
    borderWidth: Sizes.callSpeakingRing,
    borderRadius: Radii.full,
    padding: Sizes.callSpeakingRing,
  },
  mutedBadge: {
    position: 'absolute',
    top: Sizes.callAvatar - Sizes.callMutedBadge / 2,
    right: Spacing.two,
    width: Sizes.callMutedBadge,
    height: Sizes.callMutedBadge,
    borderRadius: Sizes.callMutedBadge / 2,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileName: {
    textAlign: 'center',
  },
  controls: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
  },
  control: {
    alignItems: 'center',
    gap: Spacing.two,
  },
  round: {
    width: Sizes.callControl,
    height: Sizes.callControl,
    borderRadius: Sizes.callControl / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
