import { create } from 'zustand';

/**
 * Жизнь шита выбора медиа.
 *
 * - `armed` — палец лёг на кнопку: окно шита уже создаётся, но шит за краем
 *   экрана. Рождение нативного окна стоит около 80 мс, и они уходят на то
 *   время, пока палец ещё держит кнопку.
 * - `open` — палец отпущен: шит едет вверх и работает.
 * - `closing` — шит уезжает вниз; окно разбирается, только когда он уехал.
 */
export type MediaSheetPhase = 'closed' | 'armed' | 'open' | 'closing';

/**
 * Чьё поле открыло шит: строка под чатом или строка панели комментариев.
 * Шит на экране один, но выбранные в нём файлы уходят туда, откуда его
 * открыли, — поэтому каждое поле держит свой экземпляр шита, а показывается
 * только экземпляр хозяина.
 */
export type MediaSheetOwner = 'chat' | 'comments';

type MediaSheetState = {
  phase: MediaSheetPhase;
  owner: MediaSheetOwner;
};

/**
 * Флаг живёт в сторе, а не в state экрана чата: касание и отпускание кнопки
 * перерисовывают только шит, а не всю переписку.
 */
const useMediaSheetStore = create<MediaSheetState>(() => ({ phase: 'closed', owner: 'chat' }));

/** Фаза шита для экземпляра `owner`: чужой шит для него закрыт. */
export function useMediaSheetPhase(owner: MediaSheetOwner = 'chat'): MediaSheetPhase {
  return useMediaSheetStore((state) => (state.owner === owner ? state.phase : 'closed'));
}

export function getMediaSheetPhase(): MediaSheetPhase {
  return useMediaSheetStore.getState().phase;
}

/** Касание кнопки: подготовить окно, ничего не показывая. */
export function armMediaSheet(owner: MediaSheetOwner = 'chat') {
  if (getMediaSheetPhase() === 'closed') useMediaSheetStore.setState({ phase: 'armed', owner });
}

/** Отпускание кнопки: показать шит. */
export function openMediaSheet(owner: MediaSheetOwner = 'chat') {
  const phase = getMediaSheetPhase();

  if (phase === 'closed' || phase === 'armed') useMediaSheetStore.setState({ phase: 'open', owner });
}

/**
 * Палец ушёл с кнопки. `onPressOut` приходит раньше `onPress`, поэтому решение
 * откладывается на следующую задачу: если за ним последовало нажатие, шит к
 * этому моменту уже `open`, а если палец увели в сторону — окно убирается.
 */
export function releaseMediaSheetArm() {
  setTimeout(() => {
    if (getMediaSheetPhase() === 'armed') useMediaSheetStore.setState({ phase: 'closed' });
  }, 0);
}

/** Шит начал уезжать. Сам шит решает, когда он уехал, — см. `finishMediaSheetClose`. */
export function closeMediaSheet() {
  const phase = getMediaSheetPhase();

  if (phase === 'open') useMediaSheetStore.setState({ phase: 'closing' });
  else if (phase === 'armed') useMediaSheetStore.setState({ phase: 'closed' });
}

/** Шит уехал. С `owner` — только если шит его: чужой открытый шит не трогается. */
export function finishMediaSheetClose(owner?: MediaSheetOwner) {
  if (owner && useMediaSheetStore.getState().owner !== owner) return;

  useMediaSheetStore.setState({ phase: 'closed' });
}

/** Только для тестов и для ухода с экрана: без анимаций, сразу в исходное. */
export function resetMediaSheet() {
  useMediaSheetStore.setState({ phase: 'closed', owner: 'chat' });
}
