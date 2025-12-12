
export type UserName = 
  | "Philip" | "Carly" | "Jessica" | "Michal K" | "Moran" 
  | "Roi" | "Yael" | "Ortal" | "Gali" | "Dudi" 
  | "Fried" | "Michelle" | "Nadesh" | "Adi" | "Inbar" 
  | "Kobi" | "Moria" | "Michal H" | "Shalhevet" | "Tomer" 
  | "Guest 1" | "Guest 2" | "Guest 3";

export interface User {
  id: string;
  name: UserName;
}

export interface JamParticipant {
  id: string;
  sessionId: string;
  userId: string;
  name: UserName; // Denormalized for ease
  arrivalTime: number; // Timestamp
}

export type ChordSourceType = 'link' | 'screenshot' | 'auto_search';
export type PlayStatus = 'not_played' | 'playing' | 'played';

export interface SongChoice {
  id: string;
  sessionId: string;
  chooserUserId: string;
  ownerUserId: string; // Who it's for
  ownerName: UserName;
  title: string;
  artist: string;
  chordSourceType: ChordSourceType;
  chordLink?: string;
  chordScreenshotUrl?: string;
  submissionTime: number;
  playStatus: PlayStatus;
  isStolen: boolean;
  playedAt?: number;
}

export type RatingValue = 'Highlight' | 'Sababa' | 'No comment' | 'Needs work';

export interface Rating {
  id: string;
  songChoiceId: string;
  userId: string;
  value: RatingValue;
}

export interface JamSession {
  id: string;
  date: string; // YYYY-MM-DD
  status: 'active' | 'ended';
}

export interface ChordSearchResult {
  title: string;
  url: string;
  snippet: string;
}
