import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { BackHandler, useWindowDimensions, type TextInput } from 'react-native';
import { KeyboardController, useKeyboardHandler } from 'react-native-keyboard-controller';
import { runOnJS, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  attachEmojiPanel,
  detachEmojiPanel,
  emojiPanelHeight,
  getEmojiPanelOwner,
  getLastKeyboardHeight,
  type KeyboardOwner,
} from '@/features/chats/composerKeyboard';
import { ComposerMotion, ComposerSizes } from '@/theme';

/**
 * - `off` — панели нет, поле как обычно;
 * - `emoji` — панель на месте клавиатуры, курсор в поле;
 * - `toKeyboard` — клавиатура возвращается; панель держит место, пока та не
 *   доедет, и уходит в тот же кадр.
 */
export type EmojiPanelMode = 'off' | 'emoji' | 'toKeyboard';

/**
 * Закрыть открытую панель эмодзи — для «назад» внутри `Modal`: там
 * системная кнопка приходит в `onRequestClose` окна, а не в `BackHandler`.
 * Отвечает, была ли панель: тогда окну закрываться не нужно.
 */
let closeOpen: (() => void) | null = null;

export function closeEmojiPanel(): boolean {
  if (!closeOpen) return false;

  closeOpen();

  return true;
}

export type EmojiPanelControl = {
  mode: EmojiPanelMode;
  /** Высота содержимого панели: раскладка сетки, пока высота самой панели анимируется. */
  size: number;
  /** Панель хоть раз открывалась: дальше она остаётся смонтированной и открывается сразу. */
  mounted: boolean;
  /** Кнопка в поле: эмодзи ↔ клавиатура. */
  toggle: () => void;
  /** Касание поля: при открытой панели — вернуть клавиатуру. */
  onFieldPressIn: () => void;
  close: () => void;
  /** Панель встала на экран — `EmojiPanel` зовёт при первой раскладке. */
  onPanelReady: () => void;
};

/**
 * Панель эмодзи вместо клавиатуры, как в Telegram. Клавиатура прячется с
 * курсором в поле (`dismiss({ keepFocus })`), панель встаёт на её место той же
 * высоты; обратно — клавиатура выезжает под панелью, и панель уходит, когда та
 * доехала. Место под панель отдаёт `composerKeyboard`: переписка, шит медиа и
 * панель комментариев не прыгают.
 */
