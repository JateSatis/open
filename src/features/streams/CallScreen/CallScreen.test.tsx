import { act, fireEvent, screen } from '@testing-library/react-native';

import { CallScreen } from './index';

import { leaveCall, toggleMic, toggleSpeaker } from '@/features/streams/callSession';
import { setCall, type ActiveCall } from '@/features/streams/callStore';
import { renderWithQuery } from '@/test/renderWithQuery';

const mockBack = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack, canGoBack: () => true, push: jest.fn() }),
}));
jest.mock('@/api/streams');
jest.mock('@/features/streams/callSession', () => ({
  leaveCall: jest.fn(() => Promise.resolve()),
  toggleMic: jest.fn(() => Promise.resolve()),
  toggleSpeaker: jest.fn(() => Promise.resolve()),
}));

function call(overrides: Partial<ActiveCall> = {}): ActiveCall {
  return {
    streamId: 'stream-1',
    chatId: 'chat-1',
    chatTitle: 'Поход',
    role: 'speaker',
    connection: 'connected',
    micOn: true,
    speakerOn: true,
    speakers: [
      { id: 'user-1', name: 'Я', isLocal: true, speaking: false, micOn: true },
      { id: 'user-2', name: 'Марина', isLocal: false, speaking: true, micOn: true },
      { id: 'user-3', name: 'Пётр', isLocal: false, speaking: false, micOn: false },
    ],
    listeners: 12,
    joinedAt: Date.now(),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  setCall(null);
});

describe('экран звонка у говорящего', () => {
  it('всегда показывает, что звонок в эфире и сколько слушают', async () => {
    setCall(call());

    await renderWithQuery(<CallScreen />);

    expect(screen.getByText('В эфире · слушают 12')).toBeTruthy();
    expect(screen.getByText('Звонок публичный: слушать его может кто угодно')).toBeTruthy();
  });

  it('отметка публичности не пропадает и при нуле слушателей', async () => {
    setCall(call({ listeners: 0 }));

    await renderWithQuery(<CallScreen />);

    expect(screen.getByText('В эфире · слушают 0')).toBeTruthy();
  });

  it('говорящие с отметкой речи и выключенного микрофона', async () => {
    setCall(call());

    await renderWithQuery(<CallScreen />);

    expect(screen.getByLabelText('Марина, говорит')).toBeTruthy();
    expect(screen.getByLabelText('Пётр, микрофон выключен')).toBeTruthy();
    expect(screen.getByText('Вы')).toBeTruthy();
  });

  it('микрофон, динамик и выход', async () => {
    setCall(call());

    await renderWithQuery(<CallScreen />);

    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Микрофон' }));
      fireEvent.press(screen.getByRole('button', { name: 'Динамик' }));
      fireEvent.press(screen.getByRole('button', { name: 'Выйти' }));
    });

    expect(toggleMic).toHaveBeenCalled();
    expect(toggleSpeaker).toHaveBeenCalled();
    expect(leaveCall).toHaveBeenCalled();
    expect(mockBack).toHaveBeenCalled();
  });

  it('«свернуть» уходит с экрана, но из звонка не выходит', async () => {
    setCall(call());

    await renderWithQuery(<CallScreen />);

    fireEvent.press(screen.getByRole('button', { name: 'Свернуть звонок' }));

    expect(mockBack).toHaveBeenCalled();
    expect(leaveCall).not.toHaveBeenCalled();
  });

  it('при обрыве говорит «Переподключение…», а не молчит', async () => {
    setCall(call({ connection: 'reconnecting' }));

    await renderWithQuery(<CallScreen />);

    expect(screen.getByTestId('call-state')).toHaveTextContent('Переподключение…');
  });
});

describe('экран звонка у слушателя', () => {
  it('нет кнопки микрофона, есть «Вы слушаете»', async () => {
    setCall(call({ role: 'listener', micOn: false }));

    await renderWithQuery(<CallScreen />);

    expect(screen.queryByTestId('call-mic')).toBeNull();
    expect(screen.getByText('Вы слушаете · 12 слушают')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Динамик' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Выйти' })).toBeTruthy();
  });
});

it('звонок кончился, пока экран открыт, — экран закрывается сам', async () => {
  setCall(call());

  await renderWithQuery(<CallScreen />);
  await act(async () => setCall(null));

  expect(mockBack).toHaveBeenCalled();
});
