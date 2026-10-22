// Очистка метаданных загружаемых файлов: JPEG и ISO BMFF (MP4, MOV, M4A, 3GP).
//
// Правило Open: ни один файл, который отдаётся другим людям, не несёт
// метаданных о том, где, когда и чем он снят. Чистка не перекодирует: JPEG
// пересобирается из своих же сегментов, а у MP4 меняется ровно то, что
// раскрывает человека, — на месте и без сдвига байтов, поэтому видео любого
// размера обрабатывается потоком (`planIsoBmff` + `applyPlan`), а смещения
// кусков в `stco`/`co64` остаются верными.
//
// Вычищенное не сохраняется и не возвращается: функции отдают только чистый
// результат. Что не удалось разобрать — `UnsupportedMediaError`, и такой файл
// не публикуется.
//
// Модуль без зависимостей и без синтаксиса, которого нет в JavaScript (только
// типы): его же исполняет Node при разовом переносе старых файлов.

export class UnsupportedMediaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedMediaError';
  }
}

function fail(message: string): never {
  throw new UnsupportedMediaError(message);
}

// =============================================================================
// JPEG
// =============================================================================

const SOI = 0xd8;
const EOI = 0xd9;
const SOS = 0xda;
const APP0 = 0xe0;
const APP1 = 0xe1;
const APP2 = 0xe2;
const APP14 = 0xee;
const COM = 0xfe;

/** Предел картинки в памяти: фото после сжатия весит сотни килобайт. */
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

function ascii(bytes: Uint8Array, at: number, text: string): boolean {
  if (at + text.length > bytes.length) return false;

  for (let index = 0; index < text.length; index += 1) {
    if (bytes[at + index] !== text.charCodeAt(index)) return false;
  }

  return true;
}

export function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === SOI && bytes[2] === 0xff;
}

/**
 * Поворот кадра из EXIF (тег 0x0112 в IFD0) — единственное, что из EXIF
 * нужно для отрисовки. null — тега нет или EXIF не читается.
 */
function exifOrientation(segment: Uint8Array): number | null {
  // segment — полезная часть APP1 после длины: "Exif\0\0" + TIFF.
  if (!ascii(segment, 0, 'Exif\0\0')) return null;

  const tiff = 6;
  const little = ascii(segment, tiff, 'II');

  if (!little && !ascii(segment, tiff, 'MM')) return null;

  const view = new DataView(segment.buffer, segment.byteOffset, segment.byteLength);
  const u16 = (at: number) => view.getUint16(at, little);
  const u32 = (at: number) => view.getUint32(at, little);

  if (tiff + 8 > segment.length || u16(tiff + 2) !== 42) return null;

  const ifd = tiff + u32(tiff + 4);

  if (ifd + 2 > segment.length) return null;

  const count = u16(ifd);

  for (let index = 0; index < count; index += 1) {
    const entry = ifd + 2 + index * 12;

    if (entry + 12 > segment.length) return null;
    if (u16(entry) === 0x0112 && u16(entry + 2) === 3) {
      const value = u16(entry + 8);

      return value >= 1 && value <= 8 ? value : null;
    }
  }

  return null;
}

/** APP1 с одним тегом поворота — без камеры, даты и места. */
function orientationOnlyExif(orientation: number): Uint8Array {
  const payload = new Uint8Array(32);
  const view = new DataView(payload.buffer);

  payload.set([0x45, 0x78, 0x69, 0x66, 0, 0], 0); // "Exif\0\0"
  payload.set([0x4d, 0x4d], 6); // "MM": порядок байт старшим вперёд
  view.setUint16(8, 42);
  view.setUint32(10, 8); // IFD0 сразу за заголовком TIFF
  view.setUint16(14, 1); // один тег
  view.setUint16(16, 0x0112);
  view.setUint16(18, 3); // SHORT
  view.setUint32(20, 1);
  view.setUint16(24, orientation);
  view.setUint32(28, 0); // следующего IFD нет

  return segmentOf(APP1, payload);
}

