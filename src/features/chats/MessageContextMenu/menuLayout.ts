export type MenuLayoutInput = {
  /** Где облачко стоит в переписке — в координатах окна. */
  anchorTop: number;
  anchorHeight: number;
  menuHeight: number;
  /**
   * Блок над облачком (реакции). Пока его нет — 0; раскладка уже оставляет
   * под него место, когда он появится.
   */
  accessoryHeight: number;
  windowHeight: number;
  safeTop: number;
  safeBottom: number;
  /** Отступ от краёв экрана. */
  margin: number;
  /** Зазор между облачком, меню и блоком над ним. */
  gap: number;
};

export type MenuLayout = {
  /** Куда встаёт поднятое облачко. */
  bubbleTop: number;
  /** Сколько облачка видно: слишком длинное обрезается снизу. */
  bubbleHeight: number;
  menuTop: number;
  accessoryTop: number;
};

/**
 * Облачко остаётся там, где было, если меню помещается; иначе сдвигается
 * ровно настолько, чтобы и оно, и меню, и блок над ним уместились в экран.
 */
export function computeMenuLayout(input: MenuLayoutInput): MenuLayout {
  const accessory = input.accessoryHeight > 0 ? input.accessoryHeight + input.gap : 0;
  const minTop = input.safeTop + input.margin + accessory;
  const maxBottom = input.windowHeight - input.safeBottom - input.margin;
  const room = maxBottom - minTop - input.gap - input.menuHeight;
  const bubbleHeight = Math.max(0, Math.min(input.anchorHeight, room));
  const lowestTop = maxBottom - input.menuHeight - input.gap - bubbleHeight;
  const bubbleTop = Math.max(minTop, Math.min(input.anchorTop, lowestTop));

  return {
    bubbleTop,
    bubbleHeight,
    menuTop: bubbleTop + bubbleHeight + input.gap,
    accessoryTop: bubbleTop - accessory,
  };
}
