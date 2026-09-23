import { horizontalRuleTile, parseHexColor } from './skeletonTile';

/** Декодирует data-URI обратно в байты — тест смотрит на сам PNG, а не на строку. */
function decode(uri: string): Uint8Array {
  const base64 = uri.slice(uri.indexOf(',') + 1);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = base64.replace(/=+$/, '');
  const out: number[] = [];
  let bits = 0;
  let value = 0;

  for (const char of clean) {
    value = (value << 6) | alphabet.indexOf(char);
    bits += 6;

    if (bits >= 8) {
      bits -= 8;
      out.push((value >>> bits) & 0xff);
    }
  }

  return Uint8Array.from(out);
}

function readUint32(bytes: Uint8Array, at: number): number {
  return ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
}

describe('parseHexColor', () => {
  it('reads both short and long hex forms', () => {
    expect(parseHexColor('#000000')).toEqual({ r: 0, g: 0, b: 0 });
    expect(parseHexColor('#ffffff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseHexColor('#fff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseHexColor('#3C87F7')).toEqual({ r: 60, g: 135, b: 247 });
  });
});

describe('horizontalRuleTile', () => {
  const color = { r: 1, g: 2, b: 3 };

  it('is a real PNG of exactly one pixel by the grid pitch', () => {
    // Шаг плитки — это шаг сетки в физических пикселях. Ошибись здесь, и
    // зазоры скелета разойдутся с настоящими клетками тем сильнее, чем
    // глубже прокручена галерея.
    const bytes = decode(horizontalRuleTile({ pitchPx: 358, rulePx: 6, color }));

    expect([...bytes.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(String.fromCharCode(...bytes.slice(12, 16))).toBe('IHDR');
    expect(readUint32(bytes, 16)).toBe(1);
    expect(readUint32(bytes, 20)).toBe(358);
    // 8 бит на канал, RGBA.
    expect(bytes[24]).toBe(8);
    expect(bytes[25]).toBe(6);
  });

  it('rounds the pitch to whole pixels instead of drifting', () => {
    const bytes = decode(horizontalRuleTile({ pitchPx: 119.4, rulePx: 2, color }));

    expect(readUint32(bytes, 20)).toBe(119);
  });

  it('never loses the rule, however thin the pitch', () => {
    const bytes = decode(horizontalRuleTile({ pitchPx: 1, rulePx: 0.2, color }));

    expect(readUint32(bytes, 20)).toBe(1);
  });

  it('ends with IEND', () => {
    const bytes = decode(horizontalRuleTile({ pitchPx: 10, rulePx: 2, color }));

    expect(String.fromCharCode(...bytes.slice(bytes.length - 8, bytes.length - 4))).toBe('IEND');
  });
});
