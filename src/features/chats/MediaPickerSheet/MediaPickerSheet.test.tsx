import { act, render, screen, userEvent } from '@testing-library/react-native';
import { State } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';
import type { PanGesture } from 'react-native-gesture-handler';

import { MediaPickerSheet, SHEET_PAN_TEST_ID } from '.';

import { ConfirmDialogHost } from '@/components/ConfirmDialog';
import { resetConfirmDialogQueue } from '@/components/ConfirmDialog/store';
import type { ComposerDraft } from '@/features/chats/useComposerDraft';
import { useMediaSelection } from '@/features/media/selectionStore';

// Грид тянет за собой expo-media-library, которого в тестах нет. Подменяем
// его, но шапку рисуем: в ней живёт место, тап по которому закрывает шит.
jest.mock('@/features/media', () => {
  const React = require('react');
  const { View } = require('react-native');

  return {
    ...jest.requireActual('@/features/media/selectionStore'),
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

function renderSheet(props: Partial<React.ComponentProps<typeof MediaPickerSheet>> = {}) {
  return render(
    <>
      <MediaPickerSheet
        visible
        onDismiss={jest.fn()}
        draft={draft()}
        onTyping={jest.fn()}
        onSend={jest.fn()}
        {...props}
      />
      <ConfirmDialogHost />
    </>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  resetConfirmDialogQueue();
  useMediaSelection.getState().clear();
});

describe('MediaPickerSheet', () => {
  it(
    'closes on a swipe down when nothing is selected',
    async () => {
      const onDismiss = jest.fn();

      await renderSheet({ onDismiss });
      await swipeDown();

      expect(screen.queryByText(/Отменить выбор файлов/)).toBeNull();
      expect(onDismiss).toHaveBeenCalledTimes(1);
    },
    // Первый тест в файле тянет холодную инициализацию моков
    // reanimated/gesture-handler — на этом фоне 5-секундный таймаут по
    // умолчанию иногда не хватает, хотя сам рендер занимает миллисекунды.
    15_000,
  );

  it('has no close button — the sheet is dismissed by gestures and by the backdrop', async () => {
    await renderSheet();

    expect(screen.queryByLabelText('Закрыть')).toBeNull();
  });

  it('asks about discarding only when the sheet is actually being dismissed', async () => {
    useMediaSelection.getState().toggle(photo);

    await renderSheet();

    // Сам по себе выбор файлов ничего не спрашивает.
    expect(screen.queryByText('Отменить выбор файлов?')).toBeNull();

    await swipeDown();

    // Вопрос задаётся из колбэка анимации закрытия, то есть уже после того,
    // как шит уехал. Порядок «уехал → спросили» на глаз проверяется на
    // устройстве: мок reanimated выполняет анимацию мгновенно.
    expect(await screen.findByText('Отменить выбор файлов?')).toBeTruthy();
  });

  it('keeps the selection and brings the sheet back on cancel', async () => {
    const onDismiss = jest.fn();
    useMediaSelection.getState().toggle(photo);

    await renderSheet({ onDismiss });
    await swipeDown();
    await screen.findByText('Отменить выбор файлов?');

    const user = userEvent.setup();
    await user.press(screen.getByText('Отмена'));

    expect(useMediaSelection.getState().order).toEqual([photo.id]);
    // Шит вернулся, а не закрылся: наружу о закрытии не сообщали.
    expect(onDismiss).not.toHaveBeenCalled();
    expect(screen.getByTestId('media-picker-backdrop')).toBeTruthy();
  });

  it('clears the selection and stays closed once discard is confirmed', async () => {
    const onDismiss = jest.fn();
    useMediaSelection.getState().toggle(photo);

    await renderSheet({ onDismiss });
    await swipeDown();
    await screen.findByText('Отменить выбор файлов?');

    const user = userEvent.setup();
    await user.press(screen.getByText('Сбросить'));

    expect(useMediaSelection.getState().order).toEqual([]);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('asks the same question on a backdrop tap while files are selected', async () => {
    const onDismiss = jest.fn();
    useMediaSelection.getState().toggle(photo);

    await renderSheet({ onDismiss });

    const user = userEvent.setup();
    await user.press(screen.getByTestId('media-picker-backdrop'));

    expect(await screen.findByText('Отменить выбор файлов?')).toBeTruthy();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('closes right away on a backdrop tap when nothing is selected', async () => {
    const onDismiss = jest.fn();

    await renderSheet({ onDismiss });

    const user = userEvent.setup();
    await user.press(screen.getByTestId('media-picker-backdrop'));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('shows the composer footer only once a file is selected', async () => {
    const { rerender } = await renderSheet();

    expect(screen.queryByLabelText('Сообщение')).toBeNull();

    await act(async () => {
      useMediaSelection.getState().toggle(photo);
    });

    await rerender(
      <>
        <MediaPickerSheet
          visible
          onDismiss={jest.fn()}
          draft={draft()}
          onTyping={jest.fn()}
          onSend={jest.fn()}
        />
        <ConfirmDialogHost />
      </>,
    );

    expect(await screen.findByLabelText('Сообщение')).toBeTruthy();
  });

  it('renders nothing until it is made visible', async () => {
    const { rerender } = await render(
      <MediaPickerSheet
        visible={false}
        onDismiss={jest.fn()}
        draft={draft()}
        onTyping={jest.fn()}
        onSend={jest.fn()}
      />,
    );

    expect(screen.queryByTestId('media-picker-backdrop')).toBeNull();

    await rerender(
      <MediaPickerSheet
        visible
        onDismiss={jest.fn()}
        draft={draft()}
        onTyping={jest.fn()}
        onSend={jest.fn()}
      />,
    );

    expect(await screen.findByTestId('media-picker-backdrop')).toBeTruthy();
  });
});
