import { render, screen } from '@testing-library/react-native';
import { Dimensions, StyleSheet, Text } from 'react-native';

import { MessageContextMenu, type MenuAnchor } from '.';

import { Sizes, Spacing } from '@/theme';

const actions = [
  { id: 'reply', label: 'Ответить' },
  { id: 'copy', label: 'Копировать' },
];

function menu(anchor: MenuAnchor, withReactions = true) {
  return (
    <MessageContextMenu
      anchor={anchor}
      viewport={{ x: 0, y: 100, width: 750, height: 1000 }}
      preview={<Text>облачко</Text>}
      actions={actions}
      reactions={withReactions ? { selected: null, onSelect: jest.fn() } : null}
      onAction={jest.fn()}
      onClose={jest.fn()}
    />
  );
}

function renderMenu(anchor: MenuAnchor, withReactions = true) {
  return render(menu(anchor, withReactions));
}

/** Где стоит узел — его стиль. */
function styleOf(testID: string) {
  return StyleSheet.flatten(screen.getByTestId(testID).props.style);
}

function menuRowTop() {
  return styleOf('message-menu-row').top;
}

describe('MessageContextMenu', () => {
  it('opens at the finger: the touch lands inside the first item', async () => {
    await renderMenu({ x: 300, y: 500, width: 400, height: 200, touchY: 650 });

    const top = menuRowTop() as number;

    expect(top).toBeLessThan(650);
    expect(650 - top).toBeLessThan(Spacing.one + Sizes.menuRowHeight);
  });

  it('follows the finger, not the bubble', async () => {
    const view = await renderMenu({ x: 300, y: 500, width: 400, height: 200, touchY: 520 });
    const nearTop = menuRowTop() as number;

    await view.rerender(menu({ x: 300, y: 500, width: 400, height: 200, touchY: 680 }));

    expect((menuRowTop() as number) - nearTop).toBe(160);
  });

  it('keeps the bubble copy exactly where the bubble is, without any shift', async () => {
    await renderMenu({ x: 300, y: 500, width: 400, height: 200, touchY: 650 });

    const preview = styleOf('message-menu-preview');

    // Копия — внутри окна списка (верх 100): её место в окне — 500.
    expect(preview).toMatchObject({ top: 400, left: 300, width: 400, height: 200 });
    expect(preview.transform).toBeUndefined();
  });

  it('puts the reactions above the menu, their left edge halfway to the menu', async () => {
    await renderMenu({ x: 300, y: 500, width: 400, height: 200, touchY: 650 });

    const { width } = Dimensions.get('window');
    const menuLeft = Math.round(width * Sizes.menuLeftShare);
    const picker = styleOf('reaction-picker');

    expect(picker.left).toBe(Math.round(menuLeft / 2));
    expect(picker.top).toBeLessThan(menuRowTop() as number);
  });

  it('opens at the bubble top when there is no touch', async () => {
    await renderMenu({ x: 300, y: 500, width: 400, height: 200, touchY: null }, false);

    expect(menuRowTop()).toBe(500);
    expect(screen.queryByTestId('reaction-picker')).toBeNull();
  });
});
