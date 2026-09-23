import { render, screen } from '@testing-library/react-native';

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
    // перестаёт рисоваться, стоит отскроллить вглубь. Кусков должно хватать на
    // всю галерею, иначе в глубине снова появится место без квадрата.
    await renderSkeleton();

    const segments = screen.getAllByTestId('grid-skeleton-segment');

    expect(segments.length * SEGMENT_ROWS).toBeGreaterThanOrEqual(ROWS_IN_GALLERY);
  });

  it('draws the row gaps with one repeated tile per chunk, not a view per row', async () => {
    await renderSkeleton();

    const rules = screen.getAllByTestId('grid-skeleton-rule');

    // Повтор делает система, поэтому «успевать» за скроллом этому слою не надо.
    expect(rules.length).toBeLessThan(ROWS_IN_GALLERY);
    expect(rules[0].props.resizeMode).toBe('repeat');
    expect(String(rules[0].props.source.uri)).toMatch(/^data:image\/png;base64,/);
  });

  it('is invisible to touches — the grid under it must stay usable', async () => {
    await renderSkeleton();

    expect(screen.getByTestId('grid-skeleton').props.pointerEvents).toBe('none');
  });
});
