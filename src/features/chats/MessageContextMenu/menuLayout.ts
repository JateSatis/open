export type MenuLayoutInput = {
  /** Куда пришёлся палец — по вертикали, в координатах окна. */
  touchY: number;
  /** Насколько ниже верхнего края меню должен оказаться палец. */
  touchOffset: number;
  menuHeight: number;
  /** Блок над меню — свёрнутые реакции. Нет блока — 0. */
  accessoryHeight: number;
  windowHeight: number;
  safeTop: number;
  safeBottom: number;
  /** Отступ от краёв экрана. */
  margin: number;
  /** Зазор между меню и блоком над ним. */
  gap: number;
};

export type MenuLayout = {
  menuTop: number;
  accessoryTop: number;
};

/**
 * Меню встаёт у пальца: касание приходится чуть ниже его верхнего края,
 * реакции — над меню. Если у пальца связка не помещается, она целиком
 * сдвигается ровно настолько, чтобы влезть в экран. Сообщение не двигается
 * никогда — меню и реакции просто ложатся поверх него.
 */
export function computeMenuLayout(input: MenuLayoutInput): MenuLayout {
  const accessory = input.accessoryHeight > 0 ? input.accessoryHeight + input.gap : 0;
  const minTop = input.safeTop + input.margin;
  const maxBottom = input.windowHeight - input.safeBottom - input.margin;
  const wanted = input.touchY - input.touchOffset - accessory;
  // Связка выше экрана — видно её верх: реакции и первые пункты.
  const top = Math.max(minTop, Math.min(wanted, maxBottom - accessory - input.menuHeight));

  return { accessoryTop: top, menuTop: top + accessory };
}
