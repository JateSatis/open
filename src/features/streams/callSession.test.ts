import { AudioSession } from '@livekit/react-native';
import { Room, RoomEvent } from 'livekit-client';

import { startCallService, stopCallService } from '../../../modules/call-service';

import { requestStreamToken, StreamJoinError } from '@/api/streams';
import { stopVoice } from '@/features/media';
import { useInAppAlert } from '@/features/notifications/alertsStore';
import { joinCall, leaveCall, toggleMic } from '@/features/streams/callSession';
import { getCall, setCall } from '@/features/streams/callStore';
import { isInCall, setInCall } from '@/store/callPresence';

jest.mock('@/api/streams');
jest.mock('@/features/media', () => ({ stopVoice: jest.fn() }));
jest.mock('../../../modules/call-service', () => ({
  startCallService: jest.fn(() => true),
  stopCallService: jest.fn(),
}));

type MockRoom = Room & {
  connect: jest.Mock;
  disconnect: jest.Mock;
  localParticipant: Room['localParticipant'] & { setMicrophoneEnabled: jest.Mock };
};

const rooms = () => (Room as unknown as { instances: MockRoom[] }).instances;
const lastRoom = () => rooms()[rooms().length - 1];

const mockedToken = requestStreamToken as jest.MockedFunction<typeof requestStreamToken>;

const input = { streamId: 'stream-1', chatId: 'chat-1', chatTitle: 'Поход', isDirect: false };

function grant(role: 'host' | 'speaker' | 'listener') {
  mockedToken.mockResolvedValue({
    token: 'jwt',
    url: 'wss://lk',
    role,
    streamId: 'stream-1',
    chatId: 'chat-1',
  });
}

beforeEach(async () => {
  jest.clearAllMocks();
  await leaveCall();
  setCall(null);
  setInCall(false);
  useInAppAlert.setState({ alert: null });
});

it('слушатель входит без микрофона — публиковать ему нечем', async () => {
  grant('listener');

  await joinCall(input);

  expect(lastRoom().connect).toHaveBeenCalledWith('wss://lk', 'jwt', expect.anything());
  expect(lastRoom().localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled();
  expect(getCall()?.role).toBe('listener');
  expect(startCallService).toHaveBeenCalledWith(expect.any(String), expect.any(String), false);
});

it('участник входит говорящим: голосовое замолкает, аудиосессия до комнаты, микрофон включён', async () => {
  grant('speaker');

  await joinCall(input);

  expect(stopVoice).toHaveBeenCalled();
  expect(isInCall()).toBe(true);
  expect(AudioSession.startAudioSession).toHaveBeenCalled();

  const sessionOrder = (AudioSession.startAudioSession as jest.Mock).mock.invocationCallOrder[0];
  const connectOrder = lastRoom().connect.mock.invocationCallOrder[0];

  expect(sessionOrder).toBeLessThan(connectOrder);
  expect(lastRoom().localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(true);
  expect(getCall()?.connection).toBe('connected');
  expect(startCallService).toHaveBeenCalledWith(
    expect.stringContaining('В эфире'),
    expect.any(String),
    true,
  );
});

it('завершённый звонок — понятная ошибка, ничего не остаётся висеть', async () => {
  mockedToken.mockRejectedValue(new StreamJoinError('ended', 'Звонок уже завершён'));

  await expect(joinCall(input)).rejects.toThrow('Звонок уже завершён');

  expect(getCall()).toBeNull();
  expect(isInCall()).toBe(false);
  expect(stopCallService).toHaveBeenCalled();
  expect(AudioSession.stopAudioSession).toHaveBeenCalled();
});

it('обрыв — «переподключение», вернулись — снова в звонке', async () => {
  grant('speaker');
  await joinCall(input);

  lastRoom().emit(RoomEvent.Reconnecting);
  expect(getCall()?.connection).toBe('reconnecting');

  lastRoom().emit(RoomEvent.Reconnected);
  expect(getCall()?.connection).toBe('connected');
});

it('комнату закрыли (вышел последний участник) — выход с объяснением', async () => {
  grant('listener');
  await joinCall(input);

  lastRoom().emit(RoomEvent.Disconnected, 5);
  await new Promise((resolve) => setImmediate(resolve));

  expect(getCall()).toBeNull();
  const alert = useInAppAlert.getState().alert;
  expect(alert?.kind === 'notice' && alert.text).toBe('Звонок завершён');
});

it('не удалось переподключиться — выход, а не молчаливый обрыв', async () => {
  grant('speaker');
  await joinCall(input);

  lastRoom().emit(RoomEvent.Disconnected, 0);
  await new Promise((resolve) => setImmediate(resolve));

  expect(getCall()).toBeNull();
  const alert = useInAppAlert.getState().alert;
  expect(alert?.kind === 'notice' && alert.text).toBe('Связь со звонком потеряна');
});

it('выход: комната отключена, служба и аудиосессия закрыты', async () => {
  grant('speaker');
  await joinCall(input);
  const room = lastRoom();

  await leaveCall();

  expect(room.disconnect).toHaveBeenCalled();
  expect(stopCallService).toHaveBeenCalled();
  expect(AudioSession.stopAudioSession).toHaveBeenCalled();
  expect(isInCall()).toBe(false);
  expect(getCall()).toBeNull();
});

it('у слушателя переключатель микрофона ничего не делает', async () => {
  grant('listener');
  await joinCall(input);

  await toggleMic();

  expect(lastRoom().localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled();
});

it('повторный вход в тот же звонок не создаёт вторую комнату', async () => {
  grant('speaker');
  await joinCall(input);
  const count = rooms().length;

  await joinCall(input);

  expect(rooms().length).toBe(count);
});
