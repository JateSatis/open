import { computeMenuLayout, type MenuLayoutInput } from './menuLayout';

const screen = {
  windowHeight: 800,
  safeTop: 40,
  safeBottom: 20,
  margin: 8,
  gap: 8,
  touchOffset: 24,
  menuHeight: 200,
  accessoryHeight: 56,
};

function layout(input: Partial<MenuLayoutInput> & Pick<MenuLayoutInput, 'touchY'>) {
  return computeMenuLayout({ ...screen, ...input });
}

describe('computeMenuLayout', () => {
  it('puts the menu under the finger and the reactions right above it', () => {
    const result = layout({ touchY: 400 });

    expect(result.menuTop).toBe(400 - 24);
    expect(result.accessoryTop).toBe(result.menuTop - 8 - 56);
  });

  it('follows the finger, not the bubble: a lower tap — a lower menu', () => {
    expect(layout({ touchY: 450 }).menuTop - layout({ touchY: 350 }).menuTop).toBe(100);
  });

  it('moves the pair down just enough when the reactions would go under the status bar', () => {
    const result = layout({ touchY: 60 });

    expect(result.accessoryTop).toBe(40 + 8);
    expect(result.menuTop).toBe(40 + 8 + 56 + 8);
  });

  it('moves the pair up just enough when the menu would go under the navigation bar', () => {
    const result = layout({ touchY: 760 });

    expect(result.menuTop + 200).toBe(800 - 20 - 8);
    // Реакции по-прежнему над меню.
    expect(result.accessoryTop).toBe(result.menuTop - 8 - 56);
  });

  it('without reactions it places the menu alone', () => {
    const result = layout({ touchY: 400, accessoryHeight: 0 });

    expect(result.menuTop).toBe(376);
    expect(result.accessoryTop).toBe(376);
  });

  it('without reactions the menu may start right below the top margin', () => {
    expect(layout({ touchY: 30, accessoryHeight: 0 }).menuTop).toBe(48);
  });

  it('keeps the top of a pair taller than the screen in view', () => {
    const result = layout({ touchY: 400, menuHeight: 2000 });

    expect(result.accessoryTop).toBe(48);
  });
});
