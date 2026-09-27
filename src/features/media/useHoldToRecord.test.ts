import { act, renderHook } from '@testing-library/react-native';
import { Alert } from 'react-native';

import type { LocalMedia } from './types';
import {
  HOLD_HINT,
  INTERRUPTED_NOTICE,
  useHoldToRecord,
  type HoldRecorder,
} from './useHoldToRecord';
import type { StartResult } from './useVoiceRecorder';
import { stopVoice } from './voicePlayback';

jest.mock('./voicePlayback', () => ({ stopVoice: jest.fn() }));
jest.mock('./lib/recordingHaptics', () => ({
  recordingHaptics: {
    started: jest.fn(),
    locked: jest.fn(),
    cancelled: jest.fn(),
    sent: jest.fn(),
  },
}));
jest.mock('./lib/keepScreenOn', () => ({ keepScreenOn: jest.fn(() => jest.fn()) }));

const VOICE: LocalMedia = {
  kind: 'voice',
  uri: 'file:///cache/voice.m4a',
  mimeType: 'audio/mp4',
  width: null,
  height: null,
  durationMs: 4000,
  waveform: [1, 2, 3],
};

function makeRecorder(overrides: Partial<HoldRecorder> = {}): HoldRecorder {
  return {
    status: 'idle',
    durationMs: 0,
    level: null,
    recentLevels: [],
    start: jest.fn(async (): Promise<StartResult> => 'started'),
    stop: jest.fn(async () => VOICE),
    cancel: jest.fn(async () => undefined),
    ...overrides,
  };
}

async function renderHold(recorder: HoldRecorder, maxDurationMs = 300_000) {
  const onSend = jest.fn();
  const rendered = await renderHook(
    (props: { recorder: HoldRecorder }) =>
      useHoldToRecord({ recorder: props.recorder, maxDurationMs, onSend }),
    { initialProps: { recorder } },
  );

  return { ...rendered, onSend };
}

async function press(result: { current: ReturnType<typeof useHoldToRecord> }) {
  await act(async () => {
    result.current.pressIn();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('useHoldToRecord', () => {
  it('sends exactly one message after a normal hold and release', async () => {
    const recorder = makeRecorder();
    const { result, onSend } = await renderHold(recorder);

    await press(result);
    await act(async () => {
      result.current.release();
    });

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith(VOICE);
    expect(result.current.phase).toBe('idle');
  });

  it('sends nothing on a hold shorter than a message and shows the hint', async () => {
    // Рекордер сам отсеивает слишком короткое и отдаёт null.
    const recorder = makeRecorder({ stop: jest.fn(async () => null) });
    const { result, onSend } = await renderHold(recorder);

    await press(result);
    await act(async () => {
      result.current.release();
    });

    expect(onSend).not.toHaveBeenCalled();
    expect(result.current.notice).toBe(HOLD_HINT);
  });

  it('sends nothing when the finger slides left past the threshold', async () => {
    const recorder = makeRecorder();
    const { result, onSend } = await renderHold(recorder);

    await press(result);
    await act(async () => {
      result.current.slideCancel();
    });
    // Отпускание после отмены — не отправка.
    await act(async () => {
      result.current.release();
    });

    expect(recorder.cancel).toHaveBeenCalledTimes(1);
    expect(recorder.stop).not.toHaveBeenCalled();
    expect(onSend).not.toHaveBeenCalled();
  });

  it('keeps recording after a lift once the recording is locked', async () => {
    const recorder = makeRecorder();
    const { result, onSend } = await renderHold(recorder);

    await press(result);
    await act(async () => {
      result.current.lock();
    });
    await act(async () => {
      result.current.release();
    });

    expect(result.current.phase).toBe('locked');
    expect(onSend).not.toHaveBeenCalled();

    await act(async () => {
      result.current.sendLocked();
    });

    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('discards a locked recording on «Отмена»', async () => {
    const recorder = makeRecorder();
    const { result, onSend } = await renderHold(recorder);

    await press(result);
    await act(async () => {
      result.current.lock();
    });
    await act(async () => {
      result.current.cancelLocked();
    });

    expect(recorder.cancel).toHaveBeenCalled();
    expect(onSend).not.toHaveBeenCalled();
    expect(result.current.phase).toBe('idle');
  });

  it('finishes a release that came while the recorder was still starting', async () => {
    let resolveStart: (result: StartResult) => void = () => undefined;
    const recorder = makeRecorder({
      start: jest.fn(
        () =>
          new Promise<StartResult>((resolve) => {
            resolveStart = resolve;
          }),
      ),
    });
    const { result, onSend } = await renderHold(recorder);

    await press(result);
    await act(async () => {
      result.current.release();
    });

    expect(recorder.stop).not.toHaveBeenCalled();

    await act(async () => {
      resolveStart('started');
    });

    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('does not record on the press that asked for the microphone', async () => {
    const recorder = makeRecorder({ start: jest.fn(async () => 'needs-permission' as const) });
    const { result, onSend } = await renderHold(recorder);

    await press(result);
    await act(async () => {
      result.current.release();
    });

    expect(result.current.phase).toBe('idle');
    expect(recorder.stop).not.toHaveBeenCalled();
    expect(onSend).not.toHaveBeenCalled();
  });

  it('offers the settings when the microphone is refused for good', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const recorder = makeRecorder({ start: jest.fn(async () => 'blocked' as const) });
    const { result } = await renderHold(recorder);

    await press(result);

    expect(alert).toHaveBeenCalledWith(
      'Нет доступа к микрофону',
      expect.any(String),
      expect.arrayContaining([expect.objectContaining({ text: 'Открыть настройки' })]),
    );
  });

  it('stops a playing voice message before recording', async () => {
    const { result } = await renderHold(makeRecorder());

    await press(result);

    expect(stopVoice).toHaveBeenCalled();
  });

  it('discards the recording and says so when the system cancels the gesture', async () => {
    const recorder = makeRecorder();
    const { result, onSend } = await renderHold(recorder);

    await press(result);
    await act(async () => {
      result.current.systemCancel();
    });

    expect(recorder.cancel).toHaveBeenCalled();
    expect(onSend).not.toHaveBeenCalled();
    expect(result.current.notice).toBe(INTERRUPTED_NOTICE);
  });

  it('sends the recording by itself at the length limit', async () => {
    const recorder = makeRecorder();
    const { result, rerender, onSend } = await renderHold(recorder, 5000);

    await press(result);
    await act(async () => {
      await rerender({ recorder: { ...recorder, status: 'recording', durationMs: 5000 } });
    });

    expect(onSend).toHaveBeenCalledTimes(1);
  });
});
