/**
 * Цвета тегов «Сохранённых»: номер цвета хранит база (по кругу, 12 штук —
 * столько же, сколько здесь). Заливка выбранного чипа и метки на облачке —
 * `fill`, надпись на ней — `text`. В тёмной теме заливки светлее и надпись
 * тёмная: насыщенный цвет на чёрном читается хуже пастельного.
 */
export type SavedTagTone = { fill: string; text: string };

const LIGHT_TEXT = '#ffffff';
const DARK_TEXT = '#111113';

export const SavedTagPalette: Record<'light' | 'dark', readonly SavedTagTone[]> = {
  light: [
    { fill: '#3C87F7', text: LIGHT_TEXT },
    { fill: '#E5484D', text: LIGHT_TEXT },
    { fill: '#30A46C', text: LIGHT_TEXT },
    { fill: '#E2760B', text: LIGHT_TEXT },
    { fill: '#8E4EC6', text: LIGHT_TEXT },
    { fill: '#0E9AA7', text: LIGHT_TEXT },
    { fill: '#D6409F', text: LIGHT_TEXT },
    { fill: '#A17A12', text: LIGHT_TEXT },
    { fill: '#3E63DD', text: LIGHT_TEXT },
    { fill: '#5F8F2A', text: LIGHT_TEXT },
    { fill: '#AD5A2D', text: LIGHT_TEXT },
    { fill: '#6E7480', text: LIGHT_TEXT },
  ],
  dark: [
    { fill: '#70A7FF', text: DARK_TEXT },
    { fill: '#FF8589', text: DARK_TEXT },
    { fill: '#4CC38A', text: DARK_TEXT },
    { fill: '#FFA057', text: DARK_TEXT },
    { fill: '#BF8EF0', text: DARK_TEXT },
    { fill: '#3FC6D0', text: DARK_TEXT },
    { fill: '#F28CC6', text: DARK_TEXT },
    { fill: '#E5C350', text: DARK_TEXT },
    { fill: '#8DA4F2', text: DARK_TEXT },
    { fill: '#9ACD5C', text: DARK_TEXT },
    { fill: '#E59D72', text: DARK_TEXT },
    { fill: '#B0B4BA', text: DARK_TEXT },
  ],
};

/** Цвет тега по его номеру; номер вне палитры — по кругу. */
export function savedTagTone(scheme: 'light' | 'dark', color: number): SavedTagTone {
  const palette = SavedTagPalette[scheme];

  return palette[((color % palette.length) + palette.length) % palette.length];
}
