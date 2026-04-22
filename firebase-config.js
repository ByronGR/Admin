// ═══════════════════════════════════════════
// Nearwork — Firebase Config & Auth Utilities
// admin.nearwork.co
// ═══════════════════════════════════════════

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  onAuthStateChanged,
  signOut
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  collection,
  query,
  where,
  getDocs,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import {
  getStorage
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js';

// ─── Config ───────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyApRNyW8PoP28E0x77dUB5jOgHuTqA2by4",
  authDomain: "nearwork-97e3c.firebaseapp.com",
  projectId: "nearwork-97e3c",
  storageBucket: "nearwork-97e3c.firebasestorage.app",
  messagingSenderId: "145642656516",
  appId: "1:145642656516:web:0ac2da8931283121e87651",
  measurementId: "G-3LC8N6FFSH"
};

// ─── Init ─────────────────────────────────
const app     = initializeApp(firebaseConfig);
const auth    = getAuth(app);
const db      = getFirestore(app);
const storage = getStorage(app);

// ─── Admin roles ──────────────────────────
// These are the only roles allowed on admin.nearwork.co
const ADMIN_ROLES = ['admin', 'super_admin', 'senior_recruiter', 'recruiter'];

export function isAdminRole(role) {
  return ADMIN_ROLES.includes(role);
}

// ─── Firestore helpers ────────────────────
export async function getUserProfile(uid) {
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  } catch(e) {
    console.error('getUserProfile error:', e);
    return null;
  }
}

export async function saveUserProfile(uid, data) {
  await setDoc(doc(db, 'users', uid), {
    ...data,
    updatedAt: serverTimestamp()
  }, { merge: true });
}

// ─── Redirect helpers (clean URLs — no .html) ─────────────────────────────
export function redirectToLogin() {
  window.location.href = '/admin-login';
}

export function redirectToDashboard() {
  window.location.href = '/admin-dashboard';
}

// ─── Auth guard ──────────────────────────
// Call on dashboard pages — blocks anyone who isn't an admin role
export function requireAdminAuth() {
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      unsub();
      if (!user) {
        redirectToLogin();
        return;
      }
      const profile = await getUserProfile(user.uid);
      if (!profile || !isAdminRole(profile.role)) {
        await signOut(auth);
        redirectToLogin();
        return;
      }
      resolve({ user, profile });
    });
  });
}

// Export everything the HTML files need
export {
  auth, db, storage,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
  serverTimestamp,
  doc, setDoc, getDoc,
  collection, query, where, getDocs
};
