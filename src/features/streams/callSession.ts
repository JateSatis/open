import { AudioSession, AndroidAudioTypePresets } from '@livekit/react-native';
import { DisconnectReason, Room, RoomEvent, type Participant } from 'livekit-client';
import { Platform } from 'react-native';

import { startCallService, stopCallService } from '../../../modules/call-service';

import { fetchStreamStatus, requestStreamToken, type StreamRole } from '@/api/streams';
import {
  getCall,
  patchCall,
  setCall,
  toRoster,
  type RoomMember,
} from '@/features/streams/callStore';
import { stopVoice } from '@/features/media';
import { showNotice } from '@/features/notifications/alertsStore';
import { setInCall } from '@/store/callPresence';

/**
 * Один звонок на всё приложение — одна комната LiveKit в модуле, а не в
 * компоненте: звонок переживает уход с экрана звонка, переходы по вкладкам и
 * сворачивание приложения. Экран лишь показывает `useCallStore`.
 *
 * Порядок входа важен: аудиосессия и служба — до комнаты (`CLAUDE.md`,
 * «Стримы»), голосовое замолкает до того, как звонок займёт звук.
 */

/** Как часто сверять со своей стороны, не завершён ли звонок, пока я в нём. */
const STATUS_CHECK_MS = 20_000;
/** Говорящих не осталось — через столько спросить базу, не конец ли это. */
const EMPTY_CHECK_MS = 4_000;

let room: Room | null = null;
/** Каждому входу номер: ответ устаревшего входа не трогает новый звонок. */
let generation = 0;
let statusTimer: ReturnType<typeof setInterval> | null = null;
let emptyTimer: ReturnType<typeof setTimeout> | null = null;

export type JoinCallInput = {
  streamId: string;
  chatId: string;
  chatTitle: string;
  /** Личный диалог: говорящий по умолчанию слышит собеседника в разговорный динамик. */
  isDirect: boolean;
};

function members(current: Room): RoomMember[] {
  const toMember = (participant: Participant, isLocal: boolean): RoomMember => ({
    identity: participant.identity,
    name: participant.name,
    metadata: participant.metadata,
    isLocal,
    isSpeaking: participant.isSpeaking,
    isMicrophoneEnabled: participant.isMicrophoneEnabled,
  });

  return [
    toMember(current.localParticipant, true),
    ...[...current.remoteParticipants.values()].map((participant) => toMember(participant, false)),
  ];
}

function refreshRoster() {
  if (!room || !getCall()) return;

  const roster = toRoster(members(room));

  patchCall({
    speakers: roster.speakers,
    listeners: roster.listeners,
    micOn: room.localParticipant.isMicrophoneEnabled,
  });

  // Слушатель остался в комнате без говорящих — вебхук вот-вот закроет её;
  // если нет, спросим базу сами, чтобы не висеть в тишине.
  if (roster.speakers.length === 0 && getCall()?.connection === 'connected') {
    if (!emptyTimer) emptyTimer = setTimeout(() => void checkStillLive(), EMPTY_CHECK_MS);
  } else if (emptyTimer) {
    clearTimeout(emptyTimer);
    emptyTimer = null;
  }
}

async function checkStillLive() {
  emptyTimer = null;

  const call = getCall();

  if (!call) return;

  try {
    const status = await fetchStreamStatus(call.streamId);

    if (getCall()?.streamId !== call.streamId) return;
    if (!status || status.status === 'ended') await endLocally('Звонок завершён');
  } catch {
    // Сети нет — это покажет переподключение LiveKit, а не эта проверка.
  }
}

async function routeAudio(speakerOn: boolean) {
  try {
    if (Platform.OS === 'ios') {
      await AudioSession.selectAudioOutput(speakerOn ? 'force_speaker' : 'default');
      return;
    }

    if (speakerOn) {
      await AudioSession.selectAudioOutput('speaker');
      return;
    }

    // Не громкая — значит гарнитура, если она есть, и только потом «к уху».
    const outputs = await AudioSession.getAudioOutputs();
    const preferred = ['bluetooth', 'headset', 'earpiece'].find((output) =>
      outputs.includes(output),
    );

    if (preferred) await AudioSession.selectAudioOutput(preferred);
  } catch {
    // Маршрут не переключился — звук идёт, куда шёл.
  }
}

async function releaseResources() {
  if (statusTimer) clearInterval(statusTimer);
  if (emptyTimer) clearTimeout(emptyTimer);

  statusTimer = null;
  emptyTimer = null;

  const current = room;

  room = null;

  if (current) {
    current.removeAllListeners();
    await current.disconnect().catch(() => undefined);
  }

  stopCallService();
  await AudioSession.stopAudioSession().catch(() => undefined);
  setInCall(false);
}

/** Звонок кончился не по моей кнопке: объясняем, почему. */
async function endLocally(reason: string) {
  generation += 1;
  setCall(null);
  await releaseResources();
  showNotice(reason);
}

