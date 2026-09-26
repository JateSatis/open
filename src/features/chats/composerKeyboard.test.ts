import { renderHook } from '@testing-library/react-native';
import { KeyboardController, useKeyboardHandler } from 'react-native-keyboard-controller';

import {
  claimKeyboardForChat,
  claimKeyboardForSheet,
  getKeyboardOwner,
  setSheetKeyboardWindowOpen,
  useOwnKeyboardHeight,
} from './composerKeyboard';

type Handlers = Parameters<typeof useKeyboardHandler>[0];
type KeyboardEvent = Parameters<NonNullable<Handlers['onMove']>>[0];

const mockedHandler = useKeyboardHandler as jest.Mock;
const mockedIsVisible = KeyboardController.isVisible as jest.Mock;

/** Все подписанные поля получают одно и то же событие — как от системы. */
let handlers: Handlers[] = [];

function keyboard(phase: 'onMove' | 'onEnd', height: number) {
  const event = { height, progress: height > 0 ? 1 : 0, duration: 250, target: 1 } as KeyboardEvent;

  for (const handler of handlers) handler[phase]?.(event);
}

beforeEach(() => {
  handlers = [];
  mockedHandler.mockImplementation((handler: Handlers) => handlers.push(handler));
  mockedIsVisible.mockReturnValue(false);
  claimKeyboardForChat();
  setSheetKeyboardWindowOpen(false);
});

async function renderBoth() {
  const chat = await renderHook(() => useOwnKeyboardHeight('chat'));
  const sheet = await renderHook(() => useOwnKeyboardHeight('sheet'));

  return { chat: chat.result.current, sheet: sheet.result.current };
}

describe('composer keyboard ownership', () => {
  it('moves the chat composer with the keyboard in a plain chat', async () => {
    const { chat, sheet } = await renderBoth();

    keyboard('onMove', 120);
    keyboard('onEnd', 300);

    expect(chat.value).toBe(300);
    expect(sheet.value).toBe(0);
  });

  it('keeps the chat still while the sheet field owns the keyboard', async () => {
    const { chat, sheet } = await renderBoth();

    setSheetKeyboardWindowOpen(true);
    claimKeyboardForSheet();
    keyboard('onMove', 150);
    keyboard('onEnd', 300);

    expect(sheet.value).toBe(300);
    expect(chat.value).toBe(0);
  });

  it('gives the keyboard back to the chat only once the sheet is gone and the keyboard is down', async () => {
    const { chat, sheet } = await renderBoth();

    setSheetKeyboardWindowOpen(true);
    claimKeyboardForSheet();
    keyboard('onEnd', 300);

    // Шит закрылся, а клавиатура ещё уезжает — её остаток чату не достаётся.
    mockedIsVisible.mockReturnValue(true);
    setSheetKeyboardWindowOpen(false);
    keyboard('onMove', 100);

    expect(getKeyboardOwner()).toBe('sheet');
    expect(chat.value).toBe(0);

    keyboard('onEnd', 0);

    expect(getKeyboardOwner()).toBe('chat');
    expect(sheet.value).toBe(0);

    keyboard('onEnd', 280);

    expect(chat.value).toBe(280);
  });

  it('returns the keyboard right away when the sheet closes with the keyboard already hidden', async () => {
    setSheetKeyboardWindowOpen(true);
    claimKeyboardForSheet();

    setSheetKeyboardWindowOpen(false);

    expect(getKeyboardOwner()).toBe('chat');
  });
});
