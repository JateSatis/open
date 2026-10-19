import type { Text } from 'react-native';

import {
  beginHandleDrag,
  beginTextSelection,
  endSelectionDrag,
  moveSelectionDrag,
} from './fragmentSelection';
import { exitFragmentMode, getFragmentState, toggleFragmentMode } from './fragmentStore';
import { registerSelectableText } from './selectableTexts';
import { edgeSpeed, registerSelectionScroller, scrollRoom } from './selectionAutoScroll';

import type { TextGeometry } from '../../../../modules/text-geometry';

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  selectionAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light' },
}));

let measured: (geometry: TextGeometry) => void = () => undefined;

jest.mock('../../../../modules/text-geometry', () => ({
  measureText: () => new Promise((resolve) => (measured = resolve)),
}));

// Три строки по 20 dp, символ — 10 dp. Текст стоит в окне с угла (100, 500).
const text = 'one two three\nfour five six\nseven eight';
const lineOf = (start: number, end: number, top: number) => ({
  start,
  end,
  top,
  bottom: top + 20,
  baseline: top + 15,
  left: 0,
  right: (end - start) * 10,
});
const geometry: TextGeometry = {
  text,
  width: 200,
  height: 60,
  lines: [lineOf(0, 14, 0), lineOf(14, 28, 20), lineOf(28, 39, 40)],
  xs: [...text].map((_, i) => (i < 14 ? i * 10 : i < 28 ? (i - 14) * 10 : (i - 28) * 10)),
};
const ORIGIN = { x: 100, y: 500 };

/** Точка в окне над символом текста. */
const over = (offset: number) => {
  const line = geometry.lines.find((l) => offset < l.end) ?? geometry.lines[2];

  return { x: ORIGIN.x + geometry.xs[offset] + 5, y: ORIGIN.y + line.top + 10 };
};

const selected = () => {
  const { selection } = getFragmentState();

  return selection ? text.slice(selection.start, selection.end) : null;
};

beforeEach(() => {
  exitFragmentMode();
  toggleFragmentMode('row-1');
  registerSelectableText('row-1', {
    ref: {
      current: {
        measureInWindow: (cb: (x: number, y: number) => void) => cb(ORIGIN.x, ORIGIN.y),
      } as unknown as Text,
    },
    text,
    messageId: 'm-1',
    chatId: 'chat-1',
    amMember: false,
  });
});

afterEach(() => {
  endSelectionDrag('words');
  endSelectionDrag('handle');
});

async function longPress(offset: number) {
  const point = over(offset);
  const started = beginTextSelection('row-1', { ...point, localX: 0, localY: 0 });

  return { started, resolve: () => measured(geometry) };
}

describe('dragging a selection by words', () => {
  it('selects the word under the finger and grows by whole words while it moves', async () => {
    const { started, resolve } = await longPress(text.indexOf('two') + 1);

    resolve();
    await expect(started).resolves.toBe(true);
    expect(selected()).toBe('two');
    expect(getFragmentState().selection?.dragging).toBe('words');

    const to = over(text.indexOf('five') + 2);

    moveSelectionDrag(to.x, to.y);
    expect(selected()).toBe('two three\nfour five');

    endSelectionDrag('words');
    expect(getFragmentState().selection?.dragging).toBeNull();
    expect(selected()).toBe('two three\nfour five');
  });

  it('turns back over the anchor word, keeping it inside', async () => {
    const { started, resolve } = await longPress(text.indexOf('five'));

    resolve();
    await started;

    const back = over(text.indexOf('two'));

    moveSelectionDrag(back.x, back.y);
    expect(selected()).toBe('two three\nfour five');
  });

  it('applies a move that came before the text was measured', async () => {
    const { started, resolve } = await longPress(text.indexOf('one'));
    const to = over(text.indexOf('six'));

    moveSelectionDrag(to.x, to.y);
    resolve();
    await started;

    expect(selected()).toBe('one two three\nfour five six');
  });

  it('runs to the start or the end of the text past its first or last line', async () => {
    const { started, resolve } = await longPress(text.indexOf('five'));

    resolve();
    await started;

    moveSelectionDrag(ORIGIN.x + 50, ORIGIN.y + 400);
    expect(selected()).toBe('five six\nseven eight');

    moveSelectionDrag(ORIGIN.x + 50, ORIGIN.y - 400);
    expect(selected()).toBe('one two three\nfour five');
  });

  it('finishes with the menu back when the finger lifts before the text is measured', async () => {
    const { started, resolve } = await longPress(text.indexOf('two'));

    endSelectionDrag('words');
    resolve();
    await started;

    expect(selected()).toBe('two');
    expect(getFragmentState().selection?.dragging).toBeNull();
  });

  it('is not ended by the long press giving way to a handle', async () => {
    const { started, resolve } = await longPress(text.indexOf('two'));

    resolve();
    await started;
    endSelectionDrag('words');

    beginHandleDrag('row-1', 'end', 0);
    endSelectionDrag('words');
    expect(getFragmentState().selection?.dragging).toBe('end');

    const to = over(text.indexOf('three') + 2);

    moveSelectionDrag(to.x - 5, to.y);
    // Ручка — посимвольно, по ближайшей границе.
    expect(selected()).toBe('two th');

    endSelectionDrag('handle');
    expect(getFragmentState().selection?.dragging).toBeNull();
  });
});

