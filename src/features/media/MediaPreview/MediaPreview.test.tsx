import {
  act,
  fireEvent,
  render,
  screen,
  userEvent,
  waitFor,
} from '@testing-library/react-native';

import { PreviewLayer } from './PreviewLayer';
import {
  handlePreviewBack,
  openMediaPreview,
  publishPreviewGallery,
  resetMediaPreview,
  useMediaPreview,
} from './previewStore';

import { workingCopyOf } from './workingCopy';

import { confirm } from '@/components/ConfirmDialog';
import { DEFAULT_DRAW_SETTINGS, useDrawSettings } from '@/features/media/drawSettings';
import type { MediaLibraryItem } from '@/features/media/mediaLibrary';
import { editedThumbOf } from '@/features/media/photoEdits/editedThumbs';
import { photoEditOf, setPhotoEdit, usePhotoEdits } from '@/features/media/photoEdits/editsStore';
import { EMPTY_EDIT } from '@/features/media/photoEdits/types';
import { setSelectionLimit, useMediaSelection } from '@/features/media/selectionStore';
import { DrawPalette, Sizes } from '@/theme';

// Skia, запекание и рабочая копия — нативные; здесь проверяется поведение слоя.
jest.mock('./EditedPhoto', () => ({ EditedPhoto: () => null, PHOTO_SAMPLING: {} }));
jest.mock('./CropOverlay', () => ({ CropOverlay: () => null }));
jest.mock('./AngleRuler', () => ({ AngleRuler: () => null }));
jest.mock('@shopify/react-native-skia', () => {
  const none = () => null;

  return {
    Canvas: none,
    Circle: none,
    Group: none,
    ImageShader: none,
    LinearGradient: none,
    Rect: none,
    RoundedRect: none,
    SweepGradient: none,
    FilterMode: { Nearest: 0 },
    MipmapMode: { None: 0 },
    vec: (x: number, y: number) => ({ x, y }),
    Skia: { Surface: { Make: () => null } },
  };
});
jest.mock('./DrawAlphaSlider', () => ({ DrawAlphaSlider: () => null }));
jest.mock('./eyedropperPixels', () => ({ visibleImageOf: jest.fn(() => ({ dispose: jest.fn() })) }));
jest.mock('./Eyedropper', () => {
  const { Pressable } = jest.requireActual<typeof import('react-native')>('react-native');

  return {
    // Лупа — Skia на UI-потоке; здесь — её итог: палец отпущен на синем.
    Eyedropper: ({ onPick }: { onPick: (rgb: string) => void }) => (
      <Pressable testID="eyedropper-release" onPress={() => onPick('#1e64c8')} />
    ),
  };
});
jest.mock('./DrawSizeSlider', () => ({ DrawSizeSlider: () => null }));
jest.mock('./drawingLayers', () => ({
  NO_LAYERS: { blur: null, lines: null },
  drawingLayersOf: jest.fn(() => ({ blur: null, lines: null })),
  safeDrawingLayersOf: jest.fn(() => ({ blur: null, lines: null })),
  renderDrawingLayers: jest.fn(() => ({ blur: null, lines: null })),
  retireDrawingLayers: jest.fn(),
  appendDrawingStroke: jest.fn(() => ({ blur: null, lines: { stroke: true } })),
  blurredCopyOf: jest.fn(() => null),
  blurredLinesOf: jest.fn(() => null),
  rememberDrawingLayers: jest.fn(),
}));
jest.mock('./workingCopy', () => ({
  workingCopyOf: jest.fn(() => new Promise(() => undefined)),
  workingImageOf: jest.fn(() => ({ width: () => 400, height: () => 300 })),
}));
jest.mock('./bake', () => ({
  bakePhoto: jest.fn(() => ({ file: jest.fn(), prepare: jest.fn(() => Promise.resolve()) })),
  renderEditThumb: jest.fn(() => 'file:///thumb.jpg'),
}));
jest.mock('@/components/ConfirmDialog', () => ({ confirm: jest.fn() }));
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