export function useEmojiPanel(
  owner: KeyboardOwner,
  inputRef: RefObject<TextInput | null> | undefined,
): EmojiPanelControl {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const [mode, setMode] = useState<EmojiPanelMode>('off');
  const [size, setSize] = useState(0);
  const [mounted, setMounted] = useState(false);
  const waitingKeyboard = useSharedValue(false);
  /** Панель открыта и клавиатуру не звали: та, что всё же поднялась, — лишняя. */
  const panelShown = useSharedValue(false);
  /** Поле надо сфокусировать без клавиатуры, когда панель уже отрисована. */
  const focusAfterOpen = useRef(false);
  /** Показать клавиатуру, когда поле снова разрешило её (`showSoftInputOnFocus`). */
  const keyboardAfterRender = useRef(false);
  /**
   * Первое открытие при поднятой клавиатуре: панели ещё нет на экране, и
   * если убрать клавиатуру сразу, поле упало бы вниз и подпрыгнуло обратно.
   * Высота ждёт здесь, пока панель не встанет (`onPanelReady`).
   */
  const swapWhenReady = useRef<number | null>(null);

  const close = useCallback(() => {
    waitingKeyboard.set(false);
    setMode('off');
    emojiPanelHeight.value = withTiming(0, { duration: ComposerMotion.emojiPanelMs }, (done) => {
      if (done && getEmojiPanelOwner() === owner) detachEmojiPanel();
    });
    inputRef?.current?.blur();
  }, [inputRef, owner, waitingKeyboard]);

  const open = useCallback(() => {
    const visible = KeyboardController.isVisible();
    const keyboard = visible
      ? KeyboardController.state().height
      : getLastKeyboardHeight() || windowHeight * ComposerSizes.emojiPanelFallbackShare;
    const target = Math.max(keyboard - insets.bottom, ComposerSizes.emojiPanelMin);

    setSize(target);
    setMounted(true);
    attachEmojiPanel(owner, insets.bottom);
    waitingKeyboard.set(false);
    setMode('emoji');

    if (visible) {
      if (!mounted) {
        swapWhenReady.current = target;
        return;
      }

      // Панель сразу во всю высоту, клавиатура уезжает из-под неё.
      emojiPanelHeight.value = target;
      void KeyboardController.dismiss({ keepFocus: true });
      return;
    }

    emojiPanelHeight.value = withTiming(target, { duration: ComposerMotion.emojiPanelMs });
    focusAfterOpen.current = true;
  }, [insets.bottom, mounted, owner, waitingKeyboard, windowHeight]);

  const onPanelReady = useCallback(() => {
    const target = swapWhenReady.current;

    if (target === null) return;

    swapWhenReady.current = null;
    emojiPanelHeight.value = target;
    void KeyboardController.dismiss({ keepFocus: true });
  }, []);

  const showKeyboard = useCallback(() => {
    waitingKeyboard.set(true);
    keyboardAfterRender.current = true;
    setMode('toKeyboard');
  }, [waitingKeyboard]);

  const toggle = useCallback(() => {
    if (mode === 'emoji') showKeyboard();
    else open();
  }, [mode, open, showKeyboard]);

  const onFieldPressIn = useCallback(() => {
    if (mode === 'emoji') showKeyboard();
  }, [mode, showKeyboard]);

  // Поле уже не прячет клавиатуру (`showSoftInputOnFocus`) — теперь её можно
  // позвать. Обычный `focus()` уже сфокусированному полю её не покажет.
  useEffect(() => {
    if (mode === 'emoji' && focusAfterOpen.current) {
      focusAfterOpen.current = false;
      // Когда панель доехала: новое `showSoftInputOnFocus` к этому времени
      // точно дошло до нативного поля, и фокус клавиатуру не позовёт.
      const timer = setTimeout(() => inputRef?.current?.focus(), ComposerMotion.emojiPanelMs);

      return () => clearTimeout(timer);
    }

    if (mode !== 'toKeyboard' || !keyboardAfterRender.current) return;

    keyboardAfterRender.current = false;
    // Новое `showSoftInputOnFocus` доходит до нативного поля после коммита —
    // через кадр, иначе поле ещё прятало бы клавиатуру.
    const frame = requestAnimationFrame(() => KeyboardController.setFocusTo('current'));

    // Клавиатура не пришла (поле потеряло фокус) — панель не висит без дела.
    const timer = setTimeout(() => {
      if (waitingKeyboard.value && !KeyboardController.isVisible()) close();
    }, ComposerMotion.keyboardWaitMs);

    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [close, inputRef, mode, waitingKeyboard]);

  useEffect(() => {
    panelShown.set(mode === 'emoji');
  }, [mode, panelShown]);

  const hideStrayKeyboard = useCallback(() => {
    void KeyboardController.dismiss({ keepFocus: true });
  }, []);

  // Клавиатура доехала — панель уходит в тот же кадр: место под полем то же.
  // А поднявшаяся без спроса при открытой панели (фокус обогнал
  // `showSoftInputOnFocus`) — сразу убирается, курсор остаётся.
  useKeyboardHandler(
    {
      onStart: (event) => {
        'worklet';
        if (panelShown.value && !waitingKeyboard.value && event.height > 0) {
          runOnJS(hideStrayKeyboard)();
        }
      },
      onEnd: (event) => {
        'worklet';
        if (!waitingKeyboard.value || event.height === 0 || getEmojiPanelOwner() !== owner) return;

        waitingKeyboard.set(false);
        detachEmojiPanel();
        runOnJS(setMode)('off');
      },
    },
    [owner, hideStrayKeyboard],
  );

  // «Назад» закрывает панель, а не экран. В окне `Modal` — через `closeEmojiPanel`.
  useEffect(() => {
    if (mode !== 'emoji') return;

    closeOpen = close;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      close();
      return true;
    });

    return () => {
      subscription.remove();
      if (closeOpen === close) closeOpen = null;
    };
  }, [close, mode]);

  // Поле ушло с экрана вместе с панелью — место под ним больше не держится.
  useEffect(
    () => () => {
      if (getEmojiPanelOwner() === owner) detachEmojiPanel();
    },
    [owner],
  );

  return { mode, size, mounted, toggle, onFieldPressIn, close, onPanelReady };
}
