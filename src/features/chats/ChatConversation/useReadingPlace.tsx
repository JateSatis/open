import {
  createContext,
  useCallback,
  useContext,
  useReducer,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { AppState, View, type FlatList, type LayoutRectangle } from 'react-native';
import type { CellRendererProps } from '@react-native/virtualized-lists';
import type { ChatListRow } from '../islands/rows';
import { localHistory } from '../messages/local/database';
import { compare, type ReadingPlace } from '../messages/local/segments';
import { stillReader, useHistoryReader } from '../messages/local/reader';
import type { Reached } from '@/api/historyRead';

type Layouts = {
  positions: Map<string, LayoutRectangle>;
  nodes: Map<string, View>;
};
export const HistoryLayouts = createContext<Layouts | null>(null);

export function HistoryCell({
  item,
  children,
  onLayout,
  style,
  onFocusCapture,
}: CellRendererProps<ChatListRow>) {
  const layouts = useContext(HistoryLayouts);
  useLayoutEffect(
    () => () => {
      layouts?.positions.delete(item.key);
    },
    [item.key, layouts],
  );
  return (
    <View
      {...{ style, onFocusCapture }}
      collapsable={false}
      ref={(node) => {
        if (node) layouts?.nodes.set(item.key, node);
        else layouts?.nodes.delete(item.key);
      }}
      onLayout={(e) => {
        layouts?.positions.set(item.key, e.nativeEvent.layout);
        onLayout?.(e);
      }}
    >
      {children}
    </View>
  );
}

function identity(row: ChatListRow) {
  if (row.type === 'island-header') return null;
  const parent = row.type === 'message' ? row.message : row.island;
  if (parent.status !== 'sent' || parent.hidden) return null;
  if (row.type === 'island-item' && (!row.item.original || row.item.original.hidden)) return null;
  return {
    key: row.type === 'message' ? parent.id : row.item.id,
    seq: parent.seq,
    messageId: parent.id,
    itemId: row.type === 'message' ? null : row.item.id,
    position: row.type === 'message' ? 0 : row.item.position,
  };
}

// Mount close enough to the saved occurrence to measure it in the first batch, including
// a bubble taller than the viewport. Reveal the rest of the connected disk range on scroll.
export function useInitialHistoryRows(rows: ChatListRow[], place?: ReadingPlace | null) {
  const [edge, setEdge] = useState(() => {
    if (!place) return null;
    const i = rows.findIndex((row) => {
      const id = identity(row);
      return id && compare(id, place) <= 0;
    });
    return i > 10 ? identity(rows[i - 10]) : null;
  });
  const first = edge
    ? rows.findIndex((row) => {
        const id = identity(row);
        return id && compare(id, edge) <= 0;
      })
    : 0;
  return {
    rows: first > 0 ? rows.slice(first) : rows,
    hasNewer: first > 0,
    revealNewer: () => setEdge(first > 30 ? identity(rows[first - 30]) : null),
    revealLatest: () => setEdge(null),
  };
}

export function useReadingPlace(
  chat: string,
  initial: ReadingPlace | null | undefined,
  rows: ChatListRow[],
  enabled: boolean,
  list: RefObject<FlatList<ChatListRow> | null>,
  metrics: RefObject<{ offset: number; content: number; viewport: number }>,
  viewportRef: RefObject<View | null>,
  onReached: (point: Reached) => void,
) {
  const reader = useHistoryReader();
  const [layouts] = useState<Layouts>(() => ({ positions: new Map(), nodes: new Map() }));
  const [pending, setPending] = useState(initial ?? null);
  const held = useRef(!!initial);
  const [layoutVersion, remeasure] = useReducer((n: number) => n + 1, 0);
  const [last, setLast] = useState(initial ?? null);
  const [atLatest, setAtLatest] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const moving = useRef(false);
  const latest = useRef(rows);
  useLayoutEffect(() => {
    latest.current = rows;
  }, [rows]);

  const aligned = useRef(!initial);
  const capture = useCallback(
    (read = true, save = true) => {
      if (!enabled || !reader || !stillReader(reader) || pending || !aligned.current) return;
      const { offset, viewport } = metrics.current;
      if (viewport <= 0) return;
      if (save) setAtLatest(offset <= 1);
      const frame = viewportRef.current?.getBoundingClientRect?.();
      if (!frame?.height) return;
      let best: ReadingPlace | null = null;
      let farthest: Reached | null = null;
      for (const row of latest.current) {
        const rect = layouts.nodes.get(row.key)?.getBoundingClientRect?.();
        if (!rect?.height) continue;
        const top = rect.top - frame.top;
        if (top >= frame.height || top + rect.height <= 0) continue;
        const id = identity(row);
        if (id && (!best || top < best.offset)) best = { ...id, offset: top };
        if (id && (!farthest || compare(id, farthest) > 0)) farthest = id;
      }
      if (read && farthest) onReached(farthest);
      if (save && best && !held.current) {
        const saved = best;
        setLast((current) =>
          current?.key === saved.key && current.offset === saved.offset ? current : saved,
        );
        localHistory().savePlace({ reader, chat }, best);
      }
    },
    [chat, reader, enabled, pending, layouts, metrics, viewportRef, onReached],
  );

  const settled = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      moving.current = false;
      if (held.current) remeasure();
      else capture();
    }, 160);
  }, [capture]);
  useLayoutEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') capture(false);
      else settled();
    });
    return () => {
      clearTimeout(timer.current);
      capture(false);
      sub.remove();
    };
  }, [capture, settled]);
  useLayoutEffect(() => {
    if (enabled && !pending && !held.current) settled();
  }, [enabled, pending, rows, settled]);

  const anchor = pending ?? last;
  const indexOf = (p: ReadingPlace) => rows.findIndex((row) => identity(row)?.key === p.key);
  let index = anchor ? indexOf(anchor) : -1;
  if (anchor && index < 0 && rows.length) {
    const available = rows
      .flatMap((row, i) => {
        const id = identity(row);
        if (!id) return [];
        return [{ id, i }];
      })
      .sort((a, b) => compare(a.id, b.id));
    index = (available.find(({ id }) => compare(id, anchor) >= 0) ?? available.at(-1))?.i ?? -1;
  }
  const target = rows[index];
  useLayoutEffect(() => {
    if (!enabled || !reader || !anchor || moving.current || !rows.length || !target) return;
    const id = identity(target);
    if (!id || (!pending && !held.current && id.key === anchor.key)) return;
    aligned.current = false;
    let frame = 0;
    let cancelled = false;
    let stableFrames = 0;
    const align = () => {
      if (cancelled) return;
      const rect = layouts.positions.get(target.key);
      const { content, viewport, offset } = metrics.current;

      if (rect && viewport && content) {
        const native = layouts.nodes.get(target.key)?.getBoundingClientRect?.();
        const frameRect = viewportRef.current?.getBoundingClientRect?.();
        const top =
          native?.height && frameRect?.height
            ? native.top - frameRect.top
            : viewport + offset - rect.y - rect.height;
        // A replacement (or an edited anchor) can be shorter than the clipped part
        // of the former bubble. Keep its first readable line in the viewport.
        const height = native?.height || rect.height;
        const targetTop = anchor.offset <= -height ? 0 : anchor.offset;
        const desired = Math.max(0, Math.min(content - viewport, offset + targetTop - top));
        if (Math.abs(desired - offset) < 1 && content >= rect.y + rect.height - 1) {
          if (++stableFrames >= 3) {
            if (id.key !== anchor.key || targetTop !== anchor.offset) {
              const restored = { ...id, offset: targetTop };
              held.current = true;
              setLast(restored);
              localHistory().savePlace({ reader, chat }, restored);
            }
            setAtLatest(offset <= 1);
            aligned.current = true;
            setPending(null);
            if (!pending) capture();
            return;
          }
        } else {
          stableFrames = 0;
          list.current?.scrollToOffset({ offset: desired, animated: false });
        }
      } else if (!rect && content && viewport) {
        list.current?.scrollToIndex({ index, animated: false });
      }
      frame = requestAnimationFrame(align);
    };
    frame = requestAnimationFrame(align);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [
    anchor,
    capture,
    chat,
    enabled,
    index,
    layoutVersion,
    layouts,
    list,
    metrics,
    pending,
    reader,
    rows.length,
    target,
    viewportRef,
  ]);
  return {
    layouts,
    atLatest,
    hidden: enabled && !!pending && !!target,
    layoutChanged: () => {
      if (held.current) remeasure();
      else settled();
    },
    moving: () => {
      moving.current = true;
      capture(true, false);
      settled();
    },
    interrupt: () => {
      held.current = false;
      aligned.current = true;
      setPending(null);
    },
    settled,
    capture,
  };
}