describe('обрезка и поворот', () => {
  const COPY = {
    uri: 'file:///copy.png',
    width: 400,
    height: 300,
    source: 'file:///a.jpg',
    sourceWidth: 4000,
    sourceHeight: 3000,
  };

  beforeEach(() => {
    jest.mocked(workingCopyOf).mockImplementation(() => Promise.resolve(COPY));
  });

  afterEach(() => {
    jest.mocked(workingCopyOf).mockImplementation(() => new Promise(() => undefined));
  });

  async function openCrop() {
    await renderPreview(GALLERY[0]);
    const user = userEvent.setup();

    await user.press(screen.getByLabelText('Обрезка и поворот'));
    await screen.findByLabelText('Повернуть на 90°');

    return user;
  }

  it('открывается панелью с отражением и поворотом, листать нельзя', async () => {
    await openCrop();

    expect(screen.getByLabelText('Отразить')).toBeTruthy();
    expect(screen.getByTestId('media-preview-pager')).toHaveProp('scrollEnabled', false);
  });

  it('поворот на 90° → «Готово»: у фото обрезка, иконка подсвечена, фото выбрано', async () => {
    const user = await openCrop();

    await user.press(screen.getByLabelText('Повернуть на 90°'));
    await user.press(screen.getByLabelText('Применить'));

    const crop = photoEditOf('a')?.crop;

    expect(crop?.quarter).toBe(1);
    expect(screen.getByLabelText('Обрезка и поворот')).toBeSelected();
    expect(screen.getByLabelText('Настройка цвета')).not.toBeSelected();
    expect(useMediaSelection.getState().order).toEqual(['a']);
    await waitFor(() => expect(editedThumbOf('a')).toBe('file:///thumb.jpg'));
  });

  it('крестик отменяет заход без вопроса, «назад» — то же самое', async () => {
    const user = await openCrop();

    await user.press(screen.getByLabelText('Повернуть на 90°'));
    await user.press(screen.getByLabelText('Отменить'));

    expect(photoEditOf('a')).toBeUndefined();
    expect(useMediaSelection.getState().order).toEqual([]);

    await user.press(screen.getByLabelText('Обрезка и поворот'));
    await screen.findByLabelText('Повернуть на 90°');
    await user.press(screen.getByLabelText('Отразить'));
    await act(async () => {
      expect(handlePreviewBack()).toBe(true);
    });

    expect(photoEditOf('a')).toBeUndefined();
    expect(useMediaPreview.getState().target).not.toBeNull();
  });

  it('правка цвета у обрезанного фото обрезку не теряет', async () => {
    const user = await openCrop();

    await user.press(screen.getByLabelText('Повернуть на 90°'));
    await user.press(screen.getByLabelText('Применить'));
    await user.press(screen.getByLabelText('Настройка цвета'));
    await user.press(screen.getByLabelText('Применить'));

    expect(photoEditOf('a')?.crop?.quarter).toBe(1);
    expect(screen.getByLabelText('Настройка цвета')).not.toBeSelected();
  });
});

