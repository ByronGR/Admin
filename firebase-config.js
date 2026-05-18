import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
  getFirestore, collection, query, where,
  getDocs, getDoc, doc, setDoc, addDoc, deleteDoc, serverTimestamp, onSnapshot, limit
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import {
  getAuth, onAuthStateChanged, signOut,
  signInWithEmailAndPassword, createUserWithEmailAndPassword,
  sendPasswordResetEmail
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
  getStorage, ref, uploadBytes, getDownloadURL
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js';
 
const firebaseConfig = {
  apiKey: "AIzaSyApRNyW8PoP28E0x77dUB5jOgHuTqA2by4",
  authDomain: "nearwork-97e3c.firebaseapp.com",
  projectId: "nearwork-97e3c",
  storageBucket: "nearwork-97e3c.firebasestorage.app",
  messagingSenderId: "145642656516",
  appId: "1:145642656516:web:0ac2da8931283121e87651"
};
 
const app  = initializeApp(firebaseConfig);
const db   = getFirestore(app);
const auth = getAuth(app);
const storage = getStorage(app);
const STAFF_ROLES = ['super_admin', 'admin', 'sr_recruiter', 'recruiter', 'account_manager', 'hr', 'employee', 'user'];
const HARD_CODED_SUPER_ADMINS = ['byron.giraldo@nearwork.co', 'stephany.picos@nearwork.co'];
 
// Get user profile from Firestore
export async function getUserProfile(uid) {
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    if (snap.exists()) return { id: snap.id, ...snap.data() };
    return null;
  } catch(e) {
    console.error('getUserProfile error:', e);
    return null;
  }
}
 
// Check if role is an admin role
export function isAdminRole(role) {
  return STAFF_ROLES.includes(normalizeStaffRole(role));
}

export function normalizeStaffRole(role) {
  const value = String(role || '').trim().toLowerCase().replaceAll('-', '_').replaceAll(' ', '_');
  if (value === 'super_admin') return 'super_admin';
  if (value === 'senior_recruiter') return 'sr_recruiter';
  if (value === 'users') return 'employee';
  return value || 'employee';
}

export function isNearworkEmail(email) {
  return String(email || '').trim().toLowerCase().endsWith('@nearwork.co');
}

// Save or update a user profile in Firestore
export async function saveUserProfile(uid, data) {
  return setDoc(doc(db, 'users', uid), data, { merge: true });
}

export async function ensureStaffUserProfile(user) {
  const email = String(user?.email || '').trim().toLowerCase();
  if (!user || !isNearworkEmail(email)) return null;
  const profile = await getUserProfile(user.uid);
  const role = HARD_CODED_SUPER_ADMINS.includes(email) ? 'super_admin' : normalizeStaffRole(profile?.role || 'employee');
  const displayName = user.displayName || profile?.name || email.split('@')[0];
  const data = {
    email,
    name: profile?.name || displayName,
    firstName: profile?.firstName || displayName.split(' ')[0] || '',
    lastName: profile?.lastName || displayName.split(' ').slice(1).join(' '),
    role,
    staffRole: role,
    source: profile?.source || 'admin.nearwork.co',
    status: profile?.status || 'active',
    updatedAt: serverTimestamp()
  };
  if (!profile) data.createdAt = serverTimestamp();
  await saveUserProfile(user.uid, data);
  return { id: user.uid, ...(profile || {}), ...data };
}
 
export {
  db, auth, storage, onAuthStateChanged, signOut,
  signInWithEmailAndPassword, createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  serverTimestamp, doc, setDoc, getDoc, deleteDoc,
  collection, query, where, getDocs, addDoc, onSnapshot, limit, ref,
  uploadBytes, getDownloadURL
};
