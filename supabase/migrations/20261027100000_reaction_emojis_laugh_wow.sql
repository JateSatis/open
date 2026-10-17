-- Справочник реакций: 😂 и 😮 — у каждой свой цвет подсветки кластера
-- (жёлтый и фиолетовый). Не основные, в конец полного набора. Клиентский
-- список — `src/features/interactions/reactionSet.ts`, тест рядом сверяет.

insert into public.reaction_emojis (emoji, position, is_primary, valence) values
  ('😂', 71, false, 0.8),
  ('😮', 72, false, 0.3);
