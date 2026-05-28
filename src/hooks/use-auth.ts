'use client';

import { useState, useEffect } from 'react';
import {
  auth,
  onAuthStateChanged,
  ensureStaffUserProfile,
  isNearworkEmail,
  type User,
} from '@/lib/firebase';
import type { UserProfile } from '@/lib/types';

export interface AuthState {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  isNearwork: boolean;
}

export function useAuth(): AuthState {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u && isNearworkEmail(u.email ?? '')) {
        const p = await ensureStaffUserProfile(u);
        setProfile(p as UserProfile | null);
      } else {
        setProfile(null);
      }
      setLoading(false);
    });
    return unsub;
  }, []);

  return {
    user,
    profile,
    loading,
    isNearwork: isNearworkEmail(user?.email ?? ''),
  };
}
