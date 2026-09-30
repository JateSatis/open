import { KeyboardController, useKeyboardHandler } from 'react-native-keyboard-controller';
import { makeMutable, useSharedValue, type SharedValue } from 'react-native-reanimated';

/**
 * Чьё поле ввода сейчас владеет клавиатурой: строки под чатом, строки
 * внутри шита выбора медиа или строки панели комментариев.
 *
 * Клавиатура на экране одна, и её события глобальны: им всё равно, какой
 * `TextInput` в фокусе. Поэтому без явного владельца поле в шите поднимало
 * бы заодно и чат под шитом. Черновик у полей чата и шита общий намеренно
 * (см. `useComposerDraft`), а клавиатура — нет: каждое двигает только себя.
 */
export type KeyboardOwner = 'chat' | 'sheet' | 'comments';

/** Живёт на UI-потоке: её читает каждый кадр анимации клавиатуры. */
const owner = makeMutable<KeyboardOwner>('chat');
/** Окно шита существует (фаза не `closed`). */
const sheetOpen = makeMutable(false);
/**
 * Чьё поле лежит под шитом: чат или открытая над ним панель комментариев.
 * Ему клавиатура и возвращается, когда шит закрыт.
 */
const base = makeMutable<'chat' | 'comments'>('chat');

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

/** Касание поля панели комментариев: переписка под панелью стоит на месте. */
export function claimKeyboardForComments() {
  owner.value = 'comments';
}

/**
 * Окно владельца ещё на экране: у чата оно есть всегда, у шита и панели —
 * пока они открыты.
 */
function windowOpen(who: KeyboardOwner): boolean {
  'worklet';
  if (who === 'sheet') return sheetOpen.value;
  if (who === 'comments') return base.value === 'comments';

  return true;
}

/**
 * Окно закрылось. Клавиатура возвращается нижнему полю, только если она уже
 * спрятана: если она ещё уезжает, нижнее поле подхватило бы остаток её хода
 * и дёрнулось. Тогда клавиатуру вернёт конец её анимации (см. ниже).
 */
function releaseIfHidden() {
  if (!windowOpen(owner.value) && !KeyboardController.isVisible()) owner.value = base.value;
}

/** Шит открылся или закрылся. */
export function setSheetKeyboardWindowOpen(open: boolean) {
  sheetOpen.value = open;
  releaseIfHidden();
}

/** Панель комментариев открылась или закрылась. */
export function setCommentsKeyboardWindowOpen(open: boolean) {
  base.value = open ? 'comments' : 'chat';
  releaseIfHidden();
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
        // Окно владельца закрыто, и клавиатура, которую оно открывало,
        // доехала вниз — она снова принадлежит нижнему полю.
        if (event.height === 0 && !windowOpen(owner.value)) owner.value = base.value;

        // Спрятанная клавиатура — ноль для всех полей, кто бы ей ни владел:
        // порядок обработчиков не должен оставить чьё-то поле поднятым.
        if (owner.value === who || event.height === 0) height.value = event.height;
      },
    },
    [who],
  );

  return height;
}
