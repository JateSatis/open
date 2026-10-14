import type { Rect } from '@/features/chats/fragments/textGeometry';

export type FragmentMenuLayoutInput = {
  /** Рамка выделения в окне. */
  selection: Rect;
  /** Сколько под строкой занимают капли ручек — меню их не закрывает. */
  handleSpace: number;
  /** Окно списка в окне: выше — шапка чата, ниже — поле ввода. */
  viewport: { top: number; bottom: number };
  screenWidth: number;
  width: number;
  height: number;
  /** Зазор от выделения и от краёв. */
  gap: number;
};

/**
 * Где встаёт меню фрагмента (координаты окна): под выделением, под каплями
 * ручек; снизу не влезает — над выделением; не влезает и там (выделение во
 * весь экран) — у нижнего края списка. По ширине — по центру выделения, но в
 * пределах экрана.
 */
export function fragmentMenuLayout({
  selection,
  handleSpace,
  viewport,
  screenWidth,
  width,
  height,
  gap,
}: FragmentMenuLayoutInput): { left: number; top: number; above: boolean } {
  const below = selection.y + selection.height + handleSpace + gap;
  const above = selection.y - gap - height;
  const center = selection.x + selection.width / 2;
  const left = Math.min(Math.max(gap, center - width / 2), screenWidth - gap - width);

  if (below + height <= viewport.bottom - gap) return { left, top: below, above: false };
  if (above >= viewport.top + gap) return { left, top: above, above: true };

  return { left, top: Math.max(viewport.top + gap, viewport.bottom - gap - height), above: false };
}
