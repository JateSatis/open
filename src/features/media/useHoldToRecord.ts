import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Linking } from 'react-native';

import { recordingHaptics } from './lib/recordingHaptics';
import { keepScreenOn } from './lib/keepScreenOn';
import type { LocalMedia } from './types';
import type { StartResult, VoiceRecorder } from './useVoiceRecorder';
import { stopVoice } from './voicePlayback';

/**
 * `holding` — палец на кнопке, идёт запись (или она вот-вот начнётся);
 * `locked` — запись закреплена свайпом вверх, палец свободен;
 * `finishing` — запись останавливается и собирается в сообщение.
 */
export type HoldPhase = 'idle' | 'holding' | 'locked' | 'finishing';

/**
 * Что умеет рекордер под кнопкой. Голосовое сегодня, кружок завтра: жест и
 * полоса записи одни и те же, меняется только то, что пишет.
 */
export type HoldRecorder = Pick<
  VoiceRecorder,
  'start' | 'stop' | 'cancel' | 'durationMs' | 'level' | 'recentLevels' | 'status'
>;

export const HOLD_HINT = 'Удерживайте, чтобы записать голосовое';
export const INTERRUPTED_NOTICE = 'Запись прервана';
const START_FAILED_NOTICE = 'Не удалось начать запись';

/** Сколько висит подсказка под кнопкой. */
const NOTICE_MS = 2500;

export type HoldToRecordOptions = {
  recorder: HoldRecorder;
  /** Предел записи: на нём запись отправляется сама, а не выбрасывается. */
  maxDurationMs: number;
  onSend: (media: LocalMedia) => void;
  /**
   * Касание короче минимальной записи. По умолчанию — подсказка «удерживайте».
   * Переключатель «голос / кружок» по тапу ляжет сюда же, не трогая жест.
   */
  onShortTap?: () => void;
  /** Идёт запись — для «записывает голосовое…» у собеседников. Зовётся часто. */
  onActivity?: () => void;
};

export type HoldToRecord = {
  phase: HoldPhase;
  durationMs: number;
  level: number | null;
  recentLevels: number[];
  /** Короткое сообщение под кнопкой: подсказка или «запись прервана». */
  notice: string | null;
  /** Палец коснулся кнопки. */
  pressIn: () => void;
  /** Палец отпущен, не уйдя за порог отмены или замка. */
  release: () => void;
  /** Палец ушёл влево за порог. */
  slideCancel: () => void;
  /** Палец ушёл вверх за порог — запись закреплена. */
  lock: () => void;
  /** Кнопка «отправить» закреплённой записи. */
  sendLocked: () => void;
  /** Кнопка «Отмена» закреплённой записи. */
  cancelLocked: () => void;
  /** Система отобрала жест (звонок, шторка, другой жест). */
  systemCancel: () => void;
  /** Рекордер сам оборвал запись — подключается к `useVoiceRecorder`. */
  interrupted: () => void;
};

function offerSettings() {
  Alert.alert(
    'Нет доступа к микрофону',
    'Чтобы записывать голосовые, разрешите Open доступ к микрофону в настройках телефона.',
    [
      { text: 'Не сейчас', style: 'cancel' },
      { text: 'Открыть настройки', onPress: () => void Linking.openSettings() },
    ],
  );
}

/**
 * Жест «удерживай — говори — отпусти», без привязки к разметке: кнопка и
 * полоса записи только зовут эти действия и рисуют `phase`.
 *
 * Жест приходит раньше, чем рекордер успевает стартовать (на iOS подготовка
 * занимает заметное время), поэтому отпускание или отмена во время старта
 * запоминаются и выполняются, как только запись действительно пошла.
 */
