// Подсветка кластеров на тексте: прямоугольники по строкам (как у
// выделения), скругление — только на логических концах куска, и зазор между
// соседними кластерами, чтобы два куска не сливались в одну заливку.

import type { TextGeometry } from '../../../../modules/text-geometry';

import { rangeRects, type Rect } from '@/features/chats/fragments/textGeometry';

export type ClusterPiece = {
  clusterId: string;
  rect: Rect;
  /** Начало куска — скруглён левый край. */
  first: boolean;
  /** Конец куска — скруглён правый край. */
  last: boolean;
};

/**
 * Куски подсветки кластеров, по порядку на тексте. Диапазоны — UTF-16. Два
 * кластера на одной строке ближе, чем `gap`, расходятся у общей границы:
 * прямоугольники укорачиваются, диапазоны не меняются.
 */
export function clusterPieces(
  geometry: TextGeometry,
  clusters: readonly { id: string; start: number; end: number }[],
  gap: number,
): ClusterPiece[] {
  const pieces: ClusterPiece[] = [];

  for (const cluster of [...clusters].sort((a, b) => a.start - b.start)) {
    const rects = rangeRects(geometry, cluster.start, cluster.end);

    rects.forEach((rect, index) =>
      pieces.push({
        clusterId: cluster.id,
        rect: { ...rect },
        first: index === 0,
        last: index === rects.length - 1,
      }),
    );
  }

  for (let i = 1; i < pieces.length; i++) {
    const before = pieces[i - 1];
    const after = pieces[i];

    if (before.clusterId === after.clusterId || before.rect.y !== after.rect.y) continue;

    const space = after.rect.x - (before.rect.x + before.rect.width);

    if (space >= gap) continue;

    const cut = (gap - space) / 2;

    before.rect.width -= cut;
    after.rect.x += cut;
    after.rect.width -= cut;
  }

  return pieces.filter((piece) => piece.rect.width > 0);
}
