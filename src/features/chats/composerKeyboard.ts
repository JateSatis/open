import { KeyboardController, useKeyboardHandler } from 'react-native-keyboard-controller';
import { makeMutable, useSharedValue, type SharedValue } from 'react-native-reanimated';

/**
 * Чьё поле ввода сейчас владеет клавиатурой: строки под чатом или строки
 * внутри шита выбора медиа.
 *
 * Клавиатура на экране одна, и её события глобальны: им всё равно, какой
 * `TextInput` в фокусе. Поэтому без явного владельца поле в шите поднимало
 * бы заодно и чат под шитом. Черновик у полей общий намеренно (см.
 * `useComposerDraft`), а клавиатура — нет: каждое двигает только себя.
 */
export type KeyboardOwner = 'chat' | 'sheet';

/** Живёт на UI-потоке: её читает каждый кадр анимации клавиатуры. */
const owner = makeMutable<KeyboardOwner>('chat');
/** Окно шита существует (фаза не `closed`). */
const sheetOpen = makeMutable(false);

/**
 * Касание поля в шите. Приходит раньше фокуса, а значит и раньше первого
 * кадра клавиатуры: чат не успевает сдвинуться ни на один кадр.
 */
export function claimKeyboardForSheet() {
  owner.value = 'sheet';
}

/** Касание поля под чатом возвращает ему клавиатуру безусловно. */
export function claimKeyboardForChat() {
  owner.value = 'chat';
}

/**
 * Шит открылся или закрылся. Закрытие возвращает клавиатуру чату, только
 * если она уже спрятана: если она ещё уезжает, чат подхватил бы остаток её
 * хода и дёрнулся. Тогда клавиатуру вернёт конец её анимации (см. ниже).
 */
export function setSheetKeyboardWindowOpen(open: boolean) {
  sheetOpen.value = open;

  if (!open && !KeyboardController.isVisible()) owner.value = 'chat';
}

/** Только для тестов. */
export function getKeyboardOwner(): KeyboardOwner {
  return owner.value;
}

/**
 * Высота клавиатуры для поля `who` — кадр в кадр с системной анимацией,
 * включая окно `Modal` на Android. Пока клавиатурой владеет другое поле,
 * значение не меняется.
 */
export function useOwnKeyboardHeight(who: KeyboardOwner): SharedValue<number> {
  const height = useSharedValue(0);

  useKeyboardHandler(
    {
      // `onStart` намеренно не слушается: в нём уже конечная высота, и поле
      // прыгнуло бы туда до анимации.
      onMove: (event) => {
        'worklet';
        if (owner.value === who) height.value = event.height;
      },
      onInteractive: (event) => {
        'worklet';
        if (owner.value === who) height.value = event.height;
      },
      onEnd: (event) => {
        'worklet';
        // Шит закрыт, и клавиатура, которую он открывал, доехала вниз —
        // она снова принадлежит чату.
        if (event.height === 0 && owner.value === 'sheet' && !sheetOpen.value) {
          owner.value = 'chat';
        }

        // Спрятанная клавиатура — ноль для всех полей, кто бы ей ни владел:
        // порядок обработчиков не должен оставить чьё-то поле поднятым.
        if (owner.value === who || event.height === 0) height.value = event.height;
      },
    },
    [who],
  );

  return height;
}