/** JFIF без миниатюры: версия и плотность — из исходного, остальное отбрасывается. */
function minimalJfif(payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(14);

  out.set([0x4a, 0x46, 0x49, 0x46, 0], 0); // "JFIF\0"

  if (payload.length >= 12) {
    out.set(payload.subarray(5, 12), 5); // версия, единицы, плотность X и Y
  } else {
    out.set([1, 1, 0, 0, 1, 0, 1], 5);
  }

  out[12] = 0; // ширина миниатюры
  out[13] = 0; // высота миниатюры

  return segmentOf(APP0, out);
}

/**
 * Цветовой профиль нужен для верных цветов, но в его заголовке — дата
 * создания, производитель и модель устройства. Они обнуляются; ID профиля
 * тоже (ноль означает «не посчитан»), иначе он перестал бы сходиться.
 */
function scrubIccChunk(payload: Uint8Array): Uint8Array {
  const out = payload.slice();
  // "ICC_PROFILE\0" + номер куска + число кусков.
  const header = 14;

  if (out[12] === 1 && out.length >= header + 128) {
    out.fill(0, header + 24, header + 36); // дата и время создания
    out.fill(0, header + 48, header + 56); // производитель и модель устройства
    out.fill(0, header + 80, header + 100); // создатель профиля и его ID
  }

  return segmentOf(APP2, out);
}

function segmentOf(marker: number, payload: Uint8Array): Uint8Array {
  const length = payload.length + 2;

  if (length > 0xffff) fail('JPEG segment too long');

  const out = new Uint8Array(payload.length + 4);

  out[0] = 0xff;
  out[1] = marker;
  out[2] = length >> 8;
  out[3] = length & 0xff;
  out.set(payload, 4);

  return out;
}

/**
 * Чистый JPEG из исходного: остаются таблицы, кадр и скан, JFIF без
 * миниатюры, цветовой профиль без даты и устройства и Adobe-сегмент (нужен
 * для цветов CMYK). EXIF, XMP, IPTC, комментарии, прочие APPn и всё, что
 * дописано после конца картинки (у «живых фото» — целое видео), выбрасываются.
 * Поворот из EXIF переносится одним тегом: без него снимок лёг бы набок.
 */
export function sanitizeJpeg(bytes: Uint8Array): Uint8Array {
  if (!isJpeg(bytes)) fail('Not a JPEG');
  if (bytes.length > MAX_IMAGE_BYTES) fail('Image too large');

  const parts: Uint8Array[] = [new Uint8Array([0xff, SOI])];
  let jfif: Uint8Array | null = null;
  let orientation: number | null = null;
  let sawFrame = false;
  let sawScan = false;
  let ended = false;
  let at = 2;

  while (at < bytes.length) {
    if (bytes[at] !== 0xff) fail('JPEG marker expected');

    // Перед маркером допускаются байты-заполнители 0xFF.
    while (at < bytes.length && bytes[at] === 0xff) at += 1;
    if (at >= bytes.length) fail('Truncated JPEG');

    const marker = bytes[at];
    const start = at - 1;

    at += 1;

    if (marker === EOI) {
      ended = true;
      break;
    }

    // Маркеры без длины: RSTn и TEM.
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      parts.push(bytes.subarray(start, at));
      continue;
    }

    if (at + 2 > bytes.length) fail('Truncated JPEG');

    const length = (bytes[at] << 8) | bytes[at + 1];

    if (length < 2 || at + length > bytes.length) fail('Bad JPEG segment length');

    const payload = bytes.subarray(at + 2, at + length);
    const end = at + length;

    if (marker === APP0) {
      if (ascii(payload, 0, 'JFIF\0') && !jfif) jfif = minimalJfif(payload);
    } else if (marker === APP1) {
      orientation = orientation ?? exifOrientation(payload);
    } else if (marker === APP2) {
      if (ascii(payload, 0, 'ICC_PROFILE\0') && payload.length > 14) {
        parts.push(scrubIccChunk(payload));
      }
    } else if (marker === APP14) {
      if (ascii(payload, 0, 'Adobe')) parts.push(bytes.subarray(start, end));
    } else if ((marker >= 0xe3 && marker <= 0xef) || marker === COM) {
      // Прочие APPn и комментарии — метаданные, отрисовке не нужны.
    } else if (marker === SOS) {
      sawScan = true;
      parts.push(bytes.subarray(start, end));

      // Сжатые данные скана — до первого маркера, кроме 0xFF00 и RSTn.
      let scan = end;

      while (scan < bytes.length) {
        if (bytes[scan] === 0xff && scan + 1 < bytes.length) {
          const next = bytes[scan + 1];

          if (next !== 0 && !(next >= 0xd0 && next <= 0xd7) && next !== 0xff) break;
        }

        scan += 1;
      }

      if (scan >= bytes.length) fail('Truncated JPEG scan');

      parts.push(bytes.subarray(end, scan));
      at = scan;
      continue;
    } else {
      if ((marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)) {
        sawFrame = true;
      }

      parts.push(bytes.subarray(start, end));
    }

    at = end;
  }

  if (!ended || !sawFrame || !sawScan) fail('Incomplete JPEG');

  parts.push(new Uint8Array([0xff, EOI]));

  // JFIF обязан идти первым, EXIF — сразу за ним.
  const head: Uint8Array[] = [parts[0]];

  if (jfif) head.push(jfif);
  if (orientation !== null && orientation !== 1) head.push(orientationOnlyExif(orientation));

  return concat([...head, ...parts.slice(1)]);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;

  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }

  return out;
}

