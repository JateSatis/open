import { photoEditOf, setPhotoEdit, usePhotoEdits } from './editsStore';
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
const baked: BakedPhoto = { file: () => ({ uri: 'file:///grey.jpg', width: 100, height: 100 }) };

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
