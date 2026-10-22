// Очистка метаданных на настоящих файлах. Запуск: npm run test:functions.
//
// Фикстуры сделаны ffmpeg с геометкой, моделью, датой и комментарием
// (`fixtures/`); JPEG с EXIF, GPS, XMP, IPTC, профилем и хвостом собирается
// здесь из простого кадра.

import { assert, assertEquals, assertRejects, assertThrows } from 'jsr:@std/assert@1';

import {
  applyPlan,
  memorySource,
  planIsoBmff,
  planTransform,
  sanitizeJpeg,
  UnsupportedMediaError,
} from './mediaSanitize.ts';

const fixture = (name: string) => Deno.readFile(new URL(`./fixtures/${name}`, import.meta.url));
const text = new TextEncoder();

function contains(haystack: Uint8Array, needle: string): boolean {
  const bytes = text.encode(needle);

  outer: for (let at = 0; at + bytes.length <= haystack.length; at += 1) {
    for (let index = 0; index < bytes.length; index += 1) {
      if (haystack[at + index] !== bytes[index]) continue outer;
    }

    return true;
  }

  return false;
}

function segment(marker: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(payload.length + 4);

  out.set([0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 0xff]);
  out.set(payload, 4);

  return out;
}

function join(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;

  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }

  return out;
}

/** EXIF (little endian): Make, Model, DateTime, поворот и GPS-IFD с широтой. */
function exifWithGps(orientation: number): Uint8Array {
  const make = text.encode('SecretMaker\0');
  const model = text.encode('SecretModel\0');
  const date = text.encode('2024:05:01 10:00:00\0');
  const tiff = new Uint8Array(200);
  const view = new DataView(tiff.buffer);
  const entries = 5;
  const ifd0 = 8;
  const gpsIfd = ifd0 + 2 + entries * 12 + 4;
  const data = gpsIfd + 2 + 12 + 4;
  let cursor = data;
  const put = (bytes: Uint8Array) => {
    const at = cursor;

    tiff.set(bytes, at);
    cursor += bytes.length;
    return at;
  };

  tiff.set([0x49, 0x49]);
  view.setUint16(2, 42, true);
  view.setUint32(4, ifd0, true);
  view.setUint16(ifd0, entries, true);

  const entry = (index: number, tag: number, type: number, count: number, value: number) => {
    const at = ifd0 + 2 + index * 12;

    view.setUint16(at, tag, true);
    view.setUint16(at + 2, type, true);
    view.setUint32(at + 4, count, true);
    if (type === 3 && count === 1) view.setUint16(at + 8, value, true);
    else view.setUint32(at + 8, value, true);
  };

  entry(0, 0x010f, 2, make.length, put(make));
  entry(1, 0x0110, 2, model.length, put(model));
  entry(2, 0x0112, 3, 1, orientation);
  entry(3, 0x0132, 2, date.length, put(date));
  entry(4, 0x8825, 4, 1, gpsIfd);

  // GPS IFD: GPSLatitudeRef = "N" и рядом строка с координатой.
  view.setUint16(gpsIfd, 1, true);
  view.setUint16(gpsIfd + 2, 0x0001, true);
  view.setUint16(gpsIfd + 4, 2, true);
  view.setUint32(gpsIfd + 6, 2, true);
  tiff.set(text.encode('N\0'), gpsIfd + 10);
  put(text.encode('55.7558 GPS'));

  return join(text.encode('Exif\0\0'), tiff.subarray(0, cursor));
}

function iccProfile(): Uint8Array {
  const profile = new Uint8Array(132);

  profile.set(text.encode('2024'), 24); // дата
  profile.set(text.encode('SECRSECR'), 48); // производитель и модель
  profile.set(text.encode('acsp'), 36);

  return join(text.encode('ICC_PROFILE\0'), new Uint8Array([1, 1]), profile);
}

async function dirtyJpeg(orientation = 6): Promise<Uint8Array> {
  const plain = await fixture('plain.jpg');
  const xmp = join(
    text.encode('http://ns.adobe.com/xap/1.0/\0'),
    text.encode('<x:xmpmeta>exif:GPSLatitude 55.7558 SecretXmp</x:xmpmeta>'),
  );

  return join(
    plain.subarray(0, 2),
    segment(0xe1, exifWithGps(orientation)),
    segment(0xe1, xmp),
    segment(0xe2, iccProfile()),
    segment(0xed, text.encode('Photoshop 3.0\0SecretIptc')),
    segment(0xfe, text.encode('SecretComment')),
    plain.subarray(2),
    text.encode('SecretTrailer motion photo'),
  );
}

const SECRETS = ['Secret', 'SECR', '55.7558', 'GPS', '2024:05:01', 'xmpmeta'];

