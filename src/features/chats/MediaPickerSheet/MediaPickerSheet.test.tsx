import { act, render, screen, userEvent } from '@testing-library/react-native';
import { State } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';
import type { PanGesture } from 'react-native-gesture-handler';

import {
  armMediaSheet,
  MediaPickerSheet,
  openMediaSheet,
  releaseMediaSheetArm,
  resetMediaSheet,
  SHEET_PAN_TEST_ID,
} from '.';
import { getMediaSheetPhase } from './sheetStore';

import { ConfirmDialogHost } from '@/components/ConfirmDialog';
import { resetConfirmDialogQueue } from '@/components/ConfirmDialog/store';
import type { ComposerDraft } from '@/features/chats/useComposerDraft';
import { useMediaSelection } from '@/features/media/selectionStore';

const WINDOW = 'media-picker-window';

// Грид тянет за собой expo-media-library, которого в тестах нет. Подменяем
// его, но шапку рисуем: в ней живёт место, тап по которому закрывает шит.
jest.mock('@/features/media', () => {
  const React = require('react');
  const { View } = require('react-native');

  return {
    ...jest.requireActual('@/features/media/selectionStore'),
    ...jest.requireActual('@/features/media/MediaGrid/gridLayout'),
    GridSkeleton: () => null,
    MediaGrid: ({ header }: { header?: React.ReactNode }) =>
      React.createElement(View, null, header),
  };
});

const photo = {
  id: 'content://media/external/images/media/1',
  kind: 'photo' as const,
  width: 100,
  height: 100,
  durationMs: null,
};

function draft(): ComposerDraft {
  return {
    text: '',
    setText: jest.fn(),
    media: jest.fn(() => []),
    clear: jest.fn(),
    clearMedia: jest.fn(),
  };
}

type SheetProps = Partial<React.ComponentProps<typeof MediaPickerSheet>>;

function sheet(props: SheetProps = {}) {
  return <MediaPickerSheet draft={draft()} onTyping={jest.fn()} onSend={jest.fn()} {...props} />;
}

/** Окно шита появилось на экране — на устройстве об этом сообщает Android. */
async function showWindow() {
  await act(async () => {
    screen.getByTestId(WINDOW).props.onShow();
  });
}

/** Касание и отпускание кнопки медиа; окно показано. */
async function renderOpenSheet(props: SheetProps = {}) {
  await render(
    <>
      {sheet(props)}
      <ConfirmDialogHost />
    </>,
  );

  await act(async () => {
    armMediaSheet();
    openMediaSheet();
  });
  await showWindow();
}

/** Смахивание вниз. Скорость выше порога не зависит от высоты тестового экрана. */
async function swipeDown({ velocityY = 2000, translationY = 200 } = {}) {
  await act(async () => {
    fireGestureHandler<PanGesture>(getByGestureTestId(SHEET_PAN_TEST_ID), [
      { state: State.BEGAN, translationY: 0 },
      { state: State.ACTIVE, translationY: 0 },
      { translationY: translationY / 2 },
      { translationY },
      { state: State.END, translationY, velocityY },
    ]);
  });
}

// Пороги закрытия проверяются в shouldDismissSheet.test.ts, а передача
// движения между списком и шитом — в followFinger.test.ts: позиция скролла в
// jest не приходит, и через жест эти случаи здесь не воспроизвести.

beforeEach(() => {
  jest.clearAllMocks();
  resetConfirmDialogQueue();
  resetMediaSheet();
  useMediaSelection.getState().clear();
});

