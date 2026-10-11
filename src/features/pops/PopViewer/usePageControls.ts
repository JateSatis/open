import { useCallback, useRef, useState } from 'react';

import { randomTilt, type Heart } from './HeartBurst';
import type { PopoverAnchor } from './PopReactionPopover';

/**
 * Что человек сделал со страницей: пауза, 2×, раскрытая подпись, выбор
 * реакции, сердца двойного тапа, видно ли уже видео. Ушёл со страницы —
 * вернётся к игре, а не к паузе и не к раскрытой подписи.
 */
export function usePageControls(active: boolean) {
  const [paused, setPaused] = useState(false);
  const [fast, setFast] = useState(false);
  const [captionOpen, setCaptionOpen] = useState(false);
  const [picker, setPicker] = useState<PopoverAnchor | null>(null);
  // Видео пошло — обложка поверх убирается.
  const [framed, setFramed] = useState(false);
  const [hearts, setHearts] = useState<Heart[]>([]);
  const heartKey = useRef(0);
  const [wasActive, setWasActive] = useState(active);

  if (wasActive !== active) {
    setWasActive(active);

    if (!active) {
      setPaused(false);
      setFast(false);
      setCaptionOpen(false);
      setPicker(null);
      setFramed(false);
    }
  }

  const togglePause = useCallback(() => setPaused((value) => !value), []);
  const showFrame = useCallback(() => setFramed(true), []);
  const addHeart = useCallback((x: number, y: number) => {
    heartKey.current += 1;

    const key = heartKey.current;

    setHearts((list) => [...list, { key, x, y, tilt: randomTilt() }]);
  }, []);
  const dropHeart = useCallback(
    (key: number) => setHearts((list) => list.filter((heart) => heart.key !== key)),
    [],
  );

  return {
    paused,
    togglePause,
    fast,
    setFast,
    captionOpen,
    setCaptionOpen,
    picker,
    setPicker,
    framed,
    showFrame,
    hearts,
    addHeart,
    dropHeart,
  };
}
