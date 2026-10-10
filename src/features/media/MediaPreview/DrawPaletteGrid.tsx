import { Canvas, Group, Rect } from '@shopify/react-native-skia';
import { useMemo, useState } from 'react';
import { Pressable } from 'react-native';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';

import { CheckerShader } from './checker';
import { outlineFor, paletteCellAt, paletteCellOf, paletteLayout } from './paletteLayout';

import { DrawPalette, Sizes } from '@/theme';

export type DrawPaletteGridProps = {
  /** Цвет кисти `#rrggbbaa` — его квадратик обведён. */
  color: string;
  /** Прозрачность с ползунка — с ней видны квадратики. */
  alpha: SharedValue<number>;
  onPick: (rgb: string) => void;
};

/**
 * Сетка цветов на всю ширину: квадратики поверх шахматной клетки, с
 * прозрачностью ползунка. Выбранный цвет обведён — чёрным на светлом, белым
 * на тёмном. Цвет не из сетки (взят пипеткой) — ничего не обведено.
 */
export function DrawPaletteGrid({ color, alpha, onPick }: DrawPaletteGridProps) {
  const [width, setWidth] = useState(0);
  const layout = useMemo(() => paletteLayout(width), [width]);
  const rgb = color.slice(0, 7).toLowerCase();
  const selected = paletteCellOf(rgb);
  const outline = useDerivedValue(() => outlineFor(rgb, alpha.value));
  const inset = Sizes.drawPaletteOutline / 2;

  return (
    <Pressable
      testID="draw-palette"
      accessibilityLabel="Цвета"
      style={{ height: layout.height }}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      onPress={(event) => {
        const cell = paletteCellAt(layout, event.nativeEvent.locationX, event.nativeEvent.locationY);

        if (cell) onPick(DrawPalette[cell.row][cell.column]);
      }}
    >
      {width > 0 ? (
        <Canvas style={{ width, height: layout.height }} pointerEvents="none">
          {layout.cells.map((cell) => (
            <Rect key={`c${cell.row}-${cell.column}`} {...cell.rect}>
              <CheckerShader />
            </Rect>
          ))}
          <Group opacity={alpha}>
            {layout.cells.map((cell) => (
              <Rect
                key={`${cell.row}-${cell.column}`}
                {...cell.rect}
                color={DrawPalette[cell.row][cell.column]}
              />
            ))}
          </Group>
          {selected ? (
            <Rect
              x={layout.cells[selected.row * layout.columns + selected.column].rect.x + inset}
              y={layout.cells[selected.row * layout.columns + selected.column].rect.y + inset}
              width={layout.cell - inset * 2}
              height={layout.cell - inset * 2}
              style="stroke"
              strokeWidth={Sizes.drawPaletteOutline}
              color={outline}
            />
          ) : null}
        </Canvas>
      ) : null}
    </Pressable>
  );
}
