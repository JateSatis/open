import * as ImagePicker from 'expo-image-picker';

import { prepareAvatar, type PreparedAvatar } from './lib/prepareAvatar';

export type AvatarSource = 'library' | 'camera';

export type PickAvatarResult =
  | { status: 'picked'; avatar: PreparedAvatar }
  | { status: 'cancelled' }
  /** Доступ к галерее или камере не дан — объяснить и отправить в настройки. */
  | { status: 'denied' };

const PICKER_OPTIONS: ImagePicker.ImagePickerOptions = {
  mediaTypes: ['images'],
  // Системный редактор с рамкой-квадратом: человек сам выбирает, что попадёт
  // в круг. На iOS квадрат — единственный вариант, на Android его задаёт aspect.
  allowsEditing: true,
  aspect: [1, 1],
  quality: 1,
};

/** Фото для аватара из галереи или с камеры — уже квадратное и сжатое. */
export async function pickAvatar(source: AvatarSource): Promise<PickAvatarResult> {
  const permission =
    source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();

  if (!permission.granted) return { status: 'denied' };

  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync(PICKER_OPTIONS)
      : await ImagePicker.launchImageLibraryAsync(PICKER_OPTIONS);

  if (result.canceled || result.assets.length === 0) return { status: 'cancelled' };

  const asset = result.assets[0];

  return { status: 'picked', avatar: await prepareAvatar(asset.uri, asset.width, asset.height) };
}
