/**
 * Плитка для повторяющейся сетки скелета.
 *
 * Скелет обязан существовать независимо от виртуализации: на быстром броске
 * список не успевает смонтировать клетки (замер на записи экрана: до 2.5 с,
 * когда на экране нет вообще ни одной), и место под клетку должно быть занято
 * заранее — не вью, которую кто-то не успел создать, а одним слоем, который
 * нарисован всегда.
 *
 * Горизонтальные зазоры сетки — единственное, что в этом слое повторяется
 * тысячу раз. Их рисует одна картинка высотой в шаг сетки, растиражированная
 * `resizeMode="repeat"`: тиражирование идёт в физических пикселях, поэтому шаг
 * не «уплывает» на тысячной строке, как уплыл бы при дробном размере в dp.
 * Вертикальных зазоров всего два, они рисуются обычными вью.
 *
 * Картинка собирается здесь же, в виде data-URI: её размер зависит от плотности
 * и ширины конкретного экрана, поэтому заранее положить её в ассеты нельзя.
 * Данные внутри PNG не сжимаются (deflate «stored»), и это осознанно: плитка
 * шириной в один пиксель весит меньше двух килобайт, а полноценный компрессор
 * ради неё тащить незачем.
 */

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Максимум данных в одном несжатом блоке deflate. */
const STORED_BLOCK_LIMIT = 0xffff;

const crcTable = (() => {
  const table = new Uint32Array(256);

  for (let index = 0; index < 256; index += 1) {
    let value = index;

    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }

    table[index] = value >>> 0;
  }

  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;

  for (const byte of bytes) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;

  for (const byte of bytes) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }

  return ((b << 16) | a) >>> 0;
}

function uint32(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function chunk(type: string, data: number[]): number[] {
  const typeBytes = [...type].map((char) => char.charCodeAt(0));
  const body = Uint8Array.from([...typeBytes, ...data]);

  return [...uint32(data.length), ...body, ...uint32(crc32(body))];
}

/** zlib-поток без сжатия: заголовок, «сохранённые» блоки, контрольная сумма. */
function zlibStored(data: Uint8Array): number[] {
  const out: number[] = [0x78, 0x01];

  for (let offset = 0; offset < data.length; offset += STORED_BLOCK_LIMIT) {
    const slice = data.subarray(offset, offset + STORED_BLOCK_LIMIT);
    const isLast = offset + STORED_BLOCK_LIMIT >= data.length;

    out.push(isLast ? 1 : 0);
    out.push(slice.length & 0xff, (slice.length >>> 8) & 0xff);
    out.push(~slice.length & 0xff, (~slice.length >>> 8) & 0xff);
    out.push(...slice);
  }

  return [...out, ...uint32(adler32(data))];
}

function toBase64(bytes: number[]): string {
  let out = '';

  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index];
    const b = bytes[index + 1];
    const c = bytes[index + 2];
    const triple = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);

    out += BASE64_ALPHABET[(triple >>> 18) & 63];
    out += BASE64_ALPHABET[(triple >>> 12) & 63];
    out += b === undefined ? '=' : BASE64_ALPHABET[(triple >>> 6) & 63];
    out += c === undefined ? '=' : BASE64_ALPHABET[triple & 63];
  }

  return out;
}

export type Rgb = { r: number; g: number; b: number };

/** `#rgb` и `#rrggbb`; другие записи цвета в теме для этих токенов не встречаются. */
export function parseHexColor(color: string): Rgb {
  const hex = color.replace('#', '');
  const full =
    hex.length === 3
      ? [...hex].map((char) => char + char).join('')
      : hex.slice(0, 6).padEnd(6, '0');

  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

export type RuleTileParams = {
  /** Высота плитки — шаг сетки в физических пикселях. */
  pitchPx: number;
  /** Толщина зазора в физических пикселях. */
  rulePx: number;
  /** Цвет зазора — фон шита. */
  color: Rgb;
};

/**
 * Плитка шириной в пиксель и высотой в шаг сетки: сверху прозрачно, снизу —
 * полоса зазора. Растиражированная, она даёт горизонтальные зазоры сетки на
 * любую высоту содержимого.
 */
export function horizontalRuleTile({ pitchPx, rulePx, color }: RuleTileParams): string {
  const height = Math.max(1, Math.round(pitchPx));
  const rule = Math.min(height, Math.max(1, Math.round(rulePx)));
  // Строка PNG — байт фильтра плюс сами пиксели; ширина плитки ровно один
  // пиксель, по горизонтали она размножается сама.
  const raw = new Uint8Array(height * 5);

  for (let y = 0; y < height; y += 1) {
    const at = y * 5;
    const inRule = y >= height - rule;

    raw[at] = 0;
    raw[at + 1] = inRule ? color.r : 0;
    raw[at + 2] = inRule ? color.g : 0;
    raw[at + 3] = inRule ? color.b : 0;
    raw[at + 4] = inRule ? 255 : 0;
  }

  const ihdr = [...uint32(1), ...uint32(height), 8, 6, 0, 0, 0];
  const png = [
    ...PNG_SIGNATURE,
    ...chunk('IHDR', ihdr),
    ...chunk('IDAT', zlibStored(raw)),
    ...chunk('IEND', []),
  ];

  return `data:image/png;base64,${toBase64(png)}`;
}
