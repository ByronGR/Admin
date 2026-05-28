import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  getDoc,
  doc,
  setDoc,
  addDoc,
  deleteDoc,
  updateDoc,
  serverTimestamp,
  onSnapshot,
  Timestamp,
  FieldValue,
  arrayUnion,
  arrayRemove,
  increment,
  type DocumentData,
  type QueryConstraint,
} from 'firebase/firestore';
import {
  getAuth,
  onAuthStateChanged,
  signOut,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  type User,
} from 'firebase/auth';
import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL,
} from 'firebase/storage';

const firebaseConfig = {
  apiKey: 'AIzaSyApRNyW8PoP28E0x77dUB5jOgHuTqA2by4',
  authDomain: 'nearwork-97e3c.firebaseapp.com',
  projectId: 'nearwork-97e3c',
  storageBucket: 'nearwork-97e3c.firebasestorage.app',
  messagingSenderId: '145642656516',
  appId: '1:145642656516:web:0ac2da8931283121e87651',
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const storage = getStorage(app);

// ─── Role helpers ─────────────────────────────────────────────────────────────

const STAFF_ROLES = [
  'super_admin',
  'admin',
  'sr_recruiter',
  'recruiter',
  'account_manager',
  'hr',
  'employee',
  'user',
] as const;

const HARD_CODED_SUPER_ADMINS = [
  'byron.giraldo@nearwork.co',
  'stephany.picos@nearwork.co',
];

export type StaffRole = (typeof STAFF_ROLES)[number];

export function isNearworkEmail(email: string): boolean {
  return String(email ?? '')
    .trim()
    .toLowerCase()
    .endsWith('@nearwork.co');
}

export function normalizeStaffRole(role: string): StaffRole {
  const value = String(role ?? '')
    .trim()
    .toLowerCase()
    .replaceAll('-', '_')
    .replaceAll(' ', '_');
  if (value === 'super_admin') return 'super_admin';
  if (value === 'senior_recruiter') return 'sr_recruiter';
  if (value === 'users') return 'employee';
  return (STAFF_ROLES as readonly string[]).includes(value)
    ? (value as StaffRole)
    : 'employee';
}

export function isAdminRole(role: string): boolean {
  return (STAFF_ROLES as readonly string[]).includes(normalizeStaffRole(role));
}

// ─── User profile helpers ─────────────────────────────────────────────────────

export async function getUserProfile(uid: string): Promise<(DocumentData & { id: string }) | null> {
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    if (snap.exists()) return { id: snap.id, ...snap.data() } as DocumentData & { id: string };
    return null;
  } catch (e) {
    console.error('getUserProfile error:', e);
    return null;
  }
}

export async function saveUserProfile(uid: string, data: DocumentData) {
  return setDoc(doc(db, 'users', uid), data, { merge: true });
}

export async function ensureStaffUserProfile(user: User) {
  const email = String(user?.email ?? '')
    .trim()
    .toLowerCase();
  if (!user || !isNearworkEmail(email)) return null;
  const profile = await getUserProfile(user.uid);
  const role = HARD_CODED_SUPER_ADMINS.includes(email)
    ? 'super_admin'
    : normalizeStaffRole(profile?.role ?? 'employee');
  const displayName =
    user.displayName ?? profile?.name ?? email.split('@')[0];
  const data: DocumentData = {
    email,
    name: profile?.name ?? displayName,
    firstName: profile?.firstName ?? displayName.split(' ')[0] ?? '',
    lastName:
      profile?.lastName ?? displayName.split(' ').slice(1).join(' '),
    role,
    staffRole: role,
    source: profile?.source ?? 'admin.nearwork.co',
    status: profile?.status ?? 'active',
    updatedAt: serverTimestamp(),
  };
  if (!profile) data.createdAt = serverTimestamp();
  await saveUserProfile(user.uid, data);
  return { id: user.uid, ...(profile ?? {}), ...data };
}

// ─── Re-exports ───────────────────────────────────────────────────────────────

export {
  db,
  auth,
  storage,
  onAuthStateChanged,
  signOut,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  serverTimestamp,
  Timestamp,
  FieldValue,
  arrayUnion,
  arrayRemove,
  increment,
  doc,
  setDoc,
  getDoc,
  deleteDoc,
  updateDoc,
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  addDoc,
  onSnapshot,
  ref,
  uploadBytes,
  getDownloadURL,
  type User,
  type DocumentData,
  type QueryConstraint,
};
