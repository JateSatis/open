import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { useEffect } from 'react';
import { BackHandler, Text } from 'react-native';

import {
  SlidePage,
  SlidePageHeader,
  useSlideBack,
  useSlidePageBack,
  useSlidePageLeaveGuard,
  type SlideBack,
} from './index';

const mockBack = jest.fn();

jest.mock('expo-router', () => ({
  useIsFocused: () => true,
  useRouter: () => ({ back: mockBack, canGoBack: () => true }),
}));

let hardwareBack: ((event: never) => boolean | null | undefined) | null = null;

beforeEach(() => {
  mockBack.mockClear();
  hardwareBack = null;
  jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, handler) => {
    hardwareBack = handler;
    return { remove: () => undefined };
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

/** Страница последнего рендера — тест зовёт её `close`. */
const current: { slide: SlideBack | null } = { slide: null };

function Content({
  selecting,
  onClear,
  ask,
}: {
  selecting: boolean;
  onClear: () => void;
  ask?: () => Promise<boolean> | null;
}) {
  useSlidePageBack(selecting, onClear);
  useSlidePageLeaveGuard(ask ?? (() => null));

  return (
    <>
      <SlidePageHeader>
        <Text>Шапка</Text>
      </SlidePageHeader>
      <Text>Переписка</Text>
    </>
  );
}

function Page(props: {
  selecting: boolean;
  onClear: () => void;
  ask?: () => Promise<boolean> | null;
}) {
  const slide = useSlideBack();

  useEffect(() => {
    current.slide = slide;
  });

  return (
    <SlidePage slide={slide}>
      <Content {...props} />
    </SlidePage>
  );
}

const finishAnimations = () => act(async () => new Promise((resolve) => setTimeout(resolve, 400)));

describe('SlidePage', () => {
  it('shows the header given by its content on the page', async () => {
    await render(<Page selecting={false} onClear={jest.fn()} />);

    expect(screen.getByText('Шапка')).toBeTruthy();
    expect(screen.getByText('Переписка')).toBeTruthy();
  });

  it('leaves on system back with the slide-out animation', async () => {
    await render(<Page selecting={false} onClear={jest.fn()} />);

    await act(async () => {
      hardwareBack?.(undefined as never);
    });
    await finishAnimations();

    expect(mockBack).toHaveBeenCalled();
  });

  it('gives system back to the content while it takes it, and stays', async () => {
    const onClear = jest.fn();

    await render(<Page selecting onClear={onClear} />);

    await act(async () => {
      hardwareBack?.(undefined as never);
    });
    await finishAnimations();

    expect(onClear).toHaveBeenCalled();
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('asks before leaving and stays when the answer is no', async () => {
    let answer: (yes: boolean) => void = () => undefined;
    const ask = jest.fn(() => new Promise<boolean>((resolve) => (answer = resolve)));

    await render(<Page selecting={false} onClear={jest.fn()} ask={ask} />);

    await act(async () => current.slide?.close());
    await act(async () => answer(false));
    await finishAnimations();

    expect(ask).toHaveBeenCalled();
    expect(mockBack).not.toHaveBeenCalled();

    await act(async () => current.slide?.close());
    await act(async () => answer(true));
    await finishAnimations();

    expect(mockBack).toHaveBeenCalled();
  });

  it('header outside a page renders in place', async () => {
    await render(
      <SlidePageHeader>
        <Text onPress={jest.fn()}>Сама по себе</Text>
      </SlidePageHeader>,
    );

    fireEvent.press(screen.getByText('Сама по себе'));
    expect(screen.getByText('Сама по себе')).toBeTruthy();
  });
});