// =============================================================================
// ISO BMFF: MP4, MOV, M4A, 3GP
// =============================================================================

export type ByteRange = { start: number; end: number };
export type Patch = { offset: number; bytes: Uint8Array };

/**
 * Что сделать с файлом: заменить куски (`patches`) и обнулить диапазоны
 * (`zeros`). Длина файла не меняется.
 */
export type CleanPlan = { size: number; patches: Patch[]; zeros: ByteRange[] };

/** Чтение файла кусками: из памяти, с диска или запросами Range к Storage. */
export type ByteSource = {
  size: number;
  read: (offset: number, length: number) => Promise<Uint8Array>;
};

/** `moov` целиком в памяти: таблицы пятиминутного видео — единицы мегабайт. */
export const MAX_MOOV_BYTES = 48 * 1024 * 1024;
const MAX_TOP_LEVEL_BOXES = 4096;

type Box = { type: string; start: number; headerSize: number; end: number };

function fourcc(bytes: Uint8Array, at: number): string {
  return String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
}

function printable(type: string): boolean {
  for (let index = 0; index < 4; index += 1) {
    const code = type.charCodeAt(index);

    // © (0xA9) — первая буква атомов метаданных QuickTime.
    if (!((code >= 0x20 && code <= 0x7e) || code === 0xa9)) return false;
  }

  return true;
}

function readU64(view: DataView, at: number): number {
  const high = view.getUint32(at);
  const low = view.getUint32(at + 4);

  if (high > 0x1fffff) fail('Box too large');

  return high * 0x100000000 + low;
}

/** Заголовок коробки в `bytes` на позиции `at`; `limit` — конец родителя. */
function parseBox(bytes: Uint8Array, at: number, limit: number, base: number): Box {
  if (at + 8 > limit) fail('Truncated box header');

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const size32 = view.getUint32(at);
  const type = fourcc(bytes, at + 4);
  let headerSize = 8;
  let size: number;

  if (size32 === 1) {
    if (at + 16 > limit) fail('Truncated box header');
    size = readU64(view, at + 8);
    headerSize = 16;
  } else if (size32 === 0) {
    size = limit - at;
  } else {
    size = size32;
  }

  if (!printable(type)) fail('Not an ISO BMFF box');
  if (size < headerSize || at + size > limit) fail('Bad box size');

  return { type, start: base + at, headerSize, end: base + at + size };
}

