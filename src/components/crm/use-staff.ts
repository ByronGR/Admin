'use client';

import { useEffect, useState } from 'react';
import { db, collection, getDocs } from '@/lib/firebase';

export interface StaffPerson { name: string; email: string }

// Nearwork staff (anyone with an @nearwork.co account) — for owner pickers.
export function useStaff(): StaffPerson[] {
  const [staff, setStaff] = useState<StaffPerson[]>([]);
  useEffect(() => {
    getDocs(collection(db, 'users'))
      .then((snap) => {
        const list = snap.docs
          .map((d) => d.data() as { name?: string; email?: string })
          .filter((u) => (u.email || '').toLowerCase().endsWith('@nearwork.co'))
          .map((u) => ({ name: u.name || u.email || '', email: (u.email || '').toLowerCase() }))
          .sort((a, b) => a.name.localeCompare(b.name));
        setStaff(list);
      })
      .catch(() => null);
  }, []);
  return staff;
}
