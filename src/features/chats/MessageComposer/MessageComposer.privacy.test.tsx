import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { MessageComposer } from '.';

import type { HiddenRange } from '@/features/chats/hiddenText';
import { useMediaSelection } from '@/features/media/selectionStore';

// Строка записи здесь ни при чём — без неё поле и кнопка «Отправить» те же.
jest.mock('@/features/media/HoldToRecordRow', () => {
  const { View } = require('react-native');

  return {
    HoldToRecordRow: ({ children, trailing }: { children: unknown; trailing?: unknown }) => (
      <View>
        {children}
        {trailing}
      </View>
    ),
  };
});

beforeEach(() => {
  jest.useFakeTimers();
  useMediaSelection.getState().clear();
});

afterEach(() => {
  jest.useRealTimers();
});

async function renderComposer({
  text,
  ranges = [],
  withHidden = true,
  placeholder = 'Сообщение',
}: {
  text: string;
  ranges?: HiddenRange[];
  withHidden?: boolean;
  placeholder?: string;
}) {
  const onSend = jest.fn();
  const onChange = jest.fn();

  await render(
    <MessageComposer
      text={text}
      onChangeText={jest.fn()}
      onSend={onSend}
      onTyping={jest.fn()}
      canSend
      placeholder={placeholder}
      hidden={withHidden ? { ranges, onChange } : undefined}
    />,
  );

  return { onSend, onChange };
}

async function settle() {
  await act(async () => {
    jest.advanceTimersByTime(500);
  });
}

describe('скрытый текст в поле ввода', () => {
  it('К1.1 выделил «школа 57» → «Скрыть от зрителей» скрывает именно его', async () => {
    const { onChange } = await renderComposer({ text: 'учусь: школа 57, класс 7Б' });

    expect(screen.queryByTestId('composer-hide-selection')).toBeNull();

    await fireEvent(screen.getByLabelText('Сообщение'), 'selectionChange', {
      nativeEvent: { selection: { start: 7, end: 15 } },
    });
    await fireEvent.press(screen.getByText('Скрыть от зрителей'));

    expect(onChange).toHaveBeenCalledWith([{ start: 7, end: 15 }]);
  });

  it('уже скрытое выделение — «Показать зрителям» снимает скрытие', async () => {
    const { onChange } = await renderComposer({
      text: 'учусь: школа 57, класс 7Б',
      ranges: [{ start: 7, end: 15 }],
    });

    await fireEvent(screen.getByLabelText('Сообщение'), 'selectionChange', {
      nativeEvent: { selection: { start: 7, end: 12 } },
    });
    await fireEvent.press(screen.getByText('Показать зрителям'));

    expect(onChange).toHaveBeenCalledWith([{ start: 12, end: 15 }]);
  });

  it('скрытое в поле — с пометкой, как его увидят участники', async () => {
    await renderComposer({ text: 'учусь: школа 57', ranges: [{ start: 7, end: 15 }] });

    expect(screen.getByTestId('hidden-text-mark')).toHaveTextContent('школа 57');
  });

  it('без скрытого текста (комментарий) кнопки скрыть нет', async () => {
    await renderComposer({
      text: 'учусь: школа 57',
      withHidden: false,
      placeholder: 'Комментарий',
    });

    await fireEvent(screen.getByLabelText('Комментарий'), 'selectionChange', {
      nativeEvent: { selection: { start: 7, end: 15 } },
    });

    expect(screen.queryByTestId('composer-hide-selection')).toBeNull();
  });
});

describe('предупреждения о личных данных', () => {
  it('К3.1 телефон — подсказка над полем, отправка без листа', async () => {
    const { onSend } = await renderComposer({ text: 'мой телефон +7 999 123-45-67' });
    await settle();

    expect(screen.getByTestId('personal-data-hint')).toHaveTextContent(/Телефон — это увидят все/);

    await fireEvent.press(screen.getByLabelText('Отправить'));

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Это увидят все')).toBeNull();
  });

  it('К3.2 адрес — лист; «Скрыть найденное от зрителей» скрывает адрес и отправляет', async () => {
    const { onSend, onChange } = await renderComposer({ text: 'живу на Ленина 5, кв 12' });

    await fireEvent.press(screen.getByLabelText('Отправить'));

    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByText('Это увидят все')).toBeTruthy();
    expect(screen.getByText(/Это сообщение увидят все, кто откроет чат/)).toBeTruthy();
    expect(screen.getByText('Ленина 5, кв 12')).toBeTruthy();

    await fireEvent.press(screen.getByText('Скрыть найденное от зрителей'));

    expect(onChange).toHaveBeenCalledWith([{ start: 8, end: 23 }]);
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('К3.3 школа, класс и расписание — три пункта; «Изменить» ничего не отправляет', async () => {
    const { onSend } = await renderComposer({
      text: 'школа 57, 7Б, каждый вторник в 15:00 у входа',
    });

    await fireEvent.press(screen.getByLabelText('Отправить'));

    expect(screen.getByText('школа 57')).toBeTruthy();
    expect(screen.getByText('7Б')).toBeTruthy();
    expect(screen.getByText('каждый вторник в 15:00 у входа')).toBeTruthy();

    await fireEvent.press(screen.getByText('Изменить'));

    expect(onSend).not.toHaveBeenCalled();
    expect(screen.queryByText('Это увидят все')).toBeNull();
  });

  it('«Отправить как есть» отправляет без скрытия', async () => {
    const { onSend, onChange } = await renderComposer({ text: 'живу на Ленина 5' });

    await fireEvent.press(screen.getByLabelText('Отправить'));
    await fireEvent.press(screen.getByText('Отправить как есть'));

    expect(onChange).not.toHaveBeenCalled();
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('К3.5 в комментарии лист без «Скрыть найденное»', async () => {
    const { onSend } = await renderComposer({
      text: 'живу на Ленина 5',
      withHidden: false,
      placeholder: 'Комментарий',
    });

    await fireEvent.press(screen.getByLabelText('Отправить'));

    expect(screen.queryByText('Скрыть найденное от зрителей')).toBeNull();
    await fireEvent.press(screen.getByText('Отправить как есть'));
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it.each(['дома скучно', 'в школе сегодня тест', 'встретимся в 5'])(
    'К3.4 «%s» — ни подсказки, ни листа',
    async (text) => {
      const { onSend } = await renderComposer({ text });
      await settle();

      expect(screen.queryByTestId('personal-data-hint')).toBeNull();
      await fireEvent.press(screen.getByLabelText('Отправить'));
      expect(onSend).toHaveBeenCalledTimes(1);
    },
  );
});
