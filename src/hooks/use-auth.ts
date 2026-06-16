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
      try {
        if (u && isNearworkEmail(u.email ?? '')) {
          const p = await Promise.race([
            ensureStaffUserProfile(u),
            new Promise<null>((_, reject) =>
              setTimeout(() => reject(new Error('profile load timeout')), 8000)
            ),
          ]);
          setProfile(p as UserProfile | null);
        } else {
          setProfile(null);
        }
      } catch (e) {
        console.warn('useAuth profile load error:', e);
        setProfile(null);
      } finally {
        setLoading(false);
      }
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