describe('рисование', () => {
  const COPY = {
    uri: 'file:///copy.png',
    width: 400,
    height: 300,
    source: 'file:///a.jpg',
    sourceWidth: 4000,
    sourceHeight: 3000,
  };
  const stroke = (x: number) => ({
    brush: 'pen' as const,
    color: '#ff3b30',
    width: 0.01,
    points: [x, 0.1, x, 0.5],
  });
  const FIRST = stroke(0.2);
  const SECOND = stroke(0.6);

  beforeEach(() => {
    jest.mocked(workingCopyOf).mockImplementation(() => Promise.resolve(COPY));
    jest.mocked(confirm).mockReset();
  });

  afterEach(() => {
    jest.mocked(workingCopyOf).mockImplementation(() => new Promise(() => undefined));
  });

  async function openDraw() {
    await renderPreview(GALLERY[0]);
    const user = userEvent.setup();

    await user.press(screen.getByLabelText('Рисование'));
    await screen.findByLabelText('Перо');

    return user;
  }

  it('до первого штриха крестик и «отменить» не нажимаются, «Сбросить» нет, листать нельзя', async () => {
    await openDraw();

    expect(screen.getByLabelText('Отменить рисование')).toBeDisabled();
    expect(screen.getByLabelText('Отменить последнее действие')).toBeDisabled();
    expect(screen.queryByText('Сбросить')).toBeNull();
    expect(screen.getByTestId('media-preview-pager')).toHaveProp('scrollEnabled', false);
  });

  it('«назад», когда нечего терять, выходит без вопроса', async () => {
    await openDraw();

    await act(async () => {
      handlePreviewBack();
    });

    expect(confirm).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByLabelText('Перо')).toBeNull());
  });

  it('выбор кисти переносит подсветку и запоминается', async () => {
    const user = await openDraw();

    await user.press(screen.getByLabelText('Маркер'));

    expect(screen.getByLabelText('Маркер')).toBeSelected();
    expect(screen.getByLabelText('Перо')).not.toBeSelected();
    expect(useDrawSettings.getState().brush).toBe('marker');
  });

  it('прежний рисунок: стрелка снимает штрихи прошлого захода по одному, «Готово» сохраняет', async () => {
    setPhotoEdit('a', { ...EMPTY_EDIT, drawing: [FIRST, SECOND] }, null);
    const user = await openDraw();

    expect(screen.getByText('Сбросить')).toBeTruthy();
    expect(screen.getByLabelText('Отменить рисование')).toBeDisabled();

    await user.press(screen.getByLabelText('Отменить последнее действие'));

    expect(screen.getByLabelText('Отменить рисование')).toBeEnabled();

    await user.press(screen.getByLabelText('Применить'));

    expect(photoEditOf('a')?.drawing).toEqual([FIRST]);
    expect(screen.getByLabelText('Рисование')).toBeSelected();
  });

  it('«Сбросить» убирает весь рисунок и сам отменяется стрелкой', async () => {
    setPhotoEdit('a', { ...EMPTY_EDIT, drawing: [FIRST, SECOND] }, null);
    const user = await openDraw();

    await user.press(screen.getByText('Сбросить'));
    await waitFor(() => expect(screen.queryByText('Сбросить')).toBeNull());

    await user.press(screen.getByLabelText('Отменить последнее действие'));

    expect(screen.getByText('Сбросить')).toBeTruthy();

    await user.press(screen.getByText('Сбросить'));
    await user.press(screen.getByLabelText('Применить'));

    expect(photoEditOf('a')).toBeUndefined();
  });

  it('крестик с изменениями спрашивает: «Отмена» оставляет в рисовании, «ОК» возвращает как было', async () => {
    setPhotoEdit('a', { ...EMPTY_EDIT, drawing: [FIRST, SECOND] }, null);
    const user = await openDraw();

    await user.press(screen.getByLabelText('Отменить последнее действие'));

    jest.mocked(confirm).mockResolvedValueOnce(false);
    await user.press(screen.getByLabelText('Отменить рисование'));

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Перо')).toBeTruthy();

    jest.mocked(confirm).mockResolvedValueOnce(true);
    await act(async () => {
      handlePreviewBack();
    });

    await waitFor(() => expect(screen.queryByLabelText('Перо')).toBeNull());
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(photoEditOf('a')?.drawing).toEqual([FIRST, SECOND]);
  });

  describe('цвет кисти', () => {
    beforeEach(() => {
      useDrawSettings.setState({
        ...DEFAULT_DRAW_SETTINGS,
        colors: { ...DEFAULT_DRAW_SETTINGS.colors, marker: '#ffcc0080' },
      });
    });

    /** Тап по квадратику сетки: ряд и столбец — по раскладке во всю ширину. */
    async function pressPaletteCell(row: number, column: number) {
      const grid = screen.getByTestId('draw-palette');
      const width = 300;
      const step = (width - Sizes.drawPaletteGap * 9) / 10 + Sizes.drawPaletteGap;

      await act(async () => {
        fireEvent(grid, 'layout', { nativeEvent: { layout: { width, height: 0, x: 0, y: 0 } } });
      });
      // Свежий элемент: после раскладки у сетки новый обработчик.
      fireEvent.press(screen.getByTestId('draw-palette'), {
        nativeEvent: { locationX: column * step + 1, locationY: row * step + 1 },
      });
    }

    it('у ластика и размытия кружок неактивен — панель не открывается', async () => {
      const user = await openDraw();

      await user.press(screen.getByLabelText('Ластик'));
      expect(screen.getByLabelText('У этой кисти нет цвета')).toBeDisabled();

      await user.press(screen.getByLabelText('Размытие'));
      expect(screen.getByLabelText('У этой кисти нет цвета')).toBeDisabled();
      expect(screen.queryByLabelText('Пипетка')).toBeNull();
    });

    it('тап по цвету сетки применяет его к текущей кисти и закрывает панель', async () => {
      const user = await openDraw();

      await user.press(screen.getByLabelText('Цвет кисти'));
      expect(screen.getByLabelText('Пипетка')).toBeTruthy();

      await pressPaletteCell(4, 7);

      expect(useDrawSettings.getState().colors.pen).toBe(`${DrawPalette[4][7]}ff`);
      expect(useDrawSettings.getState().colors.marker).toBe('#ffcc0080');
      expect(screen.queryByLabelText('Пипетка')).toBeNull();
    });

    it('прозрачность кисти сохраняется при выборе цвета: у маркера — его 50%', async () => {
      const user = await openDraw();

      await user.press(screen.getByLabelText('Маркер'));
      await user.press(screen.getByLabelText('Цвет кисти'));
      await pressPaletteCell(0, 9);

      expect(useDrawSettings.getState().colors.marker).toBe('#00000080');
    });

    it('«назад» при открытой панели закрывает её, цвет прежний, рисование открыто', async () => {
      const user = await openDraw();

      await user.press(screen.getByLabelText('Цвет кисти'));
      await act(async () => {
        handlePreviewBack();
      });

      expect(screen.queryByLabelText('Пипетка')).toBeNull();
      expect(screen.getByLabelText('Перо')).toBeTruthy();
      expect(useDrawSettings.getState().colors.pen).toBe(DEFAULT_DRAW_SETTINGS.colors.pen);

      await user.press(screen.getByLabelText('Цвет кисти'));
      await user.press(screen.getByLabelText('Закрыть цвета'));

      expect(screen.queryByLabelText('Пипетка')).toBeNull();
      expect(screen.getByLabelText('Перо')).toBeTruthy();
    });

    it('пипетка закрывает панель, отпущенный палец ставит цвет с фото', async () => {
      const user = await openDraw();

      await user.press(screen.getByLabelText('Цвет кисти'));
      await user.press(screen.getByLabelText('Пипетка'));

      expect(screen.queryByLabelText('Пипетка')).toBeNull();

      await user.press(screen.getByTestId('eyedropper-release'));

      expect(useDrawSettings.getState().colors.pen).toBe('#1e64c8ff');
      expect(screen.queryByTestId('eyedropper-release')).toBeNull();
    });
  });
});
