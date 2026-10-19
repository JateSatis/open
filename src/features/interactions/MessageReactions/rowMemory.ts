// Состояние рядов реакций, которое переживает облачко: сдвиг прокрученного
// ряда участников и строки зрителей. По id сообщения: копия облачка
// в меню и над шитом комментариев с первого кадра встаёт так же, как
// оригинал, без прыжка. Это вид, а не данные сервера, — поэтому не в кеше
// запросов, а здесь, рядом с рядами.

import { makeMutable } from 'react-native-reanimated';

const offsets = new Map<string, number>();

/** Сколько рядов держать в памяти: больше — забываются самые старые. */
const MAX_REMEMBERED = 500;

function remember<T>(map: Map<string, T>, id: string, value: T) {
  map.delete(id);
  map.set(id, value);

  if (map.size > MAX_REMEMBERED) {
    const oldest = map.keys().next().value;

    if (oldest !== undefined) map.delete(oldest);
  }
}

export function readRowOffset(id: string): number {
  return offsets.get(id) ?? 0;
}

export function rememberRowOffset(id: string, offset: number) {
  if (offset <= 0) offsets.delete(id);
  else remember(offsets, id, offset);
}

const resetListeners = new Set<() => void>();

/**
 * Сколько рядов сейчас прокручено вбок — для списков, чья прокрутка живёт на
 * UI-потоке: они зовут `resetScrolledRows` только когда есть кого
 * возвращать, а не на каждый кадр.
 */
export const scrolledRowsCount = makeMutable(0);

/**
 * Прокрутили переписку или список комментариев: прокрученные вбок ряды
 * возвращаются в начало. Подписаны только ряды со сдвигом — сотни строк на
 * каждый кадр прокрутки не трогаются.
 */
export function resetScrolledRows() {
  if (resetListeners.size === 0) return;

  for (const listener of [...resetListeners]) listener();
}

/** Ряд со сдвигом ждёт прокрутки списка. Отписка — возвратом. */
export function onRowsReset(listener: () => void): () => void {
  resetListeners.add(listener);
  scrolledRowsCount.value = resetListeners.size;

  return () => {
    resetListeners.delete(listener);
    scrolledRowsCount.value = resetListeners.size;
  };
}