function children(bytes: Uint8Array, from: number, to: number): Box[] {
  const boxes: Box[] = [];
  let at = from;

  while (at < to) {
    // Хвост из нулей меньше заголовка встречается в старых файлах QuickTime.
    if (to - at < 8) {
      if (bytes.subarray(at, to).some((byte) => byte !== 0)) fail('Garbage inside box');
      break;
    }

    const box = parseBox(bytes, at, to, 0);

    boxes.push(box);
    at = box.end;
  }

  return boxes;
}

/** Коробка становится `free` с нулями внутри: размер тот же, смысла нет. */
function neutralize(bytes: Uint8Array, box: Box): void {
  bytes.set([0x66, 0x72, 0x65, 0x65], box.start + 4); // "free"
  bytes.fill(0, box.start + box.headerSize, box.end);
}

/** Время создания и изменения в mvhd / tkhd / mdhd — в ноль. */
function zeroTimes(bytes: Uint8Array, box: Box): void {
  const payload = box.start + box.headerSize;

  if (payload + 4 > box.end) fail('Truncated full box');

  const version = bytes[payload];
  const width = version === 1 ? 8 : 4;

  if (payload + 4 + width * 2 > box.end) fail('Truncated full box');

  bytes.fill(0, payload + 4, payload + 4 + width * 2);
}

type SampleTables = {
  chunkOffsets: number[] | null;
  stsc: { firstChunk: number; samplesPerChunk: number }[] | null;
  sampleSize: number;
  sampleSizes: number[] | null;
  sampleCount: number;
};

function readSampleTables(bytes: Uint8Array, stbl: Box, tables: SampleTables): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  for (const box of children(bytes, stbl.start + stbl.headerSize, stbl.end)) {
    const p = box.start + box.headerSize + 4; // после версии и флагов
    const need = (count: number) => {
      if (p + count > box.end) fail('Truncated sample table');
    };

    if (box.type === 'stco' || box.type === 'co64') {
      need(4);
      const count = view.getUint32(p);
      const wide = box.type === 'co64';

      need(4 + count * (wide ? 8 : 4));
      tables.chunkOffsets = [];

      for (let index = 0; index < count; index += 1) {
        tables.chunkOffsets.push(
          wide ? readU64(view, p + 4 + index * 8) : view.getUint32(p + 4 + index * 4),
        );
      }
    } else if (box.type === 'stsc') {
      need(4);
      const count = view.getUint32(p);

      need(4 + count * 12);
      tables.stsc = [];

      for (let index = 0; index < count; index += 1) {
        tables.stsc.push({
          firstChunk: view.getUint32(p + 4 + index * 12),
          samplesPerChunk: view.getUint32(p + 8 + index * 12),
        });
      }
    } else if (box.type === 'stsz') {
      need(8);
      tables.sampleSize = view.getUint32(p);
      tables.sampleCount = view.getUint32(p + 4);

      if (tables.sampleSize === 0) {
        need(8 + tables.sampleCount * 4);
        tables.sampleSizes = [];

        for (let index = 0; index < tables.sampleCount; index += 1) {
          tables.sampleSizes.push(view.getUint32(p + 8 + index * 4));
        }
      }
    } else if (box.type === 'stz2') {
      fail('Compact sample sizes are not supported');
    }
  }
}

/** Байты, которые занимают сэмплы дорожки: куски по таблицам `stbl`. */
function sampleRanges(tables: SampleTables): ByteRange[] {
  const { chunkOffsets, stsc } = tables;

  if (!chunkOffsets || !stsc || (tables.sampleSize === 0 && !tables.sampleSizes)) {
    fail('Incomplete sample table');
  }

  const ranges: ByteRange[] = [];
  let sample = 0;

  for (let chunk = 0; chunk < chunkOffsets.length; chunk += 1) {
    // Последняя запись stsc, чей первый кусок не дальше текущего (нумерация с 1).
    let perChunk = 0;

    for (const entry of stsc) {
      if (entry.firstChunk <= chunk + 1) perChunk = entry.samplesPerChunk;
      else break;
    }

    let length = 0;

    for (let index = 0; index < perChunk; index += 1) {
      if (sample >= tables.sampleCount) fail('Sample table out of range');
      length += tables.sampleSize || (tables.sampleSizes as number[])[sample];
      sample += 1;
    }

    if (length > 0) ranges.push({ start: chunkOffsets[chunk], end: chunkOffsets[chunk] + length });
  }

  return ranges;
}

