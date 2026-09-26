import { useEffect, useState } from 'react';

import { getInstallationId } from './installationId';

/** Id этой установки — чтобы узнать своё устройство в списке. */
export function useInstallationId(): string | null {
  const [installationId, setInstallationId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    void getInstallationId()
      .then((id) => {
        if (active) setInstallationId(id);
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, []);

  return installationId;
}
