import { InteractionManager } from 'react-native';

import { bakePhoto, renderEditThumb } from './bake';
import { workingCopyOf } from './workingCopy';

import type { MediaLibraryItem } from '@/features/media/mediaLibrary';
import { setEditedThumb } from '@/features/media/photoEdits/editedThumbs';
import { photoEditOf, setPhotoEdit } from '@/features/media/photoEdits/editsStore';
import { isEmptyEdit, normalizeEdit, type PhotoEdit } from '@/features/media/photoEdits/types';
import { useMediaSelection } from '@/features/media/selectionStore';

/**
 * «Готово» любого инструмента: записать правку, сразу сделать картинку для
 * плитки (фото может улететь в неё уже через мгновение), запечь в фоне и
 * выбрать фото, если оно ещё не выбрано и лимит позволяет — правка это
 * намерение отправить.
 */
export function commitPhotoEdit(asset: MediaLibraryItem, input: PhotoEdit) {
  const edit = normalizeEdit(input);

  if (isEmptyEdit(edit)) {
    setPhotoEdit(asset.id, edit, null);
    return;
  }

  const baked = bakePhoto(asset.id, edit);

  setPhotoEdit(asset.id, edit, baked);

  // Рабочая копия к этому времени давно готова: инструмент рисовал её.
  void workingCopyOf(asset.id)
    .then(() => {
      // Пока готовилась копия, правку успели поменять — эта уже не нужна.
      if (photoEditOf(asset.id) !== edit) return;

      try {
        setEditedThumb(asset.id, renderEditThumb(asset.id, edit));
      } catch (error) {
        // Плитка покажет оригинал — отправку это не задевает.
        console.warn('[photo-edit] картинка для плитки не вышла', error);
      }

      // Запекание — после анимации смены панели: оно занимает JS-поток.
      InteractionManager.runAfterInteractions(() => {
        baked.prepare().catch(() => {
          // Отправка допечёт заново и при сбое упадёт с «повторить».
        });
      });
    })
    .catch(() => undefined);

  const selection = useMediaSelection.getState();

  if (!selection.order.includes(asset.id) && selection.order.length < selection.limit) {
    selection.toggle(asset);
  }
}
