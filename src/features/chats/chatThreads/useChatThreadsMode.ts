import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ViewToken } from 'react-native';

import { listChatThreadRootPositions, type ChatSummary } from '@/api/chats';
import type { AnchorRect } from '@/features/chats/MessageContextMenu';
import { contentOf, isBubbleRow, type ChatListRow } from '@/features/chats/islands/rows';
import { readHistory, type HistoryView } from '@/features/chats/messages/historyCache';
import { PENDING_SEQ } from '@/api/pendingSeq';
import type { JumpOptions, JumpToMessage } from '@/features/chats/useJumpToMessage';

/** Вид «Треды» есть в группе, где сейчас не меньше трёх участников. */
export const CHAT_THREADS_MIN_PARTICIPANTS = 3;
const UNAVAILABLE_CONFIRMATION_MS = 600;

export function chatThreadsAvailable(chat: ChatSummary | null): boolean {
  return chat?.kind === 'group' && chat.participants.length >= CHAT_THREADS_MIN_PARTICIPANTS;
}

/**
 * Вид переписки группы: обычный или «Треды». Не запоминается — каждое
 * открытие чата начинается с обычного. Группа уменьшилась до двоих — вид
 * возвращается в обычный.
 */
export function useChatThreadsView(chat: ChatSummary | null) {
  const reportedAvailable = chatThreadsAvailable(chat);
  const [chosen, setView] = useState<HistoryView>('all');
  const [heldAvailable, setHeldAvailable] = useState(reportedAvailable);
  const available = reportedAvailable || heldAvailable;
  const view: HistoryView = available ? chosen : 'all';
  const chooseView = useCallback((next: HistoryView) => {
    setView(next);
    if (next === 'chat-threads') setHeldAvailable(true);
  }, []);

  // Перечитывание участников может ненадолго вернуть неполный список. Не
  // выбрасываем человека из «Тредов» из-за этого промежуточного состояния;
  // реальное уменьшение группы подтверждается короткой задержкой.
  useEffect(() => {
    if (reportedAvailable) return;

    if (!heldAvailable) return;

    const timer = setTimeout(() => {
      setHeldAvailable(false);
      setView('all');
    }, UNAVAILABLE_CONFIRMATION_MS);

    return () => clearTimeout(timer);
  }, [heldAvailable, reportedAvailable]);

  return { view, available, setView: chooseView };
}

type PendingJump = {
  rowKey: string;
  seq: number;
  options: JumpOptions;
  resolve: (found: boolean) => void;
};

/** Ключ строки ленты у нижнего края экрана: список перевёрнут, это меньший индекс. */
type Anchor = { rowKey: string; atBottom: boolean };

type Options = {
  chatId: string;
  view: HistoryView;
  setView: (view: HistoryView) => void;
  rows: ChatListRow[];
  /** Новый вид ещё грузится — прыгать в нём рано. */
  isLoading: boolean;
  jump: JumpToMessage['jump'];
  /** Строка на экране — в координатах окна. */
  measureRow: (rowKey: string) => Promise<AnchorRect | null>;
  measureViewport: () => Promise<AnchorRect | null>;
  /** Смещение прокрутки сейчас: 0 — переписка у самого низа. */
  scrollOffset: () => number;
};

/** Ближе этого к низу переписки — «был внизу», и после переключения тоже внизу. */
const BOTTOM_SLOP = 24;

/**
 * Переключение вида и переходы между видами.
 *
 * Место чтения держится по строке у нижнего края экрана: там глаз, когда
 * читают переписку снизу вверх, и туда приходят новые сообщения. Обычный →
 * «Треды»: не-ответ — к нему же, ответ — к исходному его треда (из
 * нескольких — к ближайшему снизу, с самым большим номером). «Треды» →
 * обычный — к той же строке. Строка встаёт на ту же высоту, без вспышки и
 * без прокрутки на глазах. Был внизу — остаётся внизу.
 *
 * Переход к сообщению, которого в «Тредах» нет (закреп, поиск, цитата,
 * фрагмент), переключает в обычный вид и прыгает уже в нём.
 */