/** Тип обработчика дорожки из mdia/hdlr: vide, soun, meta, text… */
function trackHandler(bytes: Uint8Array, trak: Box): string | null {
  for (const box of children(bytes, trak.start + trak.headerSize, trak.end)) {
    if (box.type !== 'mdia') continue;

    for (const inner of children(bytes, box.start + box.headerSize, box.end)) {
      if (inner.type === 'hdlr' && inner.start + inner.headerSize + 12 <= inner.end) {
        return fourcc(bytes, inner.start + inner.headerSize + 8);
      }
    }
  }

  return null;
}

const KEPT_HANDLERS = new Set(['vide', 'soun']);
const STBL_KEEP = new Set([
  'stsd', 'stts', 'ctts', 'cslg', 'stss', 'stps', 'sdtp', 'sbgp', 'sgpd', 'subs', 'saiz',
  'saio', 'stsc', 'stsz', 'stco', 'co64', 'padb', 'stsh',
]);

/**
 * Чистит дорожку на месте. Видео и звук остаются, их сэмплы — в `keep`.
 * Остальные дорожки (таймкод, метаданные с координатами, субтитры камеры)
 * выключаются целиком, а их сэмплы обнулятся как невостребованная часть mdat.
 */
function cleanTrack(bytes: Uint8Array, trak: Box, keep: ByteRange[]): void {
  const handler = trackHandler(bytes, trak);

  if (!handler || !KEPT_HANDLERS.has(handler)) {
    neutralize(bytes, trak);
    return;
  }

  const tables: SampleTables = {
    chunkOffsets: null,
    stsc: null,
    sampleSize: 0,
    sampleSizes: null,
    sampleCount: 0,
  };

  for (const box of children(bytes, trak.start + trak.headerSize, trak.end)) {
    if (box.type === 'tkhd') zeroTimes(bytes, box);
    else if (box.type === 'mdia') cleanMedia(bytes, box, tables, handler);
    else if (box.type !== 'edts' && box.type !== 'tref') neutralize(bytes, box);
  }

  keep.push(...sampleRanges(tables));
}

function cleanMedia(bytes: Uint8Array, mdia: Box, tables: SampleTables, handler: string): void {
  for (const box of children(bytes, mdia.start + mdia.headerSize, mdia.end)) {
    if (box.type === 'mdhd') {
      zeroTimes(bytes, box);
    } else if (box.type === 'hdlr') {
      // Имя обработчика — свободная строка, у некоторых камер с названием
      // устройства. Пустое имя допустимо.
      bytes.fill(0, Math.min(box.start + box.headerSize + 24, box.end), box.end);
    } else if (box.type === 'minf') {
      for (const inner of children(bytes, box.start + box.headerSize, box.end)) {
        if (inner.type === 'stbl') {
          for (const table of children(bytes, inner.start + inner.headerSize, inner.end)) {
            if (table.type === 'stsd') cleanSampleEntries(bytes, table, handler);
            else if (!STBL_KEEP.has(table.type)) neutralize(bytes, table);
          }

          readSampleTables(bytes, inner, tables);
        } else if (inner.type === 'dinf') {
          checkSelfContained(bytes, inner);
        } else if (inner.type !== 'vmhd' && inner.type !== 'smhd') {
          neutralize(bytes, inner);
        }
      }
    } else {
      neutralize(bytes, box);
    }
  }
}

/**
 * В описании формата дорожки — производитель кодировщика (vendor QuickTime) и
 * у видео имя компрессора: у некоторых камер там название устройства. Оба
 * поля для декодирования не нужны.
 */
