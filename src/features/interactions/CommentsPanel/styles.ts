import { StyleSheet } from 'react-native';

import { Radii, Sizes, Spacing } from '@/theme';

export const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  fill: {
    ...StyleSheet.absoluteFill,
  },
  /**
   * Окно списка — сам шит, от его верха до низа окна. Верх скруглён и
   * обрезает содержимое: комментарии, ушедшие под шапку, не выглядывают из-за
   * её скруглённых углов. Край шита виден по тонкой рамке и на фоне того же
   * цвета (под попсом затемнения нет).
   */
  listWindow: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    overflow: 'hidden',
    borderTopLeftRadius: Radii.lg,
    borderTopRightRadius: Radii.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  /** Шапка шита — у верха окна списка, комментарии листаются под ней. */
  sheetHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    borderTopLeftRadius: Radii.lg,
    borderTopRightRadius: Radii.lg,
  },
  /** Верхний край — за него, как и за весь шит, тянут. */
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
  /** Высота — со стрелку треда: шапка не прыгает при входе в тред и выходе. */
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: Spacing.four,
  },
  /** Строки списка — с полями по бокам, как переписка. */
  row: {
    paddingHorizontal: Spacing.three,
  },
  /**
   * Корень в окне треда — на фоне островка, без пунктира. Подложка шире
   * облачка на поле строки, само облачко стоит там же, где в основном списке.
   */
  commentThreadRoot: {
    marginHorizontal: Spacing.two,
    marginBottom: Spacing.two,
    paddingHorizontal: Spacing.three - Spacing.two,
    paddingTop: Spacing.two,
    borderRadius: Radii.lg,
  },
  /** Окно треда — слоем поверх основного списка, въезжает справа. */
  commentThreadPane: {
    ...StyleSheet.absoluteFill,
  },
  /** Метка закрепа — над облачком, от края облачка, а не аватарки. */
  pinnedLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingLeft: Spacing.five + Spacing.two,
    marginBottom: Spacing.one,
  },
  /** Заглушка удалённого корня — на месте облачка, с местом под аватар, как у чужого. */
  deletedRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginBottom: Spacing.two,
  },
  avatarSlot: {
    width: Spacing.five,
  },
  deletedBubble: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Radii.lg,
  },
  /** Отступ перед первой строкой под шапкой и пустое состояние. */
  listTop: {
    height: Spacing.two,
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.five,
  },
  emptyText: {
    textAlign: 'center',
  },
  hidden: {
    display: 'none',
  },
  /** Строка ввода прижата к низу окна и уходит вниз только вместе с шитом. */
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  closedNotice: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  /** Разрыв треда «Показать ещё» и загрузка — на месте ответа. */
  commentThreadAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: Sizes.commentThreadToggle,
    marginBottom: Spacing.two,
  },
  /** «N ответов» под облачком корня — вплотную к нему, по его краю. */
  repliesButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.half,
    minHeight: Sizes.commentThreadToggle,
    marginTop: -Spacing.one,
    marginBottom: Spacing.one,
  },
  /** У чужого — под левым краем облачка, после аватара и зазора. */
  repliesButtonOther: {
    alignSelf: 'flex-start',
    marginLeft: Spacing.five + Spacing.two,
  },
  repliesButtonOwn: {
    alignSelf: 'flex-end',
  },
  repliesLabel: {
    flexShrink: 0,
  },
  /** Стрелка назад и «Ответы» в шапке окна треда. */
  titleStart: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  /** Боковая панель фрагмента — у правого края, слева видна переписка. */
  sidePanel: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
  },
  /** Шапка панели фрагмента: цитата и строка реакций под заголовком. */
  fragmentHeader: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
    gap: Spacing.two,
  },
  fragmentQuote: {
    borderLeftWidth: Sizes.quoteAccent,
    borderRadius: Radii.sm,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
  },
  fragmentReactions: {
    gap: Spacing.one,
  },
  fragmentChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    minWidth: Sizes.reactionCell,
    height: Sizes.reactionCell - Spacing.two,
    paddingHorizontal: Spacing.two,
    borderRadius: Radii.full,
    justifyContent: 'center',
  },
  /** Полный набор реакций под строкой — блок `ReactionPicker` стоит в нём. */
  fragmentPicker: {
    position: 'relative',
  },
});
