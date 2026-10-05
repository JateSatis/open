// Мутация `.value` у shared value — штатный API Reanimated, а не нарушение
// чистоты, которое видит в этом React Compiler.
/* eslint-disable react-hooks/immutability */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard } from 'react-native';
import {
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';

import { chatOpacity, liftProgress, liftRest, liftTop, type LiftLayout } from './liftPath';
import type { PanelGeometry } from './panelGeometry';

import type { AnchorRect } from '@/features/chats/MessageContextMenu';
import {
  chatFade,
  liftedRowKey,
  type ChatArea,
  type CommentsLiftHost,
} from '@/features/interactions/comments/commentsLift';
import { Opacity, Spacing } from '@/theme';

/** Зазор между низом поднятого сообщения и верхом шита. */
const LIFT_GAP = Spacing.two;
/** Строка считается вставшей, когда не двигалась столько. */
const SETTLE_MS = 200;
/** Дольше этого строку не ждём: шит выезжает без поднятого сообщения. */
const SETTLE_TIMEOUT_MS = 2000;
/**
 * Столько кадров копия стоит поверх ещё видимой строки, прежде чем строку
 * спрятать: окно шита рисует свой кадр позже окна приложения, и спрятанная
 * сразу строка на кадр оставляла бы пустое место.
 */
const HANDOVER_FRAMES = 3;
/**
 * Столько копия с фото или видео рисуется невидимой: картинки в ней грузятся
 * заново (из памяти, но не мгновенно), и до этого на месте плиток серая
 * заглушка — поверх настоящих плиток строки она мигала бы.
 */
const MEDIA_WARMUP_MS = 120;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

function sameRect(a: AnchorRect, b: AnchorRect): boolean {
  return Math.abs(a.y - b.y) < 0.5 && Math.abs(a.height - b.height) < 0.5;
}

/**
 * Замер строки, которая ещё может ехать — прокрутка к ней после перехода по
 * пересланному комментарию, клавиатура чата уходит вниз. Ждём, пока она
 * постоит на месте.
 */
async function measureSettled(
  measure: () => Promise<AnchorRect | null>,
): Promise<AnchorRect | null> {
  const deadline = Date.now() + SETTLE_TIMEOUT_MS;
  let last: AnchorRect | null = null;
  let stillSince = Date.now();

  while (Date.now() < deadline) {
    const rect = await measure();

    if (rect && last && sameRect(rect, last)) {
      if (Date.now() - stillSince >= SETTLE_MS) return rect;
    } else {
      stillSince = Date.now();
    }

    last = rect;
    await nextFrame();
  }

  return last;
}

/** Копия над шитом: где она стоит по горизонтали и в каких границах видна. */
export type LiftedCopy = { rowKey: string; anchor: AnchorRect; area: ChatArea };

type Options = {
  host: CommentsLiftHost | undefined;
  /** Ключ строки переписки, у которой открыли комментарии. */
  rowKey: string | undefined;
  /** Строка может ещё ехать: замерить, когда встанет. */
  settle: boolean;
  /** Окно шита на экране — с этого момента замер имеет смысл. */
  shown: boolean;
  geometry: PanelGeometry;
  dismissY: SharedValue<number>;
};

/**
 * Сообщение над шитом комментариев. Строку в переписке меряем в окне, копию
 * ставим ровно на её место в окне шита, под листом шита, и дальше ведём по
 * ходу шита (`liftPath`). Копия обрезана окном списка переписки: ушедшая под
 * шапку чата или поле ввода часть строки не видна и у копии.
 *
 * Копия и строка совпадают пиксель в пиксель, поэтому их смена не видна,
 * пока на экране есть хоть одна из них: при открытии копия появляется поверх
 * строки и только потом строка прячется (`liftedRowKey`), при закрытии строка
 * возвращается в кадре, где шит доехал, под ещё видимую копию.
 */
export function useCommentsLift({ host, rowKey, settle, shown, geometry, dismissY }: Options) {
  const [copy, setCopy] = useState<LiftedCopy | null>(null);
  const [ready, setReady] = useState(!host || !rowKey);
  const layout = useSharedValue<LiftLayout | null>(null);
  const areaTop = useSharedValue(0);
  const copyShown = useSharedValue(false);
  const geometryRef = useRef(geometry);
  const settleRef = useRef(settle || Keyboard.isVisible());
  // Хост меняется с каждой перерисовкой переписки (копия рисуется свежей), а
  // замер — один на открытие.
  const hostRef = useRef(host);
  const hasHost = host !== undefined;
  const measured = useRef(false);

  useEffect(() => {
    geometryRef.current = geometry;
    hostRef.current = host;
  }, [geometry, host]);

  const place = useCallback(
    (rect: AnchorRect, area: ChatArea, keepRest: boolean) => {
      const { top, height } = geometryRef.current;
      const rest =
        keepRest && layout.value
          ? layout.value.rest
          : liftRest(top, LIFT_GAP, rect.height, area.top);

      layout.value = {
        origin: rect.y,
        height: rect.height,
        rest,
        sheetTop: top,
        sheetHeight: height,
        gap: LIFT_GAP,
      };
      areaTop.value = area.top;
    },
    [areaTop, layout],
  );

  useEffect(() => {
    const current = hostRef.current;

    if (!shown || !current || !rowKey || measured.current) return;

    // Один замер на открытие: окно шита рождается заново для каждого.
    measured.current = true;
    const measure = () => current.measureRow(rowKey);

    void (async () => {
      // Окно переписки — после строки: уходящая клавиатура чата меняет и его.
      const rect = settleRef.current ? await measureSettled(measure) : await measure();
      const area = await current.measureArea();

      if (!rect || !area) {
        setReady(true);
        return;
      }

      place(rect, area, false);
      setCopy({ rowKey, anchor: rect, area });
    })();
  }, [place, rowKey, shown]);

  /** Копия разложена — она видна, следом прячется строка, и шит может ехать. */
  const handedOver = useRef(false);
  const onCopyLayout = useCallback(() => {
    if (!copy || handedOver.current) return;

    handedOver.current = true;

    void (async () => {
      if (hostRef.current?.hasMedia(copy.rowKey)) await wait(MEDIA_WARMUP_MS);

      copyShown.value = true;

      for (let frame = 0; frame < HANDOVER_FRAMES; frame += 1) await nextFrame();

      liftedRowKey.value = copy.rowKey;
      setReady(true);
    })();
  }, [copy, copyShown]);

  /**
   * Перед закрытием — к тому месту, где строка стоит сейчас: пока шит был
   * открыт, могли прийти новые сообщения. Положение над шитом не меняется,
   * поэтому копия не дёргается.
   */
  const prepareClose = useCallback(async () => {
    const current = hostRef.current;

    if (!current || !copy) return;

    const [rect, area] = await Promise.all([
      current.measureRow(copy.rowKey),
      current.measureArea(),
    ]);

    if (!rect || !area) return;

    place(rect, area, true);
    setCopy((current) => (current ? { ...current, anchor: rect, area } : current));
  }, [copy, place]);

  // Переписка под шитом растворяется и проявляется по ходу шита.
  const sheetHeight = geometry.height;

  useAnimatedReaction(
    () => (hasHost ? chatOpacity(layout.value, dismissY.value, sheetHeight) : 1),
    (opacity) => {
      if (hasHost) chatFade.value = opacity;
    },
  );

  useEffect(
    () => () => {
      // Окно ушло не через закрытие (уход с экрана) — переписку вернуть.
      if (rowKey && liftedRowKey.value === rowKey) liftedRowKey.value = null;
      if (hasHost) chatFade.value = 1;
    },
    [hasHost, rowKey],
  );

  const copyStyle = useAnimatedStyle(() => {
    const current = layout.value;

    if (!current || !copyShown.value) return { opacity: 0 };

    const dim = (1 - Opacity.liftedMessage) * liftProgress(current, dismissY.value);

    return {
      opacity: 1 - dim,
      transform: [{ translateY: liftTop(current, dismissY.value) - areaTop.value }],
    };
  });

  return { copy, ready, onCopyLayout, prepareClose, copyStyle };
}