function onDisconnected(reason?: DisconnectReason) {
  if (reason === DisconnectReason.CLIENT_INITIATED) return;

  const text =
    reason === DisconnectReason.ROOM_DELETED
      ? 'Звонок завершён'
      : reason === DisconnectReason.DUPLICATE_IDENTITY
        ? 'Вы подключились к звонку с другого устройства'
        : 'Связь со звонком потеряна';

  void endLocally(text);
}

function attach(current: Room) {
  current
    .on(RoomEvent.ParticipantConnected, refreshRoster)
    .on(RoomEvent.ParticipantDisconnected, refreshRoster)
    .on(RoomEvent.ParticipantMetadataChanged, refreshRoster)
    .on(RoomEvent.ActiveSpeakersChanged, refreshRoster)
    .on(RoomEvent.TrackMuted, refreshRoster)
    .on(RoomEvent.TrackUnmuted, refreshRoster)
    .on(RoomEvent.TrackPublished, refreshRoster)
    .on(RoomEvent.TrackUnpublished, refreshRoster)
    .on(RoomEvent.LocalTrackPublished, refreshRoster)
    .on(RoomEvent.LocalTrackUnpublished, refreshRoster)
    .on(RoomEvent.Reconnecting, () => patchCall({ connection: 'reconnecting' }))
    .on(RoomEvent.SignalReconnecting, () => patchCall({ connection: 'reconnecting' }))
    .on(RoomEvent.Reconnected, () => {
      patchCall({ connection: 'connected' });
      refreshRoster();
    })
    .on(RoomEvent.Disconnected, onDisconnected);
}

/**
 * Входит в звонок. Уже в нём — ничего не делает; в другом — сначала выходит
 * из него. Бросает `StreamJoinError` с человеческим текстом, если войти нельзя.
 */
export async function joinCall(input: JoinCallInput): Promise<void> {
  const existing = getCall();

  if (existing?.streamId === input.streamId) return;
  if (existing) await leaveCall();

  const current = ++generation;

  stopVoice();
  setInCall(true);
  setCall({
    streamId: input.streamId,
    chatId: input.chatId,
    chatTitle: input.chatTitle,
    role: 'listener',
    connection: 'connecting',
    micOn: false,
    speakerOn: true,
    speakers: [],
    listeners: 0,
    joinedAt: Date.now(),
  });

  try {
    const join = await requestStreamToken(input.streamId);

    if (current !== generation) return;

    const speaks = join.role !== 'listener';
    // Эфир слушают с громкой; в личном диалоге говорящий по привычке держит
    // телефон у уха.
    const speakerOn = !(speaks && input.isDirect);

    patchCall({ role: join.role, speakerOn });

    await AudioSession.configureAudio({
      android: {
        preferredOutputList: speakerOn
          ? ['bluetooth', 'headset', 'speaker', 'earpiece']
          : ['bluetooth', 'headset', 'earpiece', 'speaker'],
        audioTypeOptions: AndroidAudioTypePresets.communication,
      },
      ios: { defaultOutput: speakerOn ? 'speaker' : 'earpiece' },
    });
    await AudioSession.startAudioSession();

    startCallService(
      speaks ? `В эфире · ${input.chatTitle}` : `Вы слушаете · ${input.chatTitle}`,
      speaks ? 'Звонок публичный: вас слышат слушатели' : 'Нажмите, чтобы вернуться к звонку',
      speaks,
    );

    const next = new Room({ adaptiveStream: false, dynacast: false });

    attach(next);
    room = next;

    await next.connect(join.url, join.token, { autoSubscribe: true });

    if (current !== generation) {
      await next.disconnect();
      return;
    }

    if (speaks) await next.localParticipant.setMicrophoneEnabled(true);

    await routeAudio(speakerOn);

    patchCall({ connection: 'connected', joinedAt: Date.now() });
    refreshRoster();

    statusTimer = setInterval(() => void checkStillLive(), STATUS_CHECK_MS);
  } catch (error) {
    if (current !== generation) return;

    generation += 1;
    setCall(null);
    await releaseResources();
    throw error;
  }
}

/** Выход по моей кнопке. Звонок для остальных продолжается — или кончается, если я был последним участником чата. */
export async function leaveCall(): Promise<void> {
  generation += 1;
  setCall(null);
  await releaseResources();
}

export async function toggleMic(): Promise<void> {
  const call = getCall();

  if (!room || !call || call.role === 'listener') return;

  const next = !room.localParticipant.isMicrophoneEnabled;

  patchCall({ micOn: next });

  try {
    await room.localParticipant.setMicrophoneEnabled(next);
  } catch {
    patchCall({ micOn: !next });
    showNotice('Не удалось переключить микрофон', 'error');
  }

  refreshRoster();
}

export async function toggleSpeaker(): Promise<void> {
  const call = getCall();

  if (!call) return;

  const next = !call.speakerOn;

  patchCall({ speakerOn: next });
  await routeAudio(next);
}

/** Роль в звонке, в котором я сейчас, или null. */
export function currentRole(): StreamRole | null {
  return getCall()?.role ?? null;
}
