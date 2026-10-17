// Устройство для журнала: звук, сеть, ориентация, часовой пояс. Читается
// один раз и держится свежим подписками — показ берёт готовое значение, а не
// ждёт нативного вызова.

import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Network from 'expo-network';
import { Dimensions, Platform } from 'react-native';

import {
  addAudioOutputListener,
  getAudioOutputState,
  type AudioOutputState,
} from '../../../../modules/audio-output';

import type { JournalData } from '@/api/recJournal';

let audio: AudioOutputState | null = null;
let network = 'unknown';
let started = false;
const audioListeners = new Set<(state: AudioOutputState) => void>();

function networkName(type: Network.NetworkStateType | undefined): string {
  switch (type) {
    case Network.NetworkStateType.WIFI:
      return 'wifi';
    case Network.NetworkStateType.CELLULAR:
      return 'cellular';
    case Network.NetworkStateType.ETHERNET:
      return 'ethernet';
    case Network.NetworkStateType.NONE:
      return 'none';
    case Network.NetworkStateType.VPN:
      return 'vpn';
    default:
      return 'unknown';
  }
}

/** Подписаться на звук и сеть — один раз на процесс. */
export function startDeviceWatch(): void {
  if (started) return;

  started = true;
  audio = getAudioOutputState();
  addAudioOutputListener((next) => {
    audio = next;
    audioListeners.forEach((listener) => listener(next));
  });
  Network.addNetworkStateListener(({ type }) => {
    network = networkName(type);
  });
  void Network.getNetworkStateAsync()
    .then(({ type }) => {
      network = networkName(type);
    })
    .catch(() => undefined);
}

export function currentAudio(): AudioOutputState | null {
  return audio;
}

/** Звук поменялся — пока показ идёт, он узнаёт об этом сразу. */
export function onAudioChange(listener: (state: AudioOutputState) => void): () => void {
  audioListeners.add(listener);

  return () => audioListeners.delete(listener);
}

export function currentNetwork(): string {
  return network;
}

export function currentOrientation(): 'portrait' | 'landscape' {
  const { width, height } = Dimensions.get('window');

  return width > height ? 'landscape' : 'portrait';
}

/** Что известно об устройстве в начале сессии приложения. */
export function deviceContext(): JournalData {
  let timeZone: string | undefined;

  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    timeZone = undefined;
  }

  const date = new Date();

  return {
    platform: Platform.OS,
    os_version: String(Platform.Version),
    model: Device.modelName ?? undefined,
    app_version: Constants.expoConfig?.version ?? undefined,
    tz: timeZone,
    tz_offset_min: -date.getTimezoneOffset(),
    local_hour: date.getHours(),
    network,
    orientation: currentOrientation(),
    volume: audio?.volume,
    muted: audio?.muted,
    route: audio?.route,
  };
}
