import { createPopImpression, segmentMs, segmentsCount } from './popImpression';

/** Часы теста и плеер, который отдаёт время каждые 100 мс, пока играет. */
function harness(durationMs: number) {
  let t = 1_000_000;
  const now = () => t;
  const impression = createPopImpression({ popId: 'p1', durationMs, now });
  let pos = 0;

  const play = (ms: number, step = 100, rate = 1) => {
    for (let passed = 0; passed < ms; passed += step) {
      t += step;
      pos += step * rate;

      if (pos >= durationMs) pos -= durationMs;

      impression.onTime(pos / 1000);
    }
  };

  const wait = (ms: number) => {
    t += ms;
  };

  const start = () => {
    impression.onStatus('readyToPlay');
    impression.onPlaying(true);
    impression.onTime(0);
  };

  return {
    impression,
    play,
    wait,
    start,
    seekTo: (ms: number) => {
      pos = ms;
    },
    position: () => pos,
  };
}

describe('показ попа', () => {
  it('сегменты: 1 с у коротких, 2% длины у длинных, не больше 50', () => {
    expect(segmentMs(8000)).toBe(1000);
    expect(segmentsCount(8000)).toBe(8);
    expect(segmentMs(120_000)).toBe(2400);
    expect(segmentsCount(120_000)).toBe(50);
    expect(segmentsCount(500)).toBe(1);
  });

  it('5 с просмотра 20-секундного попа: watch ≈ 5 с, покрытие — первые 5 сегментов, время до кадра', () => {
    const h = harness(20_000);

    h.wait(300);
    h.start();
    h.play(5000);

    const snap = h.impression.end();

    expect(snap?.watch_ms).toBeGreaterThanOrEqual(4800);
    expect(snap?.watch_ms).toBeLessThanOrEqual(5000);
    expect(snap?.coverage).toBe(0b11111);
    expect(snap?.first_frame_ms).toBe(400);
    expect(snap?.loops).toBe(0);
    expect(snap?.visible_ms).toBe(5300);
  });

  it('досмотр до третьего круга: два перехода через конец, покрытие полное', () => {
    const h = harness(8000);

    h.start();
    h.play(8000 * 2 + 3000);

    const snap = h.impression.end();

    expect(snap?.loops).toBe(2);
    expect(snap?.coverage).toBe(2 ** 8 - 1);
    expect(snap?.max_pos_ms).toBeGreaterThan(7800);
  });

  it('перемотка ползунком назад и вперёд: направления, позиции, жест; перемотанное не покрыто', () => {
    const h = harness(10_000);

    h.start();
    h.play(6000);
    h.impression.scrubStart();
    h.impression.scrubMove(4000);
    h.wait(400);
    h.impression.scrubMove(500);
    h.impression.scrubEnd(500);
    h.seekTo(500);
    h.play(1000);
    h.impression.scrubStart();
    h.wait(700);
    h.impression.scrubMove(9500);
    h.impression.scrubEnd(9500);
    h.seekTo(9500);
    h.play(400);

    const snap = h.impression.end();

    expect(snap?.seeks_back).toBe(1);
    expect(snap?.seeks_fwd).toBe(1);
    expect(snap?.seeks).toEqual([
      { from: 6000, to: 500, gesture_ms: 400, travel_ms: 5500 },
      { from: 1500, to: 9500, gesture_ms: 700, travel_ms: 8000 },
    ]);
    // Сегменты 6–8 перемотаны, а не просмотрены.
    expect(snap?.coverage).toBe(0b1000111111);
  });

  it('пауза тапом на 3 с: пауза с причиной и длительностью, watch её не включает', () => {
    const h = harness(20_000);

    h.start();
    h.play(2000);
    h.impression.setPaused(true, 'tap');
    h.impression.onPlaying(false);
    h.wait(3000);
    h.impression.setPaused(false);
    h.impression.onPlaying(true);
    h.play(2000);

    const snap = h.impression.end();

    expect(snap?.pauses).toBe(1);
    expect(snap?.pause_ms).toBe(3000);
    expect(snap?.pause_reasons).toEqual({ tap: 3000 });
    expect(snap?.pause_list).toEqual([{ at: 2000, ms: 3000, reason: 'tap' }]);
    expect(snap?.watch_ms).toBeLessThanOrEqual(4000);
    expect(snap?.watch_ms).toBeGreaterThanOrEqual(3800);
  });

  it('буферизация после первого кадра считается доставкой и не идёт в watch', () => {
    const h = harness(20_000);

    h.start();
    h.play(1000);
    h.impression.onStatus('loading');
    h.wait(1500);
    h.impression.onStatus('readyToPlay');
    h.play(1000);

    const snap = h.impression.end();

    expect(snap?.buffering_count).toBe(1);
    expect(snap?.buffering_ms).toBe(1500);
    expect(snap?.watch_ms).toBeLessThanOrEqual(2000);
  });

  it('ошибка загрузки и чёрный экран: кадра не было — время до кадра пустое, watch ноль', () => {
    const h = harness(20_000);

    h.impression.onStatus('loading');
    h.wait(4000);
    h.impression.onStatus('error', 'source failed');

    const snap = h.impression.end();

    expect(snap?.error).toBe('source failed');
    expect(snap?.first_frame_ms).toBeUndefined();
    expect(snap?.watch_ms).toBe(0);
    expect(snap?.buffering_count).toBe(0);
  });

  it('громкость и маршрут звука: старт, изменения, минимум и максимум', () => {
    const h = harness(20_000);

    h.impression.onAudio({ volume: 0.5, muted: false, route: 'speaker' });
    h.start();
    h.wait(1000);
    h.impression.onAudio({ volume: 0.7, muted: false, route: 'speaker' });
    h.wait(1000);
    h.impression.onAudio({ volume: 0.7, muted: false, route: 'wired' });
    h.wait(1000);
    h.impression.onAudio({ volume: 0, muted: true, route: 'speaker' });

    const snap = h.impression.end();

    expect(snap?.volume_start).toBe(0.5);
    expect(snap?.volume_min).toBe(0);
    expect(snap?.volume_max).toBe(0.7);
    expect(snap?.muted).toBe(true);
    expect(snap?.volume_changes).toEqual([
      { t: 1000, v: 0.7, m: false },
      { t: 3000, v: 0, m: true },
    ]);
    expect(snap?.route_changes).toEqual([
      { t: 2000, r: 'wired' },
      { t: 3000, r: 'speaker' },
    ]);
  });

  it('2× по удержанию: время в 2× отдельно, покрытие идёт вдвое быстрее', () => {
    const h = harness(20_000);

    h.start();
    h.impression.setRate(2);
    h.play(2000, 100, 2);

    const snap = h.impression.end();

    expect(snap?.fast_ms).toBeGreaterThanOrEqual(1900);
    expect(snap?.coverage).toBe(0b1111);
  });

  it('конец показа — один раз', () => {
    const h = harness(5000);

    h.start();
    expect(h.impression.end()).not.toBeNull();
    expect(h.impression.end()).toBeNull();
  });
});
