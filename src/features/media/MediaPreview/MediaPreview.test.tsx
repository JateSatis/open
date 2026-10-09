import { act, render, screen, userEvent, waitFor } from '@testing-library/react-native';

import { PreviewLayer } from './PreviewLayer';
import {
  handlePreviewBack,
  openMediaPreview,
  publishPreviewGallery,
  resetMediaPreview,
  useMediaPreview,
} from './previewStore';

import type { MediaLibraryItem } from '@/features/media/mediaLibrary';
import { photoEditOf, usePhotoEdits } from '@/features/media/photoEdits/editsStore';
import { setSelectionLimit, useMediaSelection } from '@/features/media/selectionStore';

// Skia, запекание и рабочая копия — нативные; здесь проверяется поведение слоя.
jest.mock('./EditedPhoto', () => ({ EditedPhoto: () => null }));
jest.mock('./workingCopy', () => ({
  workingCopyOf: jest.fn(() => new Promise(() => undefined)),
  workingImageOf: jest.fn(),
}));
jest.mock('./bake', () => ({
  bakePhoto: jest.fn(() => ({ file: jest.fn(), prepare: jest.fn() })),
}));
jest.mock('expo-video', () => ({
  useVideoPlayer: () => ({ play: jest.fn(), pause: jest.fn() }),
  VideoView: () => null,
}));
jest.mock('@/features/media/mediaLibrary', () => ({
  resolveAssetUri: jest.fn(() => new Promise(() => undefined)),
}));

const photo = (id: string): MediaLibraryItem => ({
  id,
  kind: 'photo',
  width: 400,
  height: 300,
  durationMs: null,
});
const video: MediaLibraryItem = { id: 'v', kind: 'video', width: 9, height: 16, durationMs: 3000 };

const GALLERY = [photo('a'), photo('b'), video];

async function renderPreview(openOn: MediaLibraryItem, onSend = jest.fn(), editing = false) {
  publishPreviewGallery(GALLERY);
  openMediaPreview(openOn, null);

  // Слой напрямую: обёртка `MediaPreview` грузит его через `import()`, а jest
  // динамический импорт не исполняет.
  await render(
    <PreviewLayer
      title="Plany"
      text=""
      onChangeText={jest.fn()}
      placeholder="Подпись"
      editing={editing}
      onSend={onSend}
      gridViewport={{ top: 0, bottom: 800 }}
    />,
  );
  expect(screen.getByTestId('media-preview')).toBeTruthy();

  return { onSend };
}

beforeEach(() => {
  resetMediaPreview();
  useMediaSelection.getState().clear();
  setSelectionLimit(null);
  usePhotoEdits.setState({ edits: {}, baked: {} });
});

describe('предпросмотр файлов шита', () => {
  it('открывается на файле из плитки, с именем чата и без выбора', async () => {
    await renderPreview(GALLERY[1]);

    expect(screen.getByText('Plany')).toBeTruthy();
    expect(screen.getByLabelText('Выбрать файл')).toBeTruthy();
    expect(useMediaSelection.getState().order).toEqual([]);
  });

  it('кружок в шапке выбирает текущий файл следующим номером и снимает выбор', async () => {
    useMediaSelection.getState().toggle(photo('a'));
    await renderPreview(GALLERY[1]);
    const user = userEvent.setup();

    await user.press(screen.getByLabelText('Выбрать файл'));

    expect(useMediaSelection.getState().order).toEqual(['a', 'b']);
    expect(screen.getByText('2')).toBeTruthy();

    await user.press(screen.getByLabelText('Убрать из выбранного'));

    expect(useMediaSelection.getState().order).toEqual(['a']);
  });

  it('у невыбранного файла кружок показывает, сколько выбрано всего', async () => {
    useMediaSelection.getState().toggle(photo('a'));
    useMediaSelection.getState().toggle(video);
    await renderPreview(GALLERY[1]);

    expect(screen.getByLabelText('Выбрать файл')).toBeTruthy();
    expect(screen.getByTestId('media-preview-select-count')).toHaveTextContent('2');
  });

  it('при добранном лимите не выбирает и коротко объясняет почему', async () => {
    setSelectionLimit(1);
    useMediaSelection.getState().toggle(photo('a'));
    await renderPreview(GALLERY[1]);
    const user = userEvent.setup();

    await user.press(screen.getByLabelText('Выбрать файл'));

    expect(useMediaSelection.getState().order).toEqual(['a']);
    expect(screen.getByText('Больше 1 не выбрать')).toBeTruthy();
  });

  it('отправка с пустым выбором уходит с текущим файлом', async () => {
    const { onSend } = await renderPreview(GALLERY[1]);
    const user = userEvent.setup();

    await user.press(screen.getByLabelText('Отправить'));

    expect(useMediaSelection.getState().order).toEqual(['b']);
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('в правке альбома «Сохранить» не добавляет файл, который просто открыли', async () => {
    const { onSend } = await renderPreview(GALLERY[1], jest.fn(), true);
    const user = userEvent.setup();

    await user.press(screen.getByLabelText('Сохранить'));

    expect(useMediaSelection.getState().order).toEqual([]);
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('у фото есть ряд инструментов', async () => {
    await renderPreview(GALLERY[0]);

    expect(screen.getByLabelText('Настройка цвета')).toBeTruthy();
    expect(screen.getByLabelText('Обрезка и поворот')).toBeTruthy();
  });

  it('у видео ряда инструментов нет, а кружок выбора и подпись есть', async () => {
    await renderPreview(video);

    expect(screen.queryByLabelText('Настройка цвета')).toBeNull();
    expect(screen.getByLabelText('Выбрать файл')).toBeTruthy();
    expect(screen.getByLabelText('Подпись')).toBeTruthy();
  });

  it('«назад» с открытым инструментом — это «Отмена»: правки нет, выбор не тронут', async () => {
    await renderPreview(GALLERY[0]);
    const user = userEvent.setup();

    await user.press(screen.getByLabelText('Настройка цвета'));
    expect(screen.getByLabelText('Экспозиция')).toBeTruthy();

    await act(async () => {
      expect(handlePreviewBack()).toBe(true);
    });

    expect(useMediaPreview.getState().target).not.toBeNull();
    expect(photoEditOf('a')).toBeUndefined();
    expect(useMediaSelection.getState().order).toEqual([]);
  });

  it('«назад» без инструмента закрывает предпросмотр, а не шит', async () => {
    await renderPreview(GALLERY[0]);

    await act(async () => {
      expect(handlePreviewBack()).toBe(true);
    });

    await waitFor(() => expect(useMediaPreview.getState().target).toBeNull());
  });
});
