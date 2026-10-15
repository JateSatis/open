import {
  arePhotoEditsIsolated,
  isolatePhotoEdits,
  photoEditOf,
  setPhotoEdit,
  usePhotoEdits,
} from './editsStore';
import { defaultCrop, rotateQuarter } from './crop';
import { editedThumbOf, setEditedThumb } from './editedThumbs';
import type { BakedPhoto } from './types';

import type { MediaLibraryItem } from '@/features/media/mediaLibrary';
import { selectedAssets, useMediaSelection } from '@/features/media/selectionStore';

const photo = (id: string): MediaLibraryItem => ({
  id,
  kind: 'photo',
  width: 100,
  height: 100,
  durationMs: null,
});

const GREY = { adjust: { exposure: 0, contrast: 0, saturation: -100 } };
const GREY_FILE = { uri: 'file:///grey.jpg', width: 100, height: 100 };
const baked: BakedPhoto = { file: () => GREY_FILE, prepare: () => Promise.resolve(GREY_FILE) };

beforeEach(() => {
  useMediaSelection.getState().clear();
  usePhotoEdits.setState({ edits: {}, baked: {} });
});

describe('правки фото живут вместе с выбором', () => {
  it('снятие выбора правку не стирает — вернул выбор, правка на месте', () => {
    const a = photo('a');

    useMediaSelection.getState().toggle(a);
    setPhotoEdit('a', GREY, baked);
    useMediaSelection.getState().toggle(a);
    useMediaSelection.getState().toggle(a);

    expect(photoEditOf('a')).toEqual(GREY);
  });

  it('сброс выбора (отправка, «Сбросить», уход из чата) стирает все правки', () => {
    useMediaSelection.getState().toggle(photo('a'));
    setPhotoEdit('a', GREY, baked);
    setPhotoEdit('b', GREY, baked);

    useMediaSelection.getState().clear();

    expect(photoEditOf('a')).toBeUndefined();
    expect(photoEditOf('b')).toBeUndefined();
  });

  it('пустая правка — правки нет', () => {
    setPhotoEdit('a', GREY, baked);
    setPhotoEdit('a', { adjust: { exposure: 0, contrast: 0, saturation: 0 } }, null);

    expect(photoEditOf('a')).toBeUndefined();
  });

  it('отправка получает запечённую правку только у отредактированного, в порядке выбора', () => {
    useMediaSelection.getState().toggle(photo('a'));
    useMediaSelection.getState().toggle(photo('b'));
    useMediaSelection.getState().toggle(photo('c'));
    setPhotoEdit('b', GREY, baked);

    const sent = selectedAssets();

    expect(sent.map((item) => item.id)).toEqual(['a', 'b', 'c']);
    expect(sent.map((item) => item.edited !== undefined)).toEqual([false, true, false]);
  });
});

describe('обрезка в правке', () => {
  const NEUTRAL = { exposure: 0, contrast: 0, saturation: 0 };

  it('нетронутая обрезка — правки нет', () => {
    setPhotoEdit('a', { adjust: NEUTRAL, crop: defaultCrop(0.75) }, baked);

    expect(photoEditOf('a')).toBeUndefined();
  });

  it('только обрезка — правка есть, цвет нейтральный', () => {
    const crop = rotateQuarter(defaultCrop(0.75));

    setPhotoEdit('a', { adjust: NEUTRAL, crop }, baked);

    expect(photoEditOf('a')).toEqual({ adjust: NEUTRAL, crop });
  });

  it('цвет с нетронутой обрезкой хранится без обрезки', () => {
    setPhotoEdit('a', { ...GREY, crop: defaultCrop(1) }, baked);

    expect(photoEditOf('a')).toEqual(GREY);
  });

  it('картинка плитки уходит вместе с прежней правкой и с выбором', () => {
    setPhotoEdit('a', GREY, baked);
    setEditedThumb('a', 'file:///a.jpg');
    setPhotoEdit('a', { adjust: NEUTRAL }, null);

    expect(editedThumbOf('a')).toBeUndefined();

    setPhotoEdit('a', GREY, baked);
    setEditedThumb('a', 'file:///a.jpg');
    useMediaSelection.getState().clear();

    expect(editedThumbOf('a')).toBeUndefined();
  });
});

describe('отдельный сеанс правок (шит аватарки)', () => {
  it('правки чата на время сеанса не видны и возвращаются после него', () => {
    setPhotoEdit('a', GREY, baked);
    setEditedThumb('a', 'file:///chat-thumb.jpg');

    const restore = isolatePhotoEdits();

    expect(photoEditOf('a')).toBeUndefined();
    expect(editedThumbOf('a')).toBeUndefined();
    expect(arePhotoEditsIsolated()).toBe(true);

    restore();

    expect(photoEditOf('a')).toEqual(GREY);
    expect(editedThumbOf('a')).toBe('file:///chat-thumb.jpg');
    expect(arePhotoEditsIsolated()).toBe(false);
  });

  it('правка сеанса уходит вместе с ним — в чате фото без неё', () => {
    const restore = isolatePhotoEdits();

    setPhotoEdit('b', GREY, baked);
    setEditedThumb('b', 'file:///avatar-thumb.jpg');
    restore();

    expect(photoEditOf('b')).toBeUndefined();
    expect(editedThumbOf('b')).toBeUndefined();
  });
});
