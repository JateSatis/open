import { StyleSheet } from 'react-native';

import { Radii, Sizes, Spacing } from '@/theme';

export const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  fill: {
    ...StyleSheet.absoluteFill,
  },
  /** Панель от своего верха до низа окна; верх скруглён, как у шита. */
  panel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: Radii.lg,
    borderTopRightRadius: Radii.lg,
    overflow: 'hidden',
  },
  /** Верхний край — за него панель тянут вниз. */
  header: {
    paddingTop: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.one,
    gap: Spacing.two,
  },
  handle: {
    alignSelf: 'center',
    width: Sizes.panelHandleWidth,
    height: Sizes.panelHandleHeight,
    borderRadius: Radii.full,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  /** Сообщение сверху: свёрнутое длинное обрезается снизу. */
  target: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  targetClip: {
    overflow: 'hidden',
  },
  hidden: {
    display: 'none',
  },
  /** Сообщение не ужимается колонкой шита: его высоту держит свой потолок. */
  targetFrame: {
    flexShrink: 0,
  },
  targetToggle: {
    paddingBottom: Spacing.one,
  },
  targetGone: {
    paddingVertical: Spacing.two,
  },
  list: {
    flexGrow: 1,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
  },
  emptyText: {
    textAlign: 'center',
  },
  closedNotice: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