export function useChatThreadsMode({
  chatId,
  view,
  setView,
  rows,
  isLoading,
  jump,
  measureRow,
  measureViewport,
  scrollOffset,
}: Options) {
  const queryClient = useQueryClient();
  const visibleRef = useRef<string[]>([]);
  const pendingRef = useRef<PendingJump | null>(null);
  const [pendingCount, setPendingCount] = useState(0);

  /** Видимые строки — для опорной; в паре с учётом просмотров у списка. */
  const trackViewable = useCallback(({ viewableItems }: { viewableItems: ViewToken<ChatListRow>[] }) => {
    visibleRef.current = viewableItems
      .filter((token) => token.item && isBubbleRow(token.item))
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      .map((token) => token.item.key);
  }, []);

  // Прыжок, отложенный до смены вида, — когда новый вид загружен.
  useEffect(() => {
    const pending = pendingRef.current;

    if (!pending || isLoading) return;

    pendingRef.current = null;

    // Список только что получил другую ленту: прокрутка в этом же кадре
    // теряется — прыжок ждёт, пока новые строки отрисуются.
    requestAnimationFrame(() =>
      requestAnimationFrame(
        () => void jump(pending.rowKey, pending.seq, pending.options).then(pending.resolve),
      ),
    );
  }, [isLoading, jump, pendingCount, view]);

  const jumpAfterSwitch = useCallback(
    (next: HistoryView, rowKey: string, seq: number, options: JumpOptions) =>
      new Promise<boolean>((resolve) => {
        pendingRef.current?.resolve(false);
        pendingRef.current = { rowKey, seq, options, resolve };
        setPendingCount((count) => count + 1);
        setView(next);
      }),
    [setView],
  );

  /** Прыжок к строке; в «Тредах» к тому, чего в них нет, — через обычный вид. */
  const jumpAnywhere = useCallback(
    async (rowKey: string, seq: number, options: JumpOptions = {}) => {
      if (view === 'all' || rows.some((row) => row.key === rowKey)) {
        return jump(rowKey, seq, options);
      }

      // Весь чат хранит любое сообщение; переключение не проходит историю
      // «Тредов» страницами ради проверки, есть ли там эта строка.
      return jumpAfterSwitch('all', rowKey, seq, options);
    },
    [jump, jumpAfterSwitch, rows, view],
  );

  /** «Показать в чате» из шторки: обычный вид, прокрутка и подсветка. */
  const showInChat = useCallback(
    (rowKey: string, seq: number) =>
      void (view === 'all' ? jump(rowKey, seq) : jumpAfterSwitch('all', rowKey, seq, {})),
    [jump, jumpAfterSwitch, view],
  );

  /** Опорная строка и её высота: доля от низа переписки. */
  const anchorPlace = useCallback(
    async (rowKey: string): Promise<number | undefined> => {
      const [row, frame] = await Promise.all([measureRow(rowKey), measureViewport()]);

      if (!row || !frame) return undefined;

      const room = frame.height - row.height;

      if (room <= 0) return 0;

      const fromBottom = frame.y + frame.height - (row.y + row.height);

      return Math.min(1, Math.max(0, fromBottom / room));
    },
    [measureRow, measureViewport],
  );

  const anchorOf = useCallback((): Anchor | null => {
    const rowKey = visibleRef.current[0];

    if (!rowKey) return null;

    return { rowKey, atBottom: scrollOffset() <= BOTTOM_SLOP };
  }, [scrollOffset]);

  /** Куда встать в «Тредах»: сам не-ответ или исходное его треда. */
  const threadsTargetOf = useCallback(
    async (rowKey: string): Promise<{ rowKey: string; seq: number } | null> => {
      const row = rows.find((candidate) => candidate.key === rowKey);
      const message = row && isBubbleRow(row) ? (row.type === 'message' ? row.message : row.island) : null;

      if (!message || message.seq >= PENDING_SEQ) return null;

      const roots = message.chatThreadRootIds ?? [];

      if (roots.length === 0) return { rowKey, seq: message.seq };

      const loaded = readHistory(queryClient, chatId)?.items ?? [];
      const known = roots.flatMap((id) => loaded.find((item) => item.id === id) ?? []);
      const found = known.length === roots.length ? known : await listChatThreadRootPositions(message.id);
      const nearest = found.reduce<{ id: string; seq: number } | null>(
        (best, root) => (!best || root.seq > best.seq ? root : best),
        null,
      );

      return nearest ? { rowKey: nearest.id, seq: nearest.seq } : null;
    },
    [chatId, queryClient, rows],
  );

  const toggle = useCallback(async () => {
    const next: HistoryView = view === 'all' ? 'chat-threads' : 'all';
    const anchor = anchorOf();

    if (!anchor || anchor.atBottom) {
      setView(next);
      return;
    }

    const viewPosition = await anchorPlace(anchor.rowKey);
    const target =
      next === 'chat-threads' ? await threadsTargetOf(anchor.rowKey) : anchorTargetInAll(anchor.rowKey, rows);

    if (!target) {
      setView(next);
      return;
    }

    void jumpAfterSwitch(next, target.rowKey, target.seq, { flash: false, viewPosition });
  }, [anchorOf, anchorPlace, jumpAfterSwitch, rows, setView, threadsTargetOf, view]);

  return { toggle, jumpAnywhere, showInChat, trackViewable };
}

/** «Треды» → обычный: та же строка; у облачка островка — по номеру островка. */
function anchorTargetInAll(rowKey: string, rows: ChatListRow[]) {
  const row = rows.find((candidate) => candidate.key === rowKey);

  if (!row || !isBubbleRow(row)) return null;

  const seq = row.type === 'message' ? row.message.seq : row.island.seq;

  // Заглушки удалённого исходного в обычном виде нет — встать не к чему.
  if (seq >= PENDING_SEQ || !contentOf(row) || contentOf(row)?.chatThreadDeletedRoot) return null;

  return { rowKey, seq };
}
