import { createAudioPlayer } from 'expo-audio';
import { act } from '@testing-library/react-native';

import { resolveVoiceUri } from './voiceCache';
import {
  playVoice,
  seekVoice,
  stopVoice,
  toggleVoice,
  useVoicePlaybackStore,
} from './voicePlayback';

jest.mock('expo-audio', () => ({
  createAudioPlayer: jest.fn(),
  setAudioModeAsync: jest.fn(async () => undefined),
}));

jest.mock('./voiceCache', () => ({
  resolveVoiceUri: jest.fn(async (url: string) => `file:///cache/${url.split('/').pop()}`),
}));

type StatusListener = (status: Record<string, unknown>) => void;

const player = {
  play: jest.fn(),
  pause: jest.fn(),
  replace: jest.fn(),
  seekTo: jest.fn(async () => undefined),
  addListener: jest.fn((_event: string, listener: StatusListener) => {
    statusListener = listener;
  }),
};

// Плеер создаётся один раз на модуль — слушатель запоминается, а не читается из мока.
let statusListener: StatusListener = () => undefined;

(createAudioPlayer as jest.Mock).mockReturnValue(player);

function emit(status: Partial<Record<string, unknown>>) {
  act(() =>
    statusListener({
      playing: true,
      isLoaded: true,
      isBuffering: false,
      currentTime: 0,
      duration: 10,
      didJustFinish: false,
      ...status,
    }),
  );
}

const first = { key: 'a', uri: 'https://cdn.test/a.m4a', durationMs: 10_000 };
const second = { key: 'b', uri: 'https://cdn.test/b.m4a', durationMs: 5_000 };

beforeEach(() => {
  stopVoice();
  jest.clearAllMocks();
});

describe('voicePlayback', () => {
  it('plays the cached file, not the network URL', async () => {
    await playVoice(first);

    expect(resolveVoiceUri).toHaveBeenCalledWith(first.uri);
    expect(player.replace).toHaveBeenCalledWith({ uri: 'file:///cache/a.m4a' });
    expect(player.play).toHaveBeenCalled();
    expect(useVoicePlaybackStore.getState().activeKey).toBe('a');
  });

  it('starting a second voice message stops the first', async () => {
    await playVoice(first);
    emit({ currentTime: 3 });

    await playVoice(second);

    // Один плеер на всё: второй ролик заменяет первый, а не играет поверх.
    expect(createAudioPlayer).toHaveBeenCalledTimes(0);
    expect(player.pause).toHaveBeenCalled();
    expect(player.replace).toHaveBeenLastCalledWith({ uri: 'file:///cache/b.m4a' });
    expect(useVoicePlaybackStore.getState().activeKey).toBe('b');
    expect(useVoicePlaybackStore.getState().positionMs).toBe(0);
  });

  it('pauses and resumes the same message on toggle', async () => {
    await playVoice(first);
    emit({ playing: true });

    toggleVoice(first);
    expect(player.pause).toHaveBeenCalled();
    expect(useVoicePlaybackStore.getState().playing).toBe(false);

    toggleVoice(first);
    expect(player.play).toHaveBeenCalledTimes(2);
  });

  it('seeks within the playing message', async () => {
    await playVoice(first);
    emit({ playing: true, duration: 10 });

    seekVoice(first, 0.5);

    expect(player.seekTo).toHaveBeenCalledWith(5);
  });

  it('starts another message from the tapped point once it loads', async () => {
    await playVoice(first);
    emit({});

    seekVoice(second, 0.4);
    await act(async () => undefined);

    expect(useVoicePlaybackStore.getState().activeKey).toBe('b');
    expect(useVoicePlaybackStore.getState().positionMs).toBe(2000);

    emit({ isLoaded: true, duration: 5 });

    expect(player.seekTo).toHaveBeenCalledWith(2);
  });

  it('returns to the start when the message finishes', async () => {
    await playVoice(first);
    emit({ didJustFinish: true, currentTime: 10 });

    expect(useVoicePlaybackStore.getState().activeKey).toBeNull();
  });

  it('marks a message whose file could not be loaded', async () => {
    (resolveVoiceUri as jest.Mock).mockRejectedValueOnce(new Error('offline'));

    await playVoice(first);

    expect(useVoicePlaybackStore.getState().failedKey).toBe('a');
    expect(player.play).not.toHaveBeenCalled();
  });

  it('stops playback when asked to', async () => {
    await playVoice(first);

    stopVoice();

    expect(player.pause).toHaveBeenCalled();
    expect(useVoicePlaybackStore.getState().activeKey).toBeNull();
  });
});
