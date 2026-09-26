/**
 * Сколько столбиков у формы волны голосового. Столько же хранится в базе
 * (`attachments.waveform`, не больше 64) и столько рисует облачко: волна
 * снимается один раз при записи и дальше не пересчитывается.
 */
export const WAVEFORM_BARS = 50;

/** Верх шкалы столбика: 5 бит, как у Telegram. Совпадает с CHECK в базе. */
export const WAVEFORM_MAX = 31;

/**
 * Ниже этого пика запись считается тишиной целиком, и волна не растягивается
 * на всю высоту: иначе шум пустой комнаты выглядел бы как крик.
 */
const QUIET_PEAK = 0.3;

/**
 * Уровни микрофона 0..1, снятые во время записи (раз в 100 мс), → ровно
 * `WAVEFORM_BARS` целых 0..31. Каждый столбик — максимум своего отрезка: пики
 * читаются лучше среднего, слова не сливаются в ровную полосу. Короткая запись,
 * где сэмплов меньше столбиков, растягивается повтором.
 *
 * Пустой вход — `null`: волны нет, и выдумывать её нельзя.
 */
export function downsampleWaveform(levels: readonly number[]): number[] | null {
  if (levels.length === 0) return null;

  const bars: number[] = [];

  for (let bar = 0; bar < WAVEFORM_BARS; bar += 1) {
    const from = Math.floor((bar * levels.length) / WAVEFORM_BARS);
    const to = Math.max(from + 1, Math.floor(((bar + 1) * levels.length) / WAVEFORM_BARS));
    let peak = 0;

    for (let index = from; index < to; index += 1) {
      peak = Math.max(peak, clampUnit(levels[index]));
    }

    bars.push(peak);
  }

  const scale = Math.max(QUIET_PEAK, ...bars);

  return bars.map((value) => Math.round((value / scale) * WAVEFORM_MAX));
}

function clampUnit(value: number | undefined): number {
  if (value === undefined || Number.isNaN(value)) return 0;

  return Math.min(1, Math.max(0, value));
}