describe('MediaPickerSheet', () => {
  it(
    'closes on a swipe down when nothing is selected',
    async () => {
      await renderOpenSheet();
      await swipeDown();

      expect(screen.queryByText(/Отменить выбор файлов/)).toBeNull();
      expect(getMediaSheetPhase()).toBe('closed');
      expect(screen.queryByTestId('media-picker-backdrop')).toBeNull();
    },
    // Первый тест в файле тянет холодную инициализацию моков
    // reanimated/gesture-handler — 5 секунд по умолчанию иногда не хватает.
    15_000,
  );

  it('has no close button — the sheet is dismissed by gestures and by the backdrop', async () => {
    await renderOpenSheet();

    expect(screen.queryByLabelText('Закрыть')).toBeNull();
  });

  it('prepares the window on touch but shows the sheet only once the finger is lifted', async () => {
    await render(sheet());

    expect(screen.queryByTestId(WINDOW)).toBeNull();

    await act(async () => armMediaSheet());

    // Окно рождается, пока палец на кнопке, — но в нём только оболочка,
    // список с клетками не монтируется.
    expect(screen.getByTestId(WINDOW)).toBeTruthy();
    expect(screen.getByTestId('media-picker-shell')).toBeTruthy();

    await showWindow();

    expect(screen.queryByTestId('media-picker-backdrop')).toBeNull();

    await act(async () => openMediaSheet());

    expect(await screen.findByTestId('media-picker-backdrop')).toBeTruthy();
  });

  it('does not start opening before its window is on screen', async () => {
    await render(sheet());

    await act(async () => {
      armMediaSheet();
      openMediaSheet();
    });

    // Палец отпущен, но окна ещё не видно: анимация проигралась бы вхолостую.
    expect(screen.queryByTestId('media-picker-backdrop')).toBeNull();

    await showWindow();

    expect(await screen.findByTestId('media-picker-backdrop')).toBeTruthy();
  });

  it('drops the prepared window when the finger slides off the button', async () => {
    jest.useFakeTimers();

    try {
      await render(sheet());

      await act(async () => {
        armMediaSheet();
        releaseMediaSheetArm();
        jest.runAllTimers();
      });

      expect(getMediaSheetPhase()).toBe('closed');
      expect(screen.queryByTestId(WINDOW)).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('still opens when the press arrives right after the finger lifts', async () => {
    jest.useFakeTimers();

    try {
      await render(sheet());

      // `onPressOut` приходит раньше `onPress` — окно не должно успеть пропасть.
      await act(async () => {
        armMediaSheet();
        releaseMediaSheetArm();
        openMediaSheet();
        jest.runAllTimers();
      });

      expect(getMediaSheetPhase()).toBe('open');
    } finally {
      jest.useRealTimers();
    }
  });

  it('closes the prepared window on back without showing anything', async () => {
    await render(sheet());

    await act(async () => armMediaSheet());
    await act(async () => screen.getByTestId(WINDOW).props.onRequestClose());

    expect(getMediaSheetPhase()).toBe('closed');
  });

  it('keeps the sheet on screen and asks instead of leaving with the files selected', async () => {
    useMediaSelection.getState().toggle(photo);

    await renderOpenSheet();

    expect(screen.queryByText('Отменить выбор файлов?')).toBeNull();

    await swipeDown();

    expect(await screen.findByText('Отменить выбор файлов?')).toBeTruthy();
    // Вопрос задаётся поверх шита, а не вместо него.
    expect(getMediaSheetPhase()).toBe('open');
    expect(screen.getByTestId('media-picker-backdrop')).toBeTruthy();
  });

  it('draws the question in its own window instead of opening a second one', async () => {
    useMediaSelection.getState().toggle(photo);

    // Корневого хоста здесь нет вовсе: вопрос обязан нарисоваться самим
    // шитом, внутри уже открытого окна.
    await render(sheet());
    await act(async () => openMediaSheet());
    await showWindow();
    await swipeDown();

    expect(await screen.findByText('Отменить выбор файлов?')).toBeTruthy();
  });

  it('asks once, not twice, when the root host is mounted as well', async () => {
    useMediaSelection.getState().toggle(photo);

    await renderOpenSheet();
    await swipeDown();

    await screen.findByText('Отменить выбор файлов?');

    expect(screen.getAllByText('Отменить выбор файлов?')).toHaveLength(1);
  });

  it('keeps the selection and brings the sheet back on cancel', async () => {
    useMediaSelection.getState().toggle(photo);

    await renderOpenSheet();
    await swipeDown();
    await screen.findByText('Отменить выбор файлов?');

    const user = userEvent.setup();
    await user.press(screen.getByText('Отмена'));

    expect(useMediaSelection.getState().order).toEqual([photo.id]);
    expect(getMediaSheetPhase()).toBe('open');
    expect(screen.getByTestId('media-picker-backdrop')).toBeTruthy();
  });

  it('clears the selection and only then leaves once discard is confirmed', async () => {
    useMediaSelection.getState().toggle(photo);

    await renderOpenSheet();
    await swipeDown();
    await screen.findByText('Отменить выбор файлов?');

    const user = userEvent.setup();
    await user.press(screen.getByText('Сбросить'));

    expect(useMediaSelection.getState().order).toEqual([]);
    expect(getMediaSheetPhase()).toBe('closed');
  });

  it('asks the same question on a backdrop tap while files are selected', async () => {
    useMediaSelection.getState().toggle(photo);

    await renderOpenSheet();

    const user = userEvent.setup();
    await user.press(screen.getByTestId('media-picker-backdrop'));

    expect(await screen.findByText('Отменить выбор файлов?')).toBeTruthy();
    expect(getMediaSheetPhase()).toBe('open');
  });

  it('closes right away on a backdrop tap when nothing is selected', async () => {
    await renderOpenSheet();

    const user = userEvent.setup();
    await user.press(screen.getByTestId('media-picker-backdrop'));

    expect(getMediaSheetPhase()).toBe('closed');
  });

  it('answers the question with back instead of closing the sheet under it', async () => {
    useMediaSelection.getState().toggle(photo);

    await renderOpenSheet();

    const back = () => act(async () => screen.getByTestId(WINDOW).props.onRequestClose());

    await back();
    expect(await screen.findByText('Отменить выбор файлов?')).toBeTruthy();

    await back();
    expect(screen.queryByText('Отменить выбор файлов?')).toBeNull();
    expect(getMediaSheetPhase()).toBe('open');
  });

  it('shows the composer footer only once a file is selected', async () => {
    await renderOpenSheet();

    expect(screen.queryByLabelText('Сообщение')).toBeNull();

    await act(async () => {
      useMediaSelection.getState().toggle(photo);
    });

    expect(await screen.findByLabelText('Сообщение')).toBeTruthy();
  });

  it('sends from its own composer and leaves', async () => {
    const onSend = jest.fn();
    useMediaSelection.getState().toggle(photo);

    await renderOpenSheet({ onSend });

    const user = userEvent.setup();
    await user.press(screen.getByText('Отправить'));

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(getMediaSheetPhase()).toBe('closed');
  });
});
