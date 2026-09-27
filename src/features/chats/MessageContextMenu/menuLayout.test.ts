import { computeMenuLayout, type MenuLayoutInput } from './menuLayout';

const screen = {
  windowHeight: 800,
  safeTop: 40,
  safeBottom: 20,
  margin: 8,
  gap: 8,
  accessoryHeight: 0,
};

function layout(input: Partial<MenuLayoutInput> & Pick<MenuLayoutInput, 'anchorTop' | 'anchorHeight'>) {
  return computeMenuLayout({ menuHeight: 200, ...screen, ...input });
}

describe('computeMenuLayout', () => {
  it('leaves the bubble where it is when the menu fits under it', () => {
    expect(layout({ anchorTop: 200, anchorHeight: 60 })).toMatchObject({
      bubbleTop: 200,
      bubbleHeight: 60,
      menuTop: 268,
    });
  });

  it('lifts a bubble at the bottom edge so the menu stays on screen', () => {
    const result = layout({ anchorTop: 700, anchorHeight: 60 });

    // Низ меню — ровно у края безопасной зоны.
    expect(result.menuTop + 200).toBe(800 - 20 - 8);
    expect(result.bubbleTop).toBe(result.menuTop - 8 - 60);
  });

  it('pushes a bubble half hidden under the top edge down into view', () => {
    expect(layout({ anchorTop: -30, anchorHeight: 60 }).bubbleTop).toBe(40 + 8);
  });

  it('cuts a bubble taller than the room left by the menu', () => {
    const result = layout({ anchorTop: 0, anchorHeight: 2000 });

    expect(result.bubbleTop).toBe(48);
    expect(result.bubbleHeight).toBe(800 - 20 - 8 - 48 - 8 - 200);
    expect(result.menuTop + 200).toBe(772);
  });

  it('keeps room above the bubble for a block that will sit there (reactions)', () => {
    const result = layout({ anchorTop: 0, anchorHeight: 60, accessoryHeight: 44 });

    expect(result.accessoryTop).toBe(48);
    expect(result.bubbleTop).toBe(48 + 44 + 8);
  });
});
