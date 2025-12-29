
import { UserName } from './types';

export const ALL_USERS: UserName[] = [
  "Philip", "Carly", "Jessica", "Michal K", "Moran",
  "Roi", "Yael", "Ortal", "Gali", "Dudi",
  "Fried", "Michelle", "Nadesh", "Adi", "Inbar",
  "Kobi", "Moria", "Michal H", "Shalhevet", "Tomer",
  "Josh",
  "Guest 1", "Guest 2", "Guest 3"
];

export const RATING_OPTIONS = [
  { value: 'Highlight', label: '🌟 Highlight', color: 'text-green-400' },
  { value: 'Sababa', label: '👍 Sababa', color: 'text-yellow-400' },
  { value: 'No comment', label: '😐 No comment', color: 'text-gray-400' },
  { value: 'Needs work', label: '🔧 Needs work', color: 'text-red-400' },
] as const;

// Helper to safely access env vars without crashing if import.meta.env is missing
const getEnv = (key: string, fallback: string) => {
  try {
    // @ts-ignore
    if (typeof import.meta !== 'undefined' && import.meta.env) {
      // @ts-ignore
      return import.meta.env[key] || fallback;
    }
  } catch (e) {
    console.warn(`Error accessing env var ${key}`, e);
  }
  return fallback;
};

// Config now reads from Environment Variables (Vite/Vercel) safely
// Fallback values trigger Local Storage mode in services/firebase.ts
export const FIREBASE_CONFIG = {
  apiKey: getEnv("VITE_FIREBASE_API_KEY", "YOUR_API_KEY"),
  authDomain: getEnv("VITE_FIREBASE_AUTH_DOMAIN", "YOUR_PROJECT.firebaseapp.com"),
  databaseURL: getEnv("VITE_FIREBASE_DATABASE_URL", "https://YOUR_PROJECT-default-rtdb.firebaseio.com"),
  projectId: getEnv("VITE_FIREBASE_PROJECT_ID", "YOUR_PROJECT"),
  storageBucket: getEnv("VITE_FIREBASE_STORAGE_BUCKET", "YOUR_PROJECT.appspot.com"),
  messagingSenderId: getEnv("VITE_FIREBASE_MESSAGING_SENDER_ID", "123456789"),
  appId: getEnv("VITE_FIREBASE_APP_ID", "1:123456789:web:abcdef")
};