function cleanSampleEntries(bytes: Uint8Array, stsd: Box, handler: string): void {
  // Версия, флаги и число записей.
  for (const entry of children(bytes, stsd.start + stsd.headerSize + 8, stsd.end)) {
    const payload = entry.start + entry.headerSize;

    if (payload + 16 <= entry.end) bytes.fill(0, payload + 12, payload + 16);
    if (handler === 'vide' && payload + 74 <= entry.end) bytes.fill(0, payload + 42, payload + 74);
  }
}

/**
 * Ссылка на данные во внешнем файле — строка с путём на устройстве. У
 * обычного видео данные внутри (флаг 1), строки нет.
 */
function checkSelfContained(bytes: Uint8Array, dinf: Box): void {
  for (const dref of children(bytes, dinf.start + dinf.headerSize, dinf.end)) {
    if (dref.type !== 'dref') {
      neutralize(bytes, dref);
      continue;
    }

    // Версия и флаги, число записей.
    for (const entry of children(bytes, dref.start + dref.headerSize + 8, dref.end)) {
      const flags = entry.start + entry.headerSize + 3;

      if (flags >= entry.end || (bytes[flags] & 1) !== 1) fail('External data reference');
    }
  }
}

/** Чистый `moov` той же длины и диапазоны сэмплов, которые остаются в файле. */
export function sanitizeMoov(moov: Uint8Array): { bytes: Uint8Array; keep: ByteRange[] } {
  const bytes = moov.slice();
  const root = parseBox(bytes, 0, bytes.length, 0);

  if (root.type !== 'moov' || root.end !== bytes.length) fail('Not a moov box');

  const keep: ByteRange[] = [];

  for (const box of children(bytes, root.headerSize, root.end)) {
    if (box.type === 'mvhd') zeroTimes(bytes, box);
    else if (box.type === 'trak') cleanTrack(bytes, box, keep);
    else if (box.type === 'mvex') fail('Fragmented files are not supported');
    else if (box.type !== 'iods') neutralize(bytes, box);
  }

  return { bytes, keep };
}

function mergeRanges(ranges: ByteRange[]): ByteRange[] {
  const sorted = ranges.filter((range) => range.end > range.start).sort((a, b) => a.start - b.start);
  const merged: ByteRange[] = [];

  for (const range of sorted) {
    const last = merged[merged.length - 1];

    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }

  return merged;
}

/** `span` минус `keep` (оба — отсортированные непересекающиеся диапазоны). */
function subtract(span: ByteRange, keep: ByteRange[]): ByteRange[] {
  const out: ByteRange[] = [];
  let cursor = span.start;

  for (const range of keep) {
    if (range.end <= cursor || range.start >= span.end) continue;
    if (range.start > cursor) out.push({ start: cursor, end: range.start });
    cursor = Math.max(cursor, range.end);
  }

  if (cursor < span.end) out.push({ start: cursor, end: span.end });

  return out;
}

export function isIsoBmff(head: Uint8Array): boolean {
  if (head.length < 8) return false;

  const type = fourcc(head, 4);

  return ['ftyp', 'moov', 'mdat', 'wide', 'free', 'skip'].includes(type);
}

/**
 * План очистки ISO BMFF без чтения mdat: верхний уровень — по заголовкам,
 * `moov` — целиком. Что остаётся в файле: ftyp, mdat (только байты сэмплов
 * видео и звука, остальное в нём обнуляется) и чистый moov. Всё прочее
 * верхнего уровня (udta, meta, uuid с XMP, free с мусором) — `free` с нулями.
 */
