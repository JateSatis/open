import { KeyboardController, useKeyboardHandler } from 'react-native-keyboard-controller';
import {
  makeMutable,
  useAnimatedReaction,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';

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
 * Панель эмодзи — на месте клавиатуры, под строкой ввода своего поля. Она
 * рисуется внутри панели ввода и сама занимает место, поэтому тем, кто
 * поднимает поле над клавиатурой, отдаётся клавиатура за вычетом панели:
 * клавиатура уходит, панель встаёт на её место — сумма та же, и переписка
 * не прыгает ни на кадр (см. `useOwnKeyboardHeight`).
 */
const panelOwner = makeMutable<KeyboardOwner | null>(null);
/** Высота панели сейчас, кадр в кадр с её анимацией. */
export const emojiPanelHeight = makeMutable(0);
/**
 * Полоса системной навигации под панелью: клавиатура меряется вместе с ней,
 * а панель рисуется над ней.
 */
const panelInset = makeMutable(0);
/** Полная высота клавиатуры в последний раз, когда она была на экране. */
const lastKeyboardHeight = makeMutable(0);

/** Панель эмодзи поля `who` встала (высоту ведёт `emojiPanelHeight`). */
export function attachEmojiPanel(who: KeyboardOwner, bottomInset: number) {
  panelOwner.value = who;
  panelInset.value = bottomInset;
}

/** Панели больше нет: клавиатура снова отдаётся как есть. */
export function detachEmojiPanel() {
  'worklet';
  panelOwner.value = null;
  emojiPanelHeight.value = 0;
}

/** Только для тестов и для решения, сколько занять панели. */
export function getEmojiPanelOwner(): KeyboardOwner | null {
  'worklet';
  return panelOwner.value;
}

/** Последняя полная высота клавиатуры; 0 — её ещё ни разу не было. */
export function getLastKeyboardHeight(): number {
  return lastKeyboardHeight.value;
}

/**
 * Высота клавиатуры для поля `who` — кадр в кадр с системной анимацией,
 * включая окно `Modal` на Android. Пока клавиатурой владеет другое поле,
 * значение не меняется. Открыта панель эмодзи этого поля — она занимает
 * место клавиатуры: отдаётся то, что сверх неё (полоса навигации под ней,
 * или клавиатура, пока та ещё выше панели).
 */
export function useOwnKeyboardHeight(who: KeyboardOwner): SharedValue<number> {
  /** Сама клавиатура этого поля. */
  const keyboard = useSharedValue(0);
  /** Что отдаётся поднимающим поле: клавиатура за вычетом панели эмодзи. */
  const height = useSharedValue(0);

  const settle = (value: number) => {
    'worklet';
    keyboard.value = value;
    height.value = withEmojiPanel(who, value);
  };

  useKeyboardHandler(
    {
      // `onStart` намеренно не слушается: в нём уже конечная высота, и поле
      // прыгнуло бы туда до анимации.
      onMove: (event) => {
        'worklet';
        if (owner.value === who) settle(event.height);
      },
      onInteractive: (event) => {
        'worklet';
        if (owner.value === who) settle(event.height);
      },
      onEnd: (event) => {
        'worklet';
        if (event.height > 0) lastKeyboardHeight.value = event.height;

        // Окно владельца закрыто, и клавиатура, которую оно открывало,
        // доехала вниз — она снова принадлежит нижнему полю.
        if (event.height === 0 && !windowOpen(owner.value)) owner.value = base.value;

        // Спрятанная клавиатура — ноль для всех полей, кто бы ей ни владел:
        // порядок обработчиков не должен оставить чьё-то поле поднятым.
        if (owner.value === who || event.height === 0) settle(event.height);
      },
    },
    [who],
  );

  // Панель выезжает, уезжает или встала у другого поля — пересчёт в тот же кадр.
  // Значения панели читаются здесь, а не во вложенной функции: зависимости
  // реакции Reanimated берёт из её собственного замыкания.
  useAnimatedReaction(
    () => {
      const panel = emojiPanelHeight.value;
      const inset = panelInset.value;

      if (panelOwner.value !== who) return keyboard.value;

      return Math.max(keyboard.value, panel + inset) - panel;
    },
    (value) => {
      height.value = value;
    },
    [who],
  );

  return height;
}

/** Клавиатура поля `who` с учётом его панели эмодзи (см. `useOwnKeyboardHeight`). */
function withEmojiPanel(who: KeyboardOwner, keyboard: number): number {
  'worklet';
  if (panelOwner.value !== who) return keyboard;

  const panel = emojiPanelHeight.value;

  return Math.max(keyboard, panel + panelInset.value) - panel;
}
