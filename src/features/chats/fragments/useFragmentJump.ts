import { useEffect, useRef } from 'react';
import { Keyboard } from 'react-native';

import { measureText, type TextGeometry } from '../../../../modules/text-geometry';

import {
  takeFragmentJump,
  useFragmentJumpRequested,
  type FragmentJump,
} from '@/features/chats/fragments/fragmentJump';
import { clearQuoteHighlight, setQuoteHighlight } from '@/features/chats/fragments/fragmentStore';
import {
  selectableTextOf,
  type SelectableTextEntry,
} from '@/features/chats/fragments/selectableTexts';
import { fromServerRange } from '@/features/chats/fragments/textOffsets';
import type { ChatListRow } from '@/features/chats/islands/rows';
import type { JumpToMessage } from '@/features/chats/useJumpToMessage';
import { useCommentsPanelTarget } from '@/features/interactions/comments/commentsPanelStore';
import { showNotice } from '@/features/notifications/alertsStore';

/** Дольше этого не ждём, пока облачко после прокрутки отрисует текст. */
const TEXT_WAIT_MS = 2000;

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

const notFound = () => showNotice('Не удалось найти сообщение', 'error');
const changed = () => showNotice('Этот кусок текста изменён');

/** Время строки: у облачка островка — время островка, до него и догружать. */
function createdAtOf(row: ChatListRow): string {
  return row.type === 'message' ? row.message.createdAt : row.island.createdAt;
}

/**
 * Текст облачка и его геометрия, когда строка встала в список и разложена:
 * после догрузки истории и прокрутки на это уходит несколько кадров.
 * Геометрия — в координатах самого текста, поэтому от того, едет ли ещё
 * список, она не зависит.
 */
async function settledText(
  rowKey: string,
  messageId: string,
): Promise<{ entry: SelectableTextEntry; geometry: TextGeometry } | null> {
  const deadline = Date.now() + TEXT_WAIT_MS;

  while (Date.now() < deadline) {
    const entry = selectableTextOf(rowKey);

    if (entry && entry.messageId === messageId && entry.ref.current) {
      const geometry = await measureText(entry.ref.current);

      if (geometry && geometry.text === entry.text) return { entry, geometry };
    }

    await nextFrame();
  }

  return null;
}

type Options = {
  chatId: string;
  rows: ChatListRow[];
  jump: JumpToMessage['jump'];
  isFocused: boolean;
};

/**
 * Переход по цитате фрагмента на экране переписки. Панель комментариев
 * оставляет запрос и закрывается; когда её больше нет на экране, сообщение
 * над ней уже вернулось в строку — переписка едет к нему, и в тексте
 * подсвечивается процитированный кусок. Кусок унесла правка — вспыхивает всё
 * сообщение.
 *
 * Подсветка держится до первого действия: касание экрана и начало прокрутки
 * снимает сам экран, здесь — клавиатура и уход с экрана.
 */
export function useFragmentJump({ chatId, rows, jump, isFocused }: Options) {
  const requested = useFragmentJumpRequested();
  const panelOpen = useCommentsPanelTarget() !== null;
  const rowsRef = useRef(rows);

  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  useEffect(() => {
    if (!requested || panelOpen || !isFocused) return;

    const request = takeFragmentJump();

    if (request) void run(request);

    async function run(request: FragmentJump) {
      // Без строки панели — само сообщение, если оно из этого чата. Чужое без
      // строки (островок не найден) искать здесь негде.
      const key =
        request.rowKey ??
        (request.chatId === undefined || request.chatId === chatId ? request.messageId : null);

      if (!key) {
        notFound();
        return;
      }

      const row = rowsRef.current.find((item) => item.key === key);
      const createdAt = row ? createdAtOf(row) : request.createdAt;

      if (request.lost) {
        if (await jump(key, createdAt)) changed();
        else notFound();

        return;
      }

      if (!(await jump(key, createdAt, { flash: false }))) {
        notFound();
        return;
      }

      const shown = await settledText(key, request.messageId);

      if (!shown) {
        notFound();
        return;
      }

      const { entry, geometry } = shown;
      const { start, end } = fromServerRange(entry.text, request.start, request.end);

      // Текст в переписке ещё не догнал правку, с которой база перепривязала
      // фрагмент, — подсветили бы не то.
      if (end <= start || entry.text.slice(start, end) !== request.text) {
        await jump(key, createdAt);
        changed();
        return;
      }

      setQuoteHighlight({ rowKey: key, text: entry.text, start, end, geometry });
    }
  }, [chatId, isFocused, jump, panelOpen, requested]);

  useEffect(() => {
    if (!isFocused) clearQuoteHighlight();
  }, [isFocused]);

  useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', clearQuoteHighlight);

    return () => {
      shown.remove();
      clearQuoteHighlight();
    };
  }, []);
}
