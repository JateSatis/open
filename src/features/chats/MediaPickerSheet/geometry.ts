import { SHEET_TOP_HEIGHT } from './styles';

/** Доля экрана, на которую шит открывается по кнопке медиа. */
const COLLAPSED_RATIO = 0.55;
/** Утащили шит ниже этой доли свёрнутой высоты — отпускание закрывает его. */
const DISMISS_RATIO = 0.2;

export const OPEN_SPRING = { damping: 32, stiffness: 300, mass: 0.9 };
export const CLOSE_DURATION_MS = 220;

export type SheetGeometry = {
  collapsedHeight: number;
  /** Ход шита: от свёрнутого положения до верхней безопасной зоны. Он же высота прозрачной шапки списка. */
  travel: number;
  /** Верх окна списка — верхняя безопасная зона. */
  listTop: number;
  /** Высота окна списка — от верхней безопасной зоны до низа экрана. */
  listWindowHeight: number;
  dismissDistance: number;
  /** Полоса с ручкой над первой строкой сетки. */
  topBarHeight: number;
};

/**
 * Положение шита — в целых физических пикселях. Ход шита и полоса с ручкой
 * задают начало первой строки сетки в содержимом списка, и дробные значения
 * сдвигали бы всю сетку на долю пикселя.
 */
export function sheetGeometry(
  screenHeight: number,
  insetTop: number,
  scale: number,
): SheetGeometry {
  const snap = (dp: number) => Math.round(dp * scale) / scale;

  const collapsedHeight = snap(screenHeight * COLLAPSED_RATIO);
  const listTop = snap(insetTop);

  return {
    collapsedHeight,
    travel: snap(screenHeight - collapsedHeight - listTop),
    listTop,
    listWindowHeight: screenHeight - listTop,
    dismissDistance: collapsedHeight * DISMISS_RATIO,
    topBarHeight: snap(SHEET_TOP_HEIGHT),
  };
}
