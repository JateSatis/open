import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { GridSkeleton, SEGMENT_ROWS } from '.';

import { MediaLimits } from '@/features/media/constants';
import { GRID_COLUMNS } from '@/features/media/MediaGrid/gridLayout';

const ROWS_IN_GALLERY = Math.ceil(MediaLimits.gallery.maxAssets / GRID_COLUMNS);

function renderSkeleton() {
  return render(<GridSkeleton top={24} square="#212225" gap="#000000" />);
}

describe('GridSkeleton', () => {
  it('covers the longest gallery the grid can show', async () => {
    // Слой нарезан на куски: сплошная вью во всю высоту содержимого на Android
    // перестаёт рисоваться, стоит отскроллить вглубь.
    await renderSkeleton();

    const segments = screen.getAllByTestId('grid-skeleton-segment');

    expect(segments.length * SEGMENT_ROWS).toBeGreaterThanOrEqual(ROWS_IN_GALLERY);
  });

  it('draws both kinds of gaps as the background of one view per chunk, without images', async () => {
    await renderSkeleton();

    const segment = screen.getAllByTestId('grid-skeleton-segment')[0];
    const style = StyleSheet.flatten(segment.props.style);

    // Картинка-плитка на Android превращается в битмап размером с вью —
    // 30 МБ на кусок. Фон-градиент рисуется шейдером и памяти не держит.
    expect(segment.children).toHaveLength(0);
    expect(String(style.experimental_backgroundImage).match(/linear-gradient/g)).toHaveLength(2);
    expect(style.experimental_backgroundRepeat).toBe('repeat');
  });

  it('draws only as many rows as asked', async () => {
    await render(
      <GridSkeleton top={0} square="#212225" gap="#000000" maxRows={SEGMENT_ROWS + 1} />,
    );

    expect(screen.getAllByTestId('grid-skeleton-segment')).toHaveLength(2);
  });

  it('is invisible to touches — the grid under it must stay usable', async () => {
    await renderSkeleton();

    expect(screen.getByTestId('grid-skeleton').props.pointerEvents).toBe('none');
  });
});
