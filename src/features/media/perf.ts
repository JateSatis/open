/**
 * Инструментация грида и шита выбора медиа. Выключена константой: включается
 * руками на время разбора конкретного фриза, в обычной сборке от неё не
 * остаётся ничего, кроме проверки `if (!MEDIA_PERF)`.
 *
 * Мерить приходится именно так: анимация шита живёт на UI-потоке, а тормозит
 * её загруженный JS-поток, и увидеть это можно только по промежуткам между
 * кадрами самого JS-потока — не по виду анимации.
 */
export const MEDIA_PERF = false;

/** Кадр длиннее этого — пропущенный: на 60 Гц бюджет кадра 16.7 мс. */
const DROPPED_FRAME_MS = 32;

export function perfLog(label: string, payload?: Record<string, unknown>): void {
  if (!MEDIA_PERF) return;

  console.log(`[perf] ${label}`, payload ? JSON.stringify(payload) : '');
}

/** Засекает время асинхронной операции и логирует его вместе с меткой. */
export async function perfTime<T>(label: string, run: () => Promise<T>): Promise<T> {
  if (!MEDIA_PERF) return run();

  const startedAt = performance.now();

  try {
    return await run();
  } finally {
    perfLog(label, { ms: Math.round(performance.now() - startedAt) });
  }
}

type FrameProbe = {
  stop: () => void;
};

/**
 * Считает промежутки между кадрами JS-потока. Пока идёт анимация шита, поток
 * должен быть свободен — каждый пропущенный кадр здесь это работа, которая
 * отняла время у анимации.
 */
export function probeJsFrames(label: string, durationMs: number): FrameProbe {
  if (!MEDIA_PERF) return { stop: () => undefined };

  const startedAt = performance.now();
  let previous = startedAt;
  let frames = 0;
  let dropped = 0;
  let worst = 0;
  let blockedMs = 0;
  let running = true;

  const tick = () => {
    if (!running) return;

    const now = performance.now();
    const gap = now - previous;

    previous = now;
    frames += 1;

    if (gap > DROPPED_FRAME_MS) {
      dropped += 1;
      blockedMs += gap;
      worst = Math.max(worst, gap);
    }

    if (now - startedAt >= durationMs) {
      stop();
      return;
    }

    requestAnimationFrame(tick);
  };

  const stop = () => {
    if (!running) return;

    running = false;
    perfLog(`${label}: кадры JS`, {
      totalMs: Math.round(performance.now() - startedAt),
      frames,
      dropped,
      worstGapMs: Math.round(worst),
      blockedMs: Math.round(blockedMs),
    });
  };

  requestAnimationFrame(tick);

  return { stop };
}

/**
 * Счётчик рендеров: сколько раз компонент отрисовался между двумя отчётами.
 * Нужен, чтобы увидеть цену одного тапа по кружку выбора.
 */
const renderCounts = new Map<string, number>();

export function countRender(label: string): void {
  if (!MEDIA_PERF) return;

  renderCounts.set(label, (renderCounts.get(label) ?? 0) + 1);
}

export function reportRenders(label: string): void {
  if (!MEDIA_PERF) return;

  perfLog(`${label}: рендеров`, Object.fromEntries(renderCounts));
  renderCounts.clear();
}
