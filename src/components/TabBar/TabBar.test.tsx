import { fireEvent, render, screen } from '@testing-library/react-native';

import { TabBar } from '.';

const mockNavigate = jest.fn();

jest.mock('@/navigation', () => ({
  useNavigation: () => ({navigate: mockNavigate}),
}));

beforeEach(() => jest.clearAllMocks());

describe('TabBar', () => {
  it('shows the tabs left to right: Лента, Чаты, Профиль', async () => {
    await render(<TabBar active="chats" />);

    expect(screen.getAllByRole('tab').map((tab) => tab.props.accessibilityLabel)).toEqual([
      'Лента',
      'Чаты',
      'Профиль',
    ]);
  });

  it('marks the tab of the screen as selected', async () => {
    await render(<TabBar active="chats" />);

    expect(screen.getByRole('tab', { name: 'Чаты' })).toBeSelected();
    expect(screen.getByRole('tab', { name: 'Лента' })).not.toBeSelected();
  });

  it('switches to another tab through the tabs navigator, keeping its stack', async () => {
    await render(<TabBar active="chats" />);

    await fireEvent.press(screen.getByRole('tab', { name: 'Лента' }));

    expect(mockNavigate).toHaveBeenCalledWith('feed');
  });

  it('does nothing on a tap at the tab already open', async () => {
    await render(<TabBar active="profile" />);

    await fireEvent.press(screen.getByRole('tab', { name: 'Профиль' }));

    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