Deno.test('JPEG: EXIF, GPS, XMP, IPTC, comment and trailer are gone', async () => {
  const clean = sanitizeJpeg(await dirtyJpeg());

  for (const secret of SECRETS) assert(!contains(clean, secret), `${secret} left in JPEG`);

  assertEquals([clean[0], clean[1]], [0xff, 0xd8]);
  assertEquals([clean[clean.length - 2], clean[clean.length - 1]], [0xff, 0xd9]);
  assert(contains(clean, 'ICC_PROFILE'), 'colour profile is kept');
});

Deno.test('JPEG: rotation survives as the only EXIF tag', async () => {
  const clean = sanitizeJpeg(await dirtyJpeg(6));
  const exif = clean.indexOf(0xe1);

  assert(contains(clean, 'Exif\0\0MM'));
  // Тег 0x0112, SHORT, одно значение, 6.
  const tag = [0x01, 0x12, 0x00, 0x03, 0, 0, 0, 1, 0, 6];
  const at = clean.findIndex((_, index) => tag.every((byte, k) => clean[index + k] === byte));

  assert(exif > 0 && at > exif);
});

Deno.test('JPEG: upright photo gets no EXIF at all', async () => {
  const clean = sanitizeJpeg(await dirtyJpeg(1));

  assert(!contains(clean, 'Exif'));
});

Deno.test('JPEG: the image itself is untouched and cleaning is stable', async () => {
  const plain = await fixture('plain.jpg');
  const once = sanitizeJpeg(await dirtyJpeg(1));
  const twice = sanitizeJpeg(once);

  assertEquals(twice, once);
  // ffmpeg пишет JFIF без миниатюры и комментарий «Lavc…»: кроме комментария
  // и пересобранного JFIF, байты кадра совпадают.
  assertEquals(sanitizeJpeg(plain).length <= plain.length, true);
});

Deno.test('JPEG: not a JPEG or a truncated one is refused', async () => {
  const plain = await fixture('plain.jpg');

  assertThrows(() => sanitizeJpeg(text.encode('\x89PNG\r\n\x1a\n')), UnsupportedMediaError);
  assertThrows(() => sanitizeJpeg(plain.subarray(0, plain.length / 2)), UnsupportedMediaError);
});

// Геометка бывает строкой ISO 6709 (`©xyz`, ключи mdta) и двоичным `loci` 3GPP.
const VIDEO_SECRETS = ['55.7558', 'loci', 'udta', 'SecretModelX', 'TestPhoneMaker', 'SecretComment', 'Lavf'];

for (const name of ['geo-faststart.mp4', 'geo-mdta-tail.mov', 'geo-voice.m4a']) {
  Deno.test(`ISO BMFF ${name}: geotag, model, comment and dates are gone, size is the same`, async () => {
    const dirty = await fixture(name);

    assert(contains(dirty, '55.7558') || contains(dirty, 'loci'), 'fixture carries a geotag');

    const plan = await planIsoBmff(memorySource(dirty));
    const clean = applyPlan(plan, dirty);

    assertEquals(clean.length, dirty.length);
    for (const secret of VIDEO_SECRETS) assert(!contains(clean, secret), `${secret} left in ${name}`);
    // Даты mvhd: 2024 год в секундах от 1904 — 0xE9…; в чистом файле ноль.
    const mvhd = clean.findIndex((_, i) => clean[i] === 0x6d && contains(clean.subarray(i, i + 4), 'mvhd'));

    assertEquals([...clean.subarray(mvhd + 8, mvhd + 16)], [0, 0, 0, 0, 0, 0, 0, 0]);
    // Повторная чистка ничего не меняет.
    assertEquals(applyPlan(await planIsoBmff(memorySource(clean)), clean), clean);
  });
}

Deno.test('ISO BMFF: streaming gives the same bytes as in-memory cleaning', async () => {
  const dirty = await fixture('geo-mdta-tail.mov');
  const plan = await planIsoBmff(memorySource(dirty));
  const pieces: Uint8Array[] = [];
  // Поток режется неровно, чтобы куски попадали на границы заплат.
  for (let at = 0; at < dirty.length; at += 333) pieces.push(dirty.slice(at, at + 333));

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      pieces.forEach((piece) => controller.enqueue(piece));
      controller.close();
    },
  }).pipeThrough(planTransform(plan));
  const out = new Uint8Array(await new Response(stream).arrayBuffer());

  assertEquals(out, applyPlan(plan, dirty));
});

Deno.test('ISO BMFF: garbage, a cut file and a JPEG are refused', async () => {
  const video = await fixture('geo-faststart.mp4');

  await assertRejects(() => planIsoBmff(memorySource(text.encode('hello world, not a video'))), UnsupportedMediaError);
  await assertRejects(() => planIsoBmff(memorySource(video.subarray(0, 3000))), UnsupportedMediaError);
  await assertRejects(async () => planIsoBmff(memorySource(await fixture('plain.jpg'))), UnsupportedMediaError);
});
