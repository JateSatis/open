import { useCallback, useRef, useState, type ReactNode } from 'react';

import { PersonalDataSheet } from '@/features/privacy/PersonalDataSheet';
import { scanPersonalData, type PersonalDataFinding } from '@/features/privacy/personalData';

/** Как продолжить публикацию: с найденным скрытым (`hide`) или как есть. */
export type PersonalDataDecision = { hide: PersonalDataFinding[] | null };

export type PersonalDataGuard = {
  /**
   * Перед публикацией: высокий риск — лист, остальное — сразу `proceed`.
   * «Изменить» не зовёт ничего: текст остаётся в поле.
   */
  check: (text: string, proceed: (decision: PersonalDataDecision) => void) => void;
  /** Лист — смонтировать рядом с полем. */
  sheet: ReactNode;
};

/**
 * Предупреждение о личных данных перед отправкой: сообщение, комментарий,
 * заявка, «О себе». Только подсказка человеку: на сервер ничего не уходит,
 * отправку ничто не запрещает.
 *
 * `canHide` — у текста бывает скрытое от зрителей (сообщения): тогда в листе
 * есть «Скрыть найденное от зрителей».
 */
export function usePersonalDataGuard({
  audience,
  canHide = false,
}: {
  audience: string;
  canHide?: boolean;
}): PersonalDataGuard {
  const [findings, setFindings] = useState<PersonalDataFinding[] | null>(null);
  const pending = useRef<((decision: PersonalDataDecision) => void) | null>(null);

  const check = useCallback((text: string, proceed: (decision: PersonalDataDecision) => void) => {
    const scan = scanPersonalData(text);

    if (scan.risk !== 'high') {
      proceed({ hide: null });
      return;
    }

    pending.current = proceed;
    setFindings(scan.findings);
  }, []);

  const finish = (decision: PersonalDataDecision | null) => {
    const proceed = pending.current;

    pending.current = null;
    setFindings(null);
    if (decision && proceed) proceed(decision);
  };

  const sheet = (
    <PersonalDataSheet
      visible={findings !== null}
      findings={findings ?? []}
      audience={audience}
      onHide={canHide ? () => finish({ hide: findings }) : undefined}
      onSendAsIs={() => finish({ hide: null })}
      onEdit={() => finish(null)}
    />
  );

  return { check, sheet };
}
