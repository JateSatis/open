import { act, render, screen } from '@testing-library/react-native';

import { PersonalDataHint } from './index';

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

const text = 'моя школа 57 у дома';

describe('PersonalDataHint', () => {
  it('warns after a typing pause that the school is visible to everyone', async () => {
    await render(<PersonalDataHint text={text} />);

    await act(async () => jest.advanceTimersByTime(500));

    expect(screen.getByText('Школа или класс — это увидят все, кто откроет чат')).toBeTruthy();
  });

  it('stays silent about what the author already hid from viewers', async () => {
    await render(<PersonalDataHint text={text} hidden={[{ start: 4, end: 12 }]} />);

    await act(async () => jest.advanceTimersByTime(500));

    expect(screen.queryByTestId('personal-data-hint')).toBeNull();
  });
});
