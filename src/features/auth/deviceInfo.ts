import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { Platform } from 'react-native';

import type { DeviceInfo } from '@/api/account';

import { getInstallationId } from './installationId';

/** «realme RMX3840», «iPhone 15» — то, по чему человек узнает свой телефон. */
function modelName(): string | null {
  const model = Device.modelName;

  if (!model) return Device.manufacturer ?? null;

  const maker = Device.manufacturer;

  if (!maker || Platform.OS === 'ios' || model.toLowerCase().startsWith(maker.toLowerCase())) {
    return model;
  }

  return `${maker} ${model}`;
}

function platform(): DeviceInfo['platform'] {
  if (Platform.OS === 'ios' || Platform.OS === 'android') return Platform.OS;

  return 'web';
}

export async function currentDeviceInfo(): Promise<DeviceInfo> {
  return {
    installationId: await getInstallationId(),
    platform: platform(),
    model: modelName(),
    osVersion: Device.osVersion ?? null,
    appVersion: Constants.expoConfig?.version ?? null,
  };
}
