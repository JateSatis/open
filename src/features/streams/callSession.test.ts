import { addSession, getAccounts, selectAccount, signOutAccount } from '@/features/auth/sessionStore';
import { sessionOf } from '@/test/sessionOf';
import { AudioSession } from '@livekit/react-native';
import { Room, RoomEvent } from 'livekit-client';

import { startCallService, stopCallService } from '../../../modules/call-service';

import { requestStreamToken, StreamJoinError } from '@/api/streams';
import { stopVoice } from '@/features/media';
import { useInAppAlert } from '@/features/notifications/alertsStore';
import { joinCall, leaveCall, toggleMic } from '@/features/streams/callSession';
import { prepareLiveKit } from './livekitGlobals';
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

afterEach(() => leaveCall());

beforeEach(() => {
  jest.clearAllMocks();
  setCall(null);
  setInCall(false);
  useInAppAlert.setState({ alert: null });
});

it('вход и прогрев делят одну подготовку и подключаются один раз', async () => {
  grant('speaker');
  const warm = prepareLiveKit();
  expect(prepareLiveKit()).toBe(warm);
  const joining = joinCall(input);
  await Promise.all([warm, joining, joinCall(input)]);

  expect(mockedToken).toHaveBeenCalledTimes(1);
  expect(lastRoom().connect).toHaveBeenCalledTimes(1);
});

it('выход во время ожидания подготовки отменяет вход до запроса токена', async () => {
  const count = rooms().length;
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  }).then(prepareLiveKit);
  const joining = joinCall(input, pending);
  await leaveCall();
  finish();
  await joining;

  expect(getCall()).toBeNull();
  expect(mockedToken).not.toHaveBeenCalled();
  expect(AudioSession.startAudioSession).not.toHaveBeenCalled();
  expect(rooms()).toHaveLength(count);
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

it.each([false, true])('задержанное отключение освобождает ресурсы и сообщает причину только в A (выбран B: %s)', async switchAccount => {
  jest.spyOn(global, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
  try {
    for (const id of ['B', 'A']) {
      await addSession({
        ...sessionOf(id, 'session-' + id),
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        refresh_token: 'fixture-' + id,
      });
    }
    grant('listener');
    await joinCall(input);
    const room = lastRoom();
    let finish!: () => void;
    room.disconnect.mockImplementationOnce(() => new Promise<void>(done => { finish = done; }));
    jest.mocked(stopCallService).mockClear();
    room.emit(RoomEvent.Disconnected, 5);
    expect(getCall()).toBeNull();
    expect(room.disconnect).toHaveBeenCalledTimes(1);
    expect(isInCall()).toBe(false);
    if (switchAccount) await selectAccount('B');
    finish();
    await new Promise(resolve => setImmediate(resolve));
    expect(stopCallService).toHaveBeenCalledTimes(1);
    expect(AudioSession.stopAudioSession).toHaveBeenCalledTimes(1);
    expect(isInCall()).toBe(false);
    expect(useInAppAlert.getState().alert).toEqual(switchAccount ? null : {
      kind: 'notice', text: 'Звонок завершён', tone: 'info',
    });
  } finally {
    for (const id of getAccounts()) await signOutAccount(id);
    jest.restoreAllMocks();
  }
});

it('отмена следующего входа во время disconnect не оставляет старую аудиосессию включённой', async () => {
  grant('listener');
  await joinCall(input);
  let disconnect!: () => void;
  lastRoom().disconnect.mockImplementationOnce(() => new Promise<void>(done => { disconnect = done; }));
  lastRoom().emit(RoomEvent.Disconnected, 5);
  const preparing = prepareLiveKit();
  let finishPreparation!: () => void;
  const next = joinCall({ ...input, streamId: 'next' },
    new Promise<void>(done => { finishPreparation = done; }).then(() => preparing));
  const leaving = leaveCall();
  disconnect();
  finishPreparation();
  await Promise.all([leaving, next]);
  expect(AudioSession.startAudioSession).toHaveBeenCalledTimes(1);
  expect(AudioSession.stopAudioSession).toHaveBeenCalledTimes(1);
  expect(isInCall()).toBe(false);
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
