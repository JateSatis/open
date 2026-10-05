import { StyleSheet } from 'react-native';

import { Radii, Sizes, Spacing } from '@/theme';

export const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  fill: {
    ...StyleSheet.absoluteFill,
  },
  /** Окно переписки под шитом: копия сообщения не вылезает на шапку чата и поле ввода. */
  liftClip: {
    position: 'absolute',
    left: 0,
    right: 0,
    overflow: 'hidden',
  },
  liftedCopy: {
    position: 'absolute',
    top: 0,
  },
  /**
   * Окно списка — сам шит, от его верха до низа окна. Верх скруглён и
   * обрезает содержимое: комментарии, ушедшие под шапку, не выглядывают из-за
   * её скруглённых углов. Затемнения под шитом нет, и на фоне чата того же
   * цвета край шита виден по тонкой рамке.
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
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  /** Строки списка — с полями по бокам, как переписка. */
  row: {
    paddingHorizontal: Spacing.three,
  },
  /** Ответ в треде — на «таб» правее корня. */
  reply: {
    paddingLeft: Spacing.three + Sizes.threadIndent,
  },
  replyBubble: {
    paddingLeft: Sizes.threadIndent,
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
  /** Копия корня треда поверх строк, в координатах содержимого. */
  stickyRoot: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
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
  /** Разрыв треда «Показать ещё» и загрузка — на месте ответа, с тем же отступом. */
  threadAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: Sizes.threadToggle,
    marginBottom: Spacing.two,
  },
  /** Кнопка треда сбоку от облачка корня — внизу, у края облачка. */
  threadToggle: {
    alignSelf: 'flex-end',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    height: Sizes.threadToggle,
    paddingHorizontal: Spacing.two + Spacing.half,
    borderRadius: Radii.full,
  },
  /**
   * Фон раскрытого треда — кусок на высоту строки, как рамка островка: строки
   * состыкованы, верх скруглён у корня, низ — у последней строки.
   */
  threadBackground: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: Spacing.two,
    right: Spacing.two,
  },
  threadBackgroundFirst: {
    borderTopLeftRadius: Radii.lg,
    borderTopRightRadius: Radii.lg,
  },
  threadBackgroundLast: {
    borderBottomLeftRadius: Radii.lg,
    borderBottomRightRadius: Radii.lg,
  },
});