describe('auto scroll while dragging', () => {
  let frames: FrameRequestCallback[] = [];
  let now = 0;

  beforeEach(() => {
    frames = [];
    now = 0;
    jest.spyOn(global, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    jest.spyOn(global, 'cancelAnimationFrame').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  function runFrames(count: number) {
    for (let i = 0; i < count; i++) {
      const next = frames.shift();

      now += 16;
      next?.(now);
    }
  }

  it('scrolls the conversation at the top edge and keeps growing over the text that comes in', async () => {
    const scrolled: number[] = [];

    const unregister = registerSelectionScroller({
      // Текст выше видимой части: его начало за верхним краем списка.
      measure: () => Promise.resolve({ top: 530, bottom: 1500 }),
      scrollBy: (delta) => {
        scrolled.push(delta);
        return delta;
      },
    });
    const { started, resolve } = await longPress(text.indexOf('eight'));

    resolve();
    await started;
    await Promise.resolve();

    moveSelectionDrag(ORIGIN.x + 50, 540);
    runFrames(30);

    expect(scrolled.length).toBeGreaterThan(0);
    expect(scrolled.every((delta) => delta > 0)).toBe(true);
    // Текст съехал вниз на прокрученное — палец над первой строкой.
    expect(getFragmentState().selection?.textInWindow.y).toBeGreaterThan(ORIGIN.y);
    expect(selected()).toBe('one two three\nfour five six\nseven eight');

    unregister();
  });

  it('stops when the finger leaves the edge', async () => {
    const scrollBy = jest.fn((delta: number) => delta);
    const unregister = registerSelectionScroller({
      measure: () => Promise.resolve({ top: 0, bottom: 2000 }),
      scrollBy,
    });
    const { started, resolve } = await longPress(text.indexOf('five'));

    resolve();
    await started;
    await Promise.resolve();

    const middle = over(text.indexOf('six'));

    moveSelectionDrag(middle.x, middle.y);
    runFrames(10);

    expect(scrollBy).not.toHaveBeenCalled();

    unregister();
  });
});

describe('edge speed', () => {
  const frame = { top: 100, bottom: 900 };

  it('is zero in the middle and grows towards either edge', () => {
    expect(edgeSpeed(500, frame)).toBe(0);
    expect(edgeSpeed(150, frame)).toBeGreaterThan(0);
    expect(edgeSpeed(110, frame)).toBeGreaterThan(edgeSpeed(150, frame));
    expect(edgeSpeed(850, frame)).toBeLessThan(0);
    expect(edgeSpeed(1200, frame)).toBe(edgeSpeed(900, frame));
  });

  it('leaves no room once the text edge is in view', () => {
    expect(scrollRoom(1, { top: 300, bottom: 600 }, frame)).toBe(0);
    expect(scrollRoom(1, { top: -400, bottom: 600 }, frame)).toBeGreaterThan(0);
    expect(scrollRoom(-1, { top: 300, bottom: 1400 }, frame)).toBeLessThan(0);
  });
});
