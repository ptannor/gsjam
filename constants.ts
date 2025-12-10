
import { UserName } from './types';

export const ALL_USERS: UserName[] = [
  "Philip", "Carly", "Jessica", "Michal K", "Moran",
  "Roi", "Yael", "Ortal", "Gali", "Dudi",
  "Fried", "Michelle", "Nadesh", "Adi", "Inbar",
  "Kobi", "Moria", "Michal H", "Shalhevet", "Tomer",
  "Guest 1", "Guest 2", "Guest 3"
];

export const RATING_OPTIONS = [
  { value: 'Highlight', label: '🌟 Highlight', color: 'text-green-400' },
  { value: 'Sababa', label: '👍 Sababa', color: 'text-yellow-400' },
  { value: 'No comment', label: '😐 No comment', color: 'text-gray-400' },
  { value: 'Needs work', label: '🔧 Needs work', color: 'text-red-400' },
] as const;

// !!! REPLACE WITH YOUR REAL FIREBASE CONFIG !!!
export const FIREBASE_CONFIG = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT-default-rtdb.firebaseio.com",
  projectId: "YOUR_PROJECT",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef"
};