export async function planIsoBmff(source: ByteSource): Promise<CleanPlan> {
  const { size } = source;
  const boxes: Box[] = [];
  const tail: ByteRange[] = [];
  let at = 0;

  while (at < size) {
    if (boxes.length >= MAX_TOP_LEVEL_BOXES) fail('Too many boxes');

    // Хвост короче заголовка — не коробка; обнуляется.
    if (size - at < 8) {
      tail.push({ start: at, end: size });
      break;
    }

    const head = await source.read(at, Math.min(16, size - at));
    const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
    const size32 = view.getUint32(0);
    const type = fourcc(head, 4);
    let headerSize = 8;
    let boxSize = size32;

    if (size32 === 1) {
      if (head.length < 16) fail('Truncated box header');
      boxSize = readU64(view, 8);
      headerSize = 16;
    } else if (size32 === 0) {
      boxSize = size - at;
    }

    if (!printable(type) || boxSize < headerSize || at + boxSize > size) fail('Bad box');

    boxes.push({ type, start: at, headerSize, end: at + boxSize });
    at += boxSize;
  }

  if (boxes.length === 0 || boxes[0].type === 'moof') fail('Not an ISO BMFF file');

  const moovs = boxes.filter((box) => box.type === 'moov');

  if (moovs.length !== 1) fail('Exactly one moov expected');
  if (boxes.some((box) => box.type === 'moof' || box.type === 'mfra')) {
    fail('Fragmented files are not supported');
  }

  const moovBox = moovs[0];

  if (moovBox.end - moovBox.start > MAX_MOOV_BYTES) fail('moov too large');

  const moov = await source.read(moovBox.start, moovBox.end - moovBox.start);
  const clean = sanitizeMoov(moov);
  const keep = mergeRanges(clean.keep);
  const patches: Patch[] = [{ offset: moovBox.start, bytes: clean.bytes }];
  const zeros: ByteRange[] = [];
  const mdats: ByteRange[] = [];

  for (const box of boxes) {
    if (box.type === 'ftyp' || box.type === 'moov') continue;

    if (box.type === 'mdat') {
      const payload = { start: box.start + box.headerSize, end: box.end };

      mdats.push(payload);
      zeros.push(...subtract(payload, keep));
      continue;
    }

    patches.push({ offset: box.start + 4, bytes: new Uint8Array([0x66, 0x72, 0x65, 0x65]) });
    zeros.push({ start: box.start + box.headerSize, end: box.end });
  }

  // Сэмпл вне mdat — файл устроен не так, как мы думаем: не публикуем.
  for (const range of keep) {
    if (!mdats.some((mdat) => range.start >= mdat.start && range.end <= mdat.end)) {
      fail('Sample outside of mdat');
    }
  }

  return { size, patches, zeros: mergeRanges([...zeros, ...tail]) };
}

/** Применить план к куску файла, начинающемуся с `offset` (меняет `chunk`). */
export function applyPlanToChunk(plan: CleanPlan, chunk: Uint8Array, offset: number): Uint8Array {
  const end = offset + chunk.length;

  for (const patch of plan.patches) {
    const from = Math.max(patch.offset, offset);
    const to = Math.min(patch.offset + patch.bytes.length, end);

    if (from < to) chunk.set(patch.bytes.subarray(from - patch.offset, to - patch.offset), from - offset);
  }

  for (const range of plan.zeros) {
    if (range.start >= end) break;

    const from = Math.max(range.start, offset);
    const to = Math.min(range.end, end);

    if (from < to) chunk.fill(0, from - offset, to - offset);
  }

  return chunk;
}

/** Чистая копия файла целиком в памяти — для коротких файлов и тестов. */
export function applyPlan(plan: CleanPlan, bytes: Uint8Array): Uint8Array {
  if (bytes.length !== plan.size) fail('Size changed');

  return applyPlanToChunk(plan, bytes.slice(), 0);
}

/** Поток очистки: файл идёт насквозь, заменяются только места из плана. */
export function planTransform(plan: CleanPlan): TransformStream<Uint8Array, Uint8Array> {
  let offset = 0;

  return new TransformStream({
    transform(chunk, controller) {
      const copy = chunk.slice();

      applyPlanToChunk(plan, copy, offset);
      offset += copy.length;
      controller.enqueue(copy);
    },
    flush() {
      if (offset !== plan.size) throw new UnsupportedMediaError('Size changed');
    },
  });
}

/** Источник из памяти. */
export function memorySource(bytes: Uint8Array): ByteSource {
  return {
    size: bytes.length,
    read: async (offset, length) => bytes.subarray(offset, offset + length),
  };
}
