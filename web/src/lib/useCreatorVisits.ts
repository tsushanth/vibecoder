'use client';

import { useEffect, useState } from 'react';
import { api } from './api';
import { NO_VISITS, parseVisits, type CreatorVisits } from './visits';

/** The signed-in creator's visit counts. Empty while loading, signed out or on error. `reloadKey` fetches again (after publishing). */
export function useCreatorVisits(userId: string | null | undefined, reloadKey: string | number = ''): CreatorVisits {
  const [visits, setVisits] = useState<{ userId: string; data: CreatorVisits } | null>(null);
  useEffect(() => {
    if (!userId) return;
    let stale = false;
    api.get('/api/visits')
      .then((body) => { if (!stale) setVisits({ userId, data: parseVisits(body) }); })
      .catch(() => {});
    return () => { stale = true; };
  }, [userId, reloadKey]);
  return visits && visits.userId === userId ? visits.data : NO_VISITS;
}
