import type { Text } from 'react-native';

import type { HiddenRange } from '@/features/chats/hiddenText';

// Отрисованные тексты облачков, в которых можно выделять, — по ключу строки.
// Долгое нажатие в режиме фрагментов приходит строке, а мерить нужно сам
// текст: строка находит его здесь.

export type SelectableTextEntry = {
  ref: { current: Text | null };
  text: string;
  /** Сообщение, чей это текст: у облачка островка — оригинал. */
  messageId: string;
  chatId: string;
  /** Я участник чата сообщения — догадка ряда моей реакции на фрагмент. */
  amMember: boolean;
  /** Скрытое автором от зрителей — code points. */
  hiddenRanges?: HiddenRange[];
  /** Сообщение моё: кусок можно скрыть от зрителей или показать снова. */
  canHide?: boolean;
};

const entries = new Map<string, SelectableTextEntry>();

/** Отдаёт отписку: облачко ушло из списка — его текста больше нет. */
export function registerSelectableText(rowKey: string, entry: SelectableTextEntry): () => void {
  entries.set(rowKey, entry);

  return () => {
    if (entries.get(rowKey) === entry) entries.delete(rowKey);
  };
}

export function selectableTextOf(rowKey: string): SelectableTextEntry | undefined {
  return entries.get(rowKey);
}