export function useHoldToRecord({
  recorder,
  maxDurationMs,
  onSend,
  onShortTap,
  onActivity,
}: HoldToRecordOptions): HoldToRecord {
  const [phase, setPhaseState] = useState<HoldPhase>('idle');
  const [notice, setNotice] = useState<string | null>(null);
  const phaseRef = useRef<HoldPhase>('idle');
  const startingRef = useRef<Promise<StartResult> | null>(null);
  const pendingRef = useRef<'release' | 'cancel' | 'interrupt' | null>(null);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbacksRef = useRef({ onSend, onShortTap, onActivity });

  useEffect(() => {
    callbacksRef.current = { onSend, onShortTap, onActivity };
  }, [onSend, onShortTap, onActivity]);

  const setPhase = useCallback((next: HoldPhase) => {
    phaseRef.current = next;
    setPhaseState(next);
  }, []);

  const showNotice = useCallback((text: string) => {
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);

    setNotice(text);
    noticeTimerRef.current = setTimeout(() => setNotice(null), NOTICE_MS);
  }, []);

  useEffect(
    () => () => {
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    },
    [],
  );

  const shortTap = useCallback(() => {
    if (callbacksRef.current.onShortTap) {
      callbacksRef.current.onShortTap();
      return;
    }

    showNotice(HOLD_HINT);
  }, [showNotice]);

  const finishAndSend = useCallback(async () => {
    setPhase('finishing');

    try {
      const media = await recorder.stop();

      if (media) {
        recordingHaptics.sent();
        callbacksRef.current.onSend(media);
      } else {
        shortTap();
      }
    } finally {
      setPhase('idle');
    }
  }, [recorder, setPhase, shortTap]);

  const discard = useCallback(
    async (reason: 'cancel' | 'interrupt') => {
      setPhase('finishing');

      try {
        await recorder.cancel();
      } finally {
        setPhase('idle');
      }

      if (reason === 'cancel') {
        recordingHaptics.cancelled();
      } else {
        showNotice(INTERRUPTED_NOTICE);
      }
    },
    [recorder, setPhase, showNotice],
  );

  const pressIn = useCallback(() => {
    if (phaseRef.current !== 'idle') return;

    pendingRef.current = null;
    setNotice(null);
    // Своё голосовое не пишется поверх чужого: играющее замолкает.
    stopVoice();
    setPhase('holding');

    const starting = recorder.start();

    startingRef.current = starting;

    void starting.then((result) => {
      startingRef.current = null;

      if (result !== 'started') {
        setPhase('idle');

        if (result === 'blocked') offerSettings();
        if (result === 'failed') showNotice(START_FAILED_NOTICE);

        return;
      }

      recordingHaptics.started();

      const pending = pendingRef.current;

      pendingRef.current = null;

      if (pending === 'release') void finishAndSend();
      if (pending === 'cancel') void discard('cancel');
      if (pending === 'interrupt') void discard('interrupt');
    });
  }, [discard, finishAndSend, recorder, setPhase, showNotice]);

  const release = useCallback(() => {
    if (phaseRef.current !== 'holding') return;

    if (startingRef.current) {
      pendingRef.current = 'release';
      return;
    }

    void finishAndSend();
  }, [finishAndSend]);

  const slideCancel = useCallback(() => {
    if (phaseRef.current !== 'holding') return;

    if (startingRef.current) {
      pendingRef.current = 'cancel';
      return;
    }

    void discard('cancel');
  }, [discard]);

  const systemCancel = useCallback(() => {
    if (phaseRef.current !== 'holding') return;

    if (startingRef.current) {
      pendingRef.current = 'interrupt';
      return;
    }

    void discard('interrupt');
  }, [discard]);

  const lock = useCallback(() => {
    if (phaseRef.current !== 'holding') return;

    // Запись ещё стартует — замок всё равно ставится: палец уже ушёл вверх,
    // и отпускание после этого не должно её отправить.
    recordingHaptics.locked();
    setPhase('locked');
  }, [setPhase]);

  const sendLocked = useCallback(() => {
    if (phaseRef.current !== 'locked') return;

    if (startingRef.current) {
      pendingRef.current = 'release';
      return;
    }

    void finishAndSend();
  }, [finishAndSend]);

  const cancelLocked = useCallback(() => {
    if (phaseRef.current !== 'locked') return;

    if (startingRef.current) {
      pendingRef.current = 'cancel';
      return;
    }

    void discard('cancel');
  }, [discard]);

  const interrupted = useCallback(() => {
    // Рекордер уже всё выбросил сам: здесь только вернуть кнопку и сказать.
    if (phaseRef.current === 'idle') return;

    setPhase('idle');
    showNotice(INTERRUPTED_NOTICE);
  }, [setPhase, showNotice]);

  const recording = recorder.status === 'recording';
  const reachedLimit = recording && recorder.durationMs >= maxDurationMs;

  // На пределе длительности запись уходит сама: пять минут речи не должны
  // пропасть из-за того, что палец держал кнопку чуть дольше.
  useEffect(() => {
    const active = phaseRef.current === 'holding' || phaseRef.current === 'locked';

    if (reachedLimit && active && !startingRef.current) void finishAndSend();
  }, [reachedLimit, finishAndSend]);

  useEffect(() => {
    if (recording) callbacksRef.current.onActivity?.();
  }, [recording, recorder.durationMs]);

  // Экран не гаснет посреди длинного голосового.
  useEffect(() => {
    if (!recording) return;

    return keepScreenOn();
  }, [recording]);

  return {
    phase,
    durationMs: recording ? recorder.durationMs : 0,
    level: recording ? recorder.level : null,
    recentLevels: recorder.recentLevels,
    notice,
    pressIn,
    release,
    slideCancel,
    lock,
    sendLocked,
    cancelLocked,
    systemCancel,
    interrupted,
  };
}
