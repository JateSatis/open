import { StyleSheet } from 'react-native';

import { Radii, Shadows, Sizes, Spacing } from '@/theme';

export const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  page: {
    overflow: 'hidden',
  },
  surface: {
    ...StyleSheet.absoluteFill,
  },
  /** Видео с обложкой — слой, который уменьшается над шитом комментариев. */
  videoLayer: {
    ...StyleSheet.absoluteFill,
  },
  center: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrim: {
    ...StyleSheet.absoluteFill,
  },
  back: {
    position: 'absolute',
    left: Spacing.two,
  },
  backButton: {
    width: Sizes.popSideButton,
    height: Sizes.popSideButton,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fastBadge: {
    position: 'absolute',
    alignSelf: 'center',
    marginTop: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    borderRadius: Radii.full,
  },
  heart: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** Подпись слева и колонка справа — над полосой прогресса. */
  bottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: Sizes.popProgressTouch,
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingLeft: Spacing.three,
    paddingRight: Spacing.one,
    gap: Spacing.two,
  },
  caption: {
    flex: 1,
    gap: Spacing.one,
    paddingBottom: Spacing.two,
  },
  /** Аватарка с именем и кнопка подписки — одной строкой. */
  channelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  channelName: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    flexShrink: 1,
  },
  channelTitle: {
    flexShrink: 1,
  },
  subscribe: {
    borderWidth: 1,
    borderRadius: Radii.full,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
  },
  /** Невидимая копия подписи — только чтобы узнать, сколько в ней строк. */
  measure: {
    position: 'absolute',
    left: 0,
    right: 0,
    opacity: 0,
  },
  onMediaText: {
    ...Shadows.textOnMedia,
  },
  onMediaShadow: {
    ...Shadows.onMedia,
  },
  sideColumn: {
    width: Sizes.popSideColumn,
    alignItems: 'center',
    gap: Spacing.two,
    paddingBottom: Spacing.two,
  },
  reactionsContent: {
    alignItems: 'center',
  },
  reactionCell: {
    height: Sizes.popReactionCell,
    justifyContent: 'center',
  },
  sideButton: {
    width: Sizes.popSideButton,
    height: Sizes.popSideButton,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sideStat: {
    alignItems: 'center',
  },
  progressDock: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
  progressArea: {
    justifyContent: 'flex-end',
  },
  progressLabel: {
    position: 'absolute',
    bottom: Sizes.popProgressTouch + Spacing.five,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  progressTouch: {
    height: Sizes.popProgressTouch,
    justifyContent: 'center',
  },
  progressTrack: {
    width: '100%',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
  },
  message: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
  },
});
