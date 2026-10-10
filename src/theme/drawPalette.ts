/**
 * Сетка цветов в панели цвета рисования: верхний ряд — от белого к чёрному,
 * ниже — оттенки слева направо от синего через фиолетовый, красный и жёлтый
 * к зелёному, сверху вниз — от тёмного к светлому. Одинаковая в обеих темах:
 * инструмент на тёмном фоне предпросмотра.
 *
 * Считается формулой HSL, а не таблицей: шаг по оттенку и светлоте ровный,
 * и сетку легко перестроить, поменяв числа ниже.
 */
/**
 * Оттенки столбцов, градусы: от синего через фиолетовый, красный и оранжевый
 * к зелёному. Шаг неровный — у жёлто-оранжевых гуще: на глаз они различаются
 * сильнее, а у ровного шага жёлтый проваливается между оранжевым и салатовым.
 */
const HUES = [215, 250, 280, 315, 350, 15, 32, 50, 85, 130];
const SATURATION = 0.9;
/** Светлота рядов оттенков — сверху вниз, от тёмного к светлому. */
const LIGHTNESS = [0.2, 0.3, 0.4, 0.5, 0.62, 0.74, 0.86];

function channel(value: number): string {
  return Math.round(value * 255)
    .toString(16)
    .padStart(2, '0');
}

/** HSL (оттенок в градусах, насыщенность и светлота 0…1) → `#rrggbb`. */
export function hslHex(hue: number, saturation: number, lightness: number): string {
  const a = saturation * Math.min(lightness, 1 - lightness);
  const f = (n: number) => {
    const k = (n + hue / 30) % 12;

    return lightness - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };

  return `#${channel(f(0))}${channel(f(8))}${channel(f(4))}`;
}

const COLUMNS = HUES.length;

const grays = Array.from({ length: COLUMNS }, (_, i) => hslHex(0, 0, 1 - i / (COLUMNS - 1)));

const hues = LIGHTNESS.map((lightness) => HUES.map((hue) => hslHex(hue, SATURATION, lightness)));

/** Ряды сетки сверху вниз, цвета `#rrggbb`. */
export const DrawPalette: readonly (readonly string[])[] = [grays, ...hues];
export const DRAW_PALETTE_COLUMNS = COLUMNS;
