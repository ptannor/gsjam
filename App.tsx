
import React, { useState, useEffect, useMemo } from 'react';
import { 
  DndContext, 
  closestCenter, 
  KeyboardSensor, 
  PointerSensor, 
  useSensor, 
  useSensors, 
  DragEndEvent,
  TouchSensor
} from '@dnd-kit/core';
import { 
  arrayMove, 
  SortableContext, 
  sortableKeyboardCoordinates, 
  verticalListSortingStrategy,
  useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { 
  Plus, Music, Clock, Users, BarChart2, GripVertical, 
  Play, CheckCircle, ExternalLink, Image as ImageIcon,
  RotateCcw, Search, Trash2, ShieldAlert, Upload, ArrowLeft, Calendar, Guitar, Pencil, X,
  Trophy, Heart, Activity, History, ChevronDown, LogOut, Undo2, UserPlus, Star, Eye,
  Zap, Flame, TrendingUp, Sparkles, Mic2, Database, Archive, Link as LinkIcon, Languages, Globe,
  ThumbsUp, StopCircle, RefreshCw, Menu as MenuIcon, Power, Bookmark, Copy, AlertTriangle, Square, CheckSquare
} from 'lucide-react';

import { ALL_USERS, RATING_OPTIONS, FIREBASE_CONFIG } from './constants';
import { JamSession, JamParticipant, SongChoice, User, Rating, UserName, ChordSearchResult, RatingValue, SongCacheItem } from './types';
import { searchChords } from './services/geminiService';
import { rebalanceQueue } from './components/QueueLogic';
import { calculateSongScore, getLeaderboard, calculateTasteSimilarity, getCrowdPleasers, getSessionSummary, getBiggestThieves, getUserRatingHistory, getUserLanguageStats, getLanguagePreferences, SessionSummary, ScoredSong, UserLanguagePreference } from './components/StatsLogic';
import { initFirebase, isFirebaseReady, getDb, ref, set, onValue, update, get, child, remove } from './services/firebase';

// --- Utility Functions ---

const safeParse = (json: string | null, fallback: any) => {
  if (!json || json === "undefined") return fallback;
  try {
    return JSON.parse(json);
  } catch (e) {
    console.warn("Failed to parse JSON, using fallback", e);
    return fallback;
  }
};

const generateId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
};

const sanitizeForFirebase = (data: any) => {
  if (data === undefined) return null;
  return JSON.parse(JSON.stringify(data));
};

const getLocalDate = () => {
  const d = new Date();
  const offset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - offset).toISOString().split('T')[0];
};

// --- Utility Components ---

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  children?: React.ReactNode;
  title: string;
  size?: 'md' | 'lg' | 'xl';
}

const Modal = ({ isOpen, onClose, children, title, size = 'md' }: ModalProps) => {
  if (!isOpen) return null;
  
  const sizeClasses = {
      md: 'max-w-lg',
      lg: 'max-w-3xl',
      xl: 'max-w-5xl h-[90vh]'
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 transition-all">
      <div className={`bg-jam-800 border border-jam-700 rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] w-full ${sizeClasses[size]} max-h-[90vh] overflow-y-auto ring-1 ring-white/10 animate-fade-in scrollbar-thin scrollbar-thumb-jam-600 flex flex-col`}>
        <div className="flex justify-between items-center p-5 border-b border-jam-700 bg-jam-800/50 sticky top-0 backdrop-blur-sm z-10 shrink-0">
          <h2 className="text-xl font-bold text-white tracking-tight truncate pr-4">{title}</h2>
          <button onClick={onClose} className="text-jam-400 hover:text-white transition-colors bg-jam-700/50 hover:bg-jam-700 rounded-full p-1">&times;</button>
        </div>
        <div className="p-5 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
};

const Button = ({ onClick, children, variant = 'primary', className = '', disabled = false }: any) => {
  const baseStyle = "px-4 py-2.5 rounded-lg font-bold uppercase text-xs tracking-wider transition-all flex items-center justify-center gap-2 transform active:scale-95";
  const variants = {
    primary: "bg-orange-600 hover:bg-orange-500 text-white shadow-lg shadow-orange-900/40 disabled:opacity-50 disabled:shadow-none border border-orange-500/50 hover:border-orange-400 disabled:cursor-not-allowed",
    secondary: "bg-jam-700 hover:bg-jam-600 text-jam-200 disabled:opacity-50 border border-jam-600 disabled:cursor-not-allowed",
    danger: "bg-red-500/10 hover:bg-red-500/20 text-red-300 disabled:opacity-50 border border-red-500/20 disabled:cursor-not-allowed",
    ghost: "text-jam-400 hover:text-white hover:bg-jam-800 disabled:opacity-50 disabled:cursor-not-allowed"
  };
  return (
    <button onClick={onClick} className={`${baseStyle} ${variants[variant as keyof typeof variants]} ${className}`} disabled={disabled}>
      {children}
    </button>
  );
};

// --- Reusable Stats Components ---

const LanguageBalanceCard = ({ languages }: { languages: SessionSummary['languages'] }) => (
    <div className="bg-gradient-to-br from-jam-800 to-jam-900 border border-jam-700 rounded-2xl p-4 md:p-5 relative overflow-hidden group">
        <div className="absolute right-0 top-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity"><Languages size={64} className="text-purple-500"/></div>
        <div className="text-jam-400 text-[10px] md:text-xs font-bold uppercase tracking-wider mb-1">Language Balance</div>
        <div className="flex items-center gap-3 md:gap-4 mt-1">
            <div>
                <div className="text-base md:text-lg font-bold text-white">{languages.hebrew}</div>
                <div className="text-[9px] md:text-[10px] text-jam-500 uppercase">Hebrew</div>
            </div>
            <div className="h-6 md:h-8 w-px bg-jam-700"></div>
            <div>
                <div className="text-base md:text-lg font-bold text-white">{languages.english}</div>
                <div className="text-[9px] md:text-[10px] text-jam-500 uppercase">English</div>
            </div>
        </div>
        <div className="w-full bg-jam-900 h-1.5 rounded-full mt-3 overflow-hidden flex">
            <div className="h-full bg-purple-500 transition-all" style={{width: `${languages.hebrewPct}%`}}></div>
            <div className="h-full bg-blue-500 transition-all" style={{width: `${languages.englishPct}%`}}></div>
        </div>
    </div>
);

const LanguageLoversSection = ({ preferences, titleSuffix = "" }: { preferences: { hebrewLovers: UserLanguagePreference[], englishLovers: UserLanguagePreference[] }, titleSuffix?: string }) => (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
        {/* Hebrew Team */}
        <div className="bg-gradient-to-br from-purple-900/30 to-jam-900 border border-purple-500/30 rounded-2xl p-4 md:p-5 relative overflow-hidden">
            <div className="absolute top-0 right-0 p-4 opacity-10"><Languages size={48} className="text-purple-500 md:w-16 md:h-16" /></div>
            <h3 className="text-base md:text-lg font-bold text-purple-200 mb-4 flex items-center gap-2 relative z-10">
                🇮🇱 Hebrew Lovers <span className="text-[10px] md:text-xs opacity-50 font-normal">{titleSuffix}</span>
            </h3>
            <div className="space-y-3 relative z-10">
                {preferences.hebrewLovers.length > 0 ? preferences.hebrewLovers.map(user => (
                    <div key={user.userId} className="bg-jam-900/80 p-3 rounded-xl border border-purple-500/20">
                        <div className="font-bold text-sm md:text-base text-white mb-2 truncate">{user.userName}</div>
                        <div className="grid grid-cols-2 gap-2 text-[10px] md:text-xs">
                            <div className="bg-jam-950 rounded p-2 border border-purple-900/50 flex flex-col items-center justify-center">
                                <div className="text-jam-500 text-[8px] md:text-[10px] uppercase mb-0.5 font-bold">Selection</div>
                                <div className="text-purple-300 font-bold">{(user.hebrewRatio * 100).toFixed(0)}% Heb</div>
                                <div className="text-jam-600 text-[8px] md:text-[9px] mt-0.5">{user.hebrewSongsChosen}h / {user.englishSongsChosen}e</div>
                            </div>
                            <div className="bg-jam-950 rounded p-2 border border-jam-800 flex flex-col items-center justify-center">
                                <div className="text-jam-500 text-[8px] md:text-[10px] uppercase mb-0.5 font-bold">Rating Pref</div>
                                <div className="flex gap-1 md:gap-2 font-bold">
                                    <span className="text-purple-400">{user.avgRatingGivenToHebrew}</span>
                                    <span className="text-jam-600">v</span>
                                    <span className="text-blue-400">{user.avgRatingGivenToEnglish}</span>
                                </div>
                                <div className="text-jam-600 text-[8px] md:text-[9px] mt-0.5">Heb v Eng</div>
                            </div>
                        </div>
                    </div>
                )) : <div className="text-xs md:text-sm text-jam-500 italic">No one in this group prefers Hebrew songs.</div>}
            </div>
        </div>

        {/* English Team */}
        <div className="bg-gradient-to-br from-blue-900/30 to-jam-900 border border-blue-500/30 rounded-2xl p-4 md:p-5 relative overflow-hidden">
            <div className="absolute top-0 right-0 p-4 opacity-10"><Globe size={48} className="text-blue-500 md:w-16 md:h-16" /></div>
            <h3 className="text-base md:text-lg font-bold text-blue-200 mb-4 flex items-center gap-2 relative z-10">
                🌎 English Lovers <span className="text-[10px] md:text-xs opacity-50 font-normal">{titleSuffix}</span>
            </h3>
            <div className="space-y-3 relative z-10">
                {preferences.englishLovers.length > 0 ? preferences.englishLovers.map(user => (
                    <div key={user.userId} className="bg-jam-900/80 p-3 rounded-xl border border-blue-500/20">
                        <div className="font-bold text-sm md:text-base text-white mb-2 truncate">{user.userName}</div>
                        <div className="grid grid-cols-2 gap-2 text-[10px] md:text-xs">
                            <div className="bg-jam-950 rounded p-2 border border-blue-900/50 flex flex-col items-center justify-center">
                                <div className="text-jam-500 text-[8px] md:text-[10px] uppercase mb-0.5 font-bold">Selection</div>
                                <div className="text-blue-300 font-bold">{((1 - user.hebrewRatio) * 100).toFixed(0)}% Eng</div>
                                <div className="text-jam-600 text-[8px] md:text-[9px] mt-0.5">{user.englishSongsChosen}e / {user.hebrewSongsChosen}h</div>
                            </div>
                            <div className="bg-jam-950 rounded p-2 border border-jam-800 flex flex-col items-center justify-center">
                                <div className="text-jam-500 text-[8px] md:text-[10px] uppercase mb-0.5 font-bold">Rating Pref</div>
                                <div className="flex gap-1 md:gap-2 font-bold">
                                    <span className="text-blue-400">{user.avgRatingGivenToEnglish}</span>
                                    <span className="text-jam-600">v</span>
                                    <span className="text-purple-400">{user.avgRatingGivenToHebrew}</span>
                                </div>
                                <div className="text-jam-600 text-[8px] md:text-[9px] mt-0.5">Eng v Heb</div>
                            </div>
                        </div>
                    </div>
                )) : <div className="text-xs md:text-sm text-jam-500 italic">No one in this group prefers English songs.</div>}
            </div>
        </div>
    </div>
);

// --- Sortable Item Component ---

interface SortableSongItemProps {
  song: SongChoice;
  index: number;
  participant?: JamParticipant;
  onMarkPlaying?: () => void;
  onMarkPlayed?: () => void;
  onDelete?: () => void;
  onRevive?: () => void;
  onEdit?: () => void;
  onUnsteal?: () => void;
  isCurrent: boolean;
  onViewImage?: (url: string) => void;
  onRate?: () => void;
  existingRatingValue?: RatingValue;
}

const SortableSongItem: React.FC<SortableSongItemProps> = ({ 
  song, index, participant, onMarkPlaying, onMarkPlayed, onDelete, onRevive, onEdit, onUnsteal, isCurrent, onViewImage, onRate, existingRatingValue
}) => {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: song.id });
  
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const isPlayed = song.playStatus === 'played';

  // Helper to find rating details
  const getRatingDetails = (val: RatingValue) => RATING_OPTIONS.find(o => o.value === val);

  return (
    <div ref={setNodeRef} style={style} className={`relative mb-3 group ${isPlayed ? 'opacity-80' : ''}`}>
      <div className={`
        flex items-center gap-3 md:gap-4 p-3 md:p-4 rounded-xl border transition-all duration-300 select-none
        ${isCurrent ? 'bg-jam-800 border-orange-500/50 shadow-[0_0_25px_rgba(249,115,22,0.1)]' : 'bg-jam-800 border-jam-700 hover:border-jam-600 hover:bg-jam-700/50'}
        ${isPlayed ? 'bg-jam-900 border-jam-800 hover:bg-jam-800' : ''}
        ${song.isStolen ? 'border-l-4 border-l-red-500/80 bg-red-900/5' : ''}
      `}>
        {!isPlayed && (
          // Added touch-none to prevent scrolling while dragging on mobile
          <div {...attributes} {...listeners} className="cursor-grab text-jam-600 hover:text-jam-400 p-1.5 -ml-1 touch-none">
            <GripVertical size={20} className="md:w-6 md:h-6" />
          </div>
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5 md:mb-1">
             <h4 className={`font-bold truncate text-sm md:text-base ${isCurrent ? 'text-orange-400' : 'text-white'}`}>{song.title}</h4>
             {song.isStolen && <span className="text-[8px] md:text-[10px] bg-red-500/20 text-red-300 px-1.5 py-0.5 rounded uppercase font-bold tracking-wider border border-red-500/20">Stolen</span>}
          </div>
          <p className="text-[11px] md:text-sm text-jam-400 truncate flex items-center gap-1.5">
            <span className="font-medium text-jam-300">{song.artist}</span> 
            <span className="w-1 h-1 rounded-full bg-jam-600"></span>
            <span className="text-jam-400">{song.ownerName}</span>
          </p>
          
          <div className="flex gap-2 md:gap-3 mt-1.5 md:mt-2">
             {song.chordLink && (
               <a href={song.chordLink} target="_blank" rel="noreferrer" className="px-1.5 py-0.5 rounded bg-jam-700/50 border border-jam-600/50 text-[9px] md:text-xs flex items-center gap-1 text-orange-400 hover:text-orange-300 hover:bg-jam-700 transition-colors" onPointerDown={(e) => e.stopPropagation()}>
                 <ExternalLink size={8} className="md:w-2.5 md:h-2.5" /> Chords
               </a>
             )}
             {song.chordScreenshotUrl && (
               <button 
                 onClick={(e) => {
                   e.stopPropagation();
                   if (onViewImage) onViewImage(song.chordScreenshotUrl!);
                 }}
                 className="px-1.5 py-0.5 rounded bg-jam-700/50 border border-jam-600/50 text-[9px] md:text-xs flex items-center gap-1 text-blue-400 hover:text-blue-300 hover:bg-jam-700 transition-colors"
                 onPointerDown={(e) => e.stopPropagation()}
               >
                 <ImageIcon size={8} className="md:w-2.5 md:h-2.5" /> Image
               </button>
             )}
          </div>
        </div>

        <div className="flex items-center gap-1 md:gap-2">
          {song.playStatus === 'not_played' && (
            <button onClick={onMarkPlaying} className="p-2 md:p-3 text-jam-400 hover:text-orange-400 hover:bg-jam-700/80 rounded-full transition-all" title="Start Playing">
              <Play size={18} fill="currentColor" className="opacity-80 md:w-5 md:h-5" />
            </button>
          )}
          
          {song.playStatus === 'playing' && (
            <button onClick={onMarkPlayed} className="p-2 md:p-3 text-green-400 hover:text-green-300 bg-green-500/10 border border-green-500/30 rounded-full animate-pulse transition-all" title="Mark as Played">
              <CheckCircle size={18} className="md:w-5 md:h-5" />
            </button>
          )}

          {/* Rate Button Logic: Show Badge if rated, Star if allowed, Clock if missed */}
          {isPlayed && (
             <>
                {existingRatingValue ? (
                   // Existing Rating - Click to Edit
                   <button 
                      onClick={onRate} 
                      className={`px-2 md:px-3 py-1 md:py-1.5 rounded-lg text-[10px] md:text-xs font-bold border bg-jam-900/50 hover:bg-jam-800 transition-all flex items-center gap-1 ${getRatingDetails(existingRatingValue)?.color} border-current`} 
                      title="Change Rating"
                   >
                      {getRatingDetails(existingRatingValue)?.label.split(' ')[1]}
                   </button>
                ) : onRate ? (
                   // Can Rate
                   <button onClick={onRate} className="p-2 text-yellow-500 hover:text-yellow-400 hover:bg-yellow-500/10 rounded-full transition-all" title="Rate this song">
                     <Star size={16} className="md:w-[18px] md:h-[18px]" />
                   </button>
                ) : (
                   // Cannot Rate (Played before arrival)
                   <div className="p-2 text-jam-700 cursor-not-allowed opacity-50" title="Played before you arrived">
                      <Clock size={16} className="md:w-[18px] md:h-[18px]" />
                   </div>
                )}
             </>
          )}

          {/* Edit Button */}
          {onEdit && (
            <button onClick={onEdit} className="p-1.5 md:p-2 text-jam-500 hover:text-jam-200 hover:bg-jam-700 rounded-full transition-colors" title="Edit Song">
              <Pencil size={14} className="md:w-4 md:h-4" />
            </button>
          )}

          {/* Unsteal Button */}
          {song.isStolen && onUnsteal && (
            <button onClick={onUnsteal} className="p-1.5 md:p-2 text-red-400 hover:text-white hover:bg-red-500/20 rounded-full transition-colors" title="Return to Natural Order">
              <Undo2 size={14} className="md:w-4 md:h-4" />
            </button>
          )}

          {isPlayed && onRevive && (
             <button onClick={onRevive} className="p-1.5 md:p-2 text-jam-500 hover:text-white rounded-full transition-colors" title="Revive">
               <RotateCcw size={16} className="md:w-[18px] md:h-[18px]" />
             </button>
          )}

          {!isPlayed && onDelete && (
            <button onClick={onDelete} className="p-2 md:p-3 text-jam-600 hover:text-red-400 hover:bg-red-500/10 rounded-full transition-all" title="Remove">
              <Trash2 size={16} className="md:w-[18px] md:h-[18px]" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// --- Main App ---

interface ArchivedSessionData {
  session: JamSession;
  participants: JamParticipant[];
  songs: SongChoice[];
  ratings: Rating[];
}

export default function App() {
  // --- State ---
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [joiningUser, setJoiningUser] = useState<UserName | null>(null);
  const [manualArrivalTime, setManualArrivalTime] = useState<string>('');
  
  const [session, setSession] = useState<JamSession | null>(null);
  const [participants, setParticipants] = useState<JamParticipant[]>([]);
  const [songs, setSongs] = useState<SongChoice[]>([]);
  const [ratings, setRatings] = useState<Rating[]>([]);
  const [queueIds, setQueueIds] = useState<string[]>([]); // Derived ordered list of IDs
  const [myStash, setMyStash] = useState<SongCacheItem[]>([]);

  const [archives, setArchives] = useState<Record<string, ArchivedSessionData>>({});

  const [view, setView] = useState<'jam' | 'stats' | 'personal_stash'>('jam');
  const [statsTab, setStatsTab] = useState<'today' | 'history' | 'leaderboards' | 'taste'>('today');
  const [historyDate, setHistoryDate] = useState<string>('');
  const [leaderboardPerspective, setLeaderboardPerspective] = useState<string>('all');
  const [rankingHistoryUser, setRankingHistoryUser] = useState<string>(''); // For filtering ratings

  const [showAddSong, setShowAddSong] = useState(false);
  const [addSongTab, setAddSongTab] = useState<'search' | 'stash'>('search');
  const [editingSongId, setEditingSongId] = useState<string | null>(null); 
  const [selectedStashId, setSelectedStashId] = useState<string | null>(null); // Track origin of song in form
  const [showRatingModal, setShowRatingModal] = useState<SongChoice | null>(null);
  const [viewingImage, setViewingImage] = useState<string | null>(null); 
  
  // New States for Feature Requests
  const [editingStashItemMode, setEditingStashItemMode] = useState(false);
  const [recoverySongs, setRecoverySongs] = useState<SongChoice[]>([]);
  const [selectedRecoveryIds, setSelectedRecoveryIds] = useState<Set<string>>(new Set());
  const [showRecoveryModal, setShowRecoveryModal] = useState(false);

  // Custom Confirmation Modal State
  const [confirmation, setConfirmation] = useState<{
      isOpen: boolean;
      title: string;
      message: string;
      onConfirm: () => void;
      type: 'danger' | 'neutral';
  }>({ isOpen: false, title: '', message: '', onConfirm: () => {}, type: 'neutral' });

  // Firebase Connected State (Always true if config is valid in constants)
  const [isFirebaseConnected, setIsFirebaseConnected] = useState(false);

  // Add Participant State
  const [showAddParticipantModal, setShowAddParticipantModal] = useState(false);
  const [showManageParticipantsModal, setShowManageParticipantsModal] = useState(false); // Mobile Management
  const [showMobileMenu, setShowMobileMenu] = useState(false); // Mobile Menu State
  const [proxyUserToAdd, setProxyUserToAdd] = useState<string>('');
  const [proxyArrivalTime, setProxyArrivalTime] = useState<string>('');

  // Edit Arrival Time State
  const [editingParticipant, setEditingParticipant] = useState<JamParticipant | null>(null);
  const [editArrivalTimeValue, setEditArrivalTimeValue] = useState<string>('');

  const [newSong, setNewSong] = useState({ 
    title: '', artist: '', ownerId: '', 
    chordType: 'auto_search', link: '', screenshot: '', searchTerm: '' 
  });
  const [searchResults, setSearchResults] = useState<ChordSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false); // New state to track if search was performed
  const [searchError, setSearchError] = useState<string | null>(null);
  const [manualSearchUrl, setManualSearchUrl] = useState<string>('');

  // --- Initialization & Data Loading ---

  // 1. Initialize Firebase on Mount
  useEffect(() => {
    // Attempt to connect immediately using constants
    if (initFirebase(FIREBASE_CONFIG)) {
      setIsFirebaseConnected(true);
    } else {
      console.warn("Firebase configuration missing or invalid. Falling back to local storage.");
    }
  }, []);

  // Set default history user when user logs in
  useEffect(() => {
    if (currentUser && !rankingHistoryUser) {
        setRankingHistoryUser(currentUser.id);
    }
  }, [currentUser]);

  // 2. Data Synchronization (Hybrid: LocalStorage or Firebase)
  useEffect(() => {
    if (isFirebaseConnected && isFirebaseReady()) {
       // --- FIREBASE MODE ---
       const db = getDb();
       
       const unsubSession = onValue(ref(db, 'session'), (snap) => {
          const val = snap.val();
          if (!val) {
             const today = getLocalDate();
             const newSession = { id: generateId(), date: today, status: 'active' };
             set(ref(db, 'session'), newSession);
          } else {
             // Backward compat: if status is missing, treat as active
             if (!val.status) val.status = 'active';
             setSession(val);
          }
       });

       const unsubParticipants = onValue(ref(db, 'participants'), (snap) => setParticipants(snap.val() ? Object.values(snap.val()) : []));
       const unsubSongs = onValue(ref(db, 'songs'), (snap) => setSongs(snap.val() ? Object.values(snap.val()) : []));
       const unsubRatings = onValue(ref(db, 'ratings'), (snap) => setRatings(snap.val() ? Object.values(snap.val()) : []));
       const unsubQueue = onValue(ref(db, 'queueIds'), (snap) => setQueueIds(snap.val() || []));
       const unsubArchives = onValue(ref(db, 'archives'), (snap) => setArchives(snap.val() || {}));

       return () => {
         unsubSession(); unsubParticipants(); unsubSongs(); unsubRatings(); unsubQueue(); unsubArchives();
       };

    } else {
       // --- LOCAL STORAGE MODE ---
       try {
         const savedArchives = safeParse(localStorage.getItem('gs_jam_archive'), {});
         setArchives(savedArchives);

         const today = getLocalDate();
         const savedSessionStr = localStorage.getItem('gs_jam_session');
         
         if (savedSessionStr) {
           const parsedSession = safeParse(savedSessionStr, null);
           // Backward compat
           if (!parsedSession.status) parsedSession.status = 'active';
           setSession(parsedSession);
           setParticipants(safeParse(localStorage.getItem('gs_jam_participants'), []));
           setSongs(safeParse(localStorage.getItem('gs_jam_songs'), []));
           setRatings(safeParse(localStorage.getItem('gs_jam_ratings'), []));
           setQueueIds(safeParse(localStorage.getItem('gs_jam_queue_ids'), []));
         } else {
             const newSession = { id: generateId(), date: today, status: 'active' };
             setSession(newSession as JamSession);
             localStorage.setItem('gs_jam_session', JSON.stringify(newSession));
         }
       } catch (err) {
         console.error("Local init error", err);
       }
    }
  }, [isFirebaseConnected]);

  // Load User Stash when currentUser changes
  useEffect(() => {
      if (!currentUser) {
          setMyStash([]);
          return;
      }

      if (isFirebaseConnected && isFirebaseReady()) {
          const db = getDb();
          const stashRef = ref(db, `user_caches/${currentUser.id}`);
          const unsub = onValue(stashRef, (snap) => {
              const val = snap.val();
              setMyStash(val ? Object.values(val) : []);
          });
          return () => unsub();
      } else {
          // Local Storage stash (Global for simplicity or per user in one object)
          const allCaches = safeParse(localStorage.getItem('gs_jam_user_caches'), {});
          setMyStash(allCaches[currentUser.id] || []);
      }
  }, [currentUser, isFirebaseConnected]);

  // Check Pending Recovery on Login AND Real-time Updates
  useEffect(() => {
      if (!currentUser) return;
      const userId = currentUser.id;

      if (isFirebaseConnected && isFirebaseReady()) {
          const db = getDb();
          const recoveryRef = child(ref(db), `user_recovery/${userId}`);
          
          // Listen for real-time updates (e.g., when startNewSession is clicked by admin)
          const unsub = onValue(recoveryRef, (snapshot) => {
              if (snapshot.exists()) {
                  const val = snapshot.val();
                  const songs = Object.values(val) as SongChoice[];
                  setRecoverySongs(songs);
                  setSelectedRecoveryIds(new Set(songs.map(s => s.id))); // Select all by default
                  setShowRecoveryModal(true);
              }
          });
          return () => unsub();
      } else {
          // Local storage fallback (mostly for single-user testing)
          const allPending = safeParse(localStorage.getItem('gs_jam_pending_recovery'), {});
          const userPending = allPending[userId];
          if (userPending) {
              const songs = Object.values(userPending) as SongChoice[];
              setRecoverySongs(songs);
              setSelectedRecoveryIds(new Set(songs.map(s => s.id)));
              setShowRecoveryModal(true);
          }
      }
  }, [currentUser, isFirebaseConnected]);

  // --- Write Helpers (Abstraction Layer) ---
  
  const updateData = (key: string, value: any) => {
    if (isFirebaseConnected && isFirebaseReady()) {
      const db = getDb();
      // Sanitize to remove undefined values before sending to Firebase
      const cleanValue = sanitizeForFirebase(value);
      
      if (key === 'participants' || key === 'songs' || key === 'ratings') {
         const map: any = {};
         // Use the clean array to build the map
         if (Array.isArray(cleanValue)) cleanValue.forEach((v: any) => map[v.id] = v);
         set(ref(db, key), map);
      } else {
         set(ref(db, key), cleanValue);
      }
    } else {
      localStorage.setItem(`gs_jam_${key === 'archives' ? 'archive' : key === 'queueIds' ? 'queue_ids' : key}`, JSON.stringify(value));
    }
  };

  const updateStash = (newStash: SongCacheItem[]) => {
      if (!currentUser) return;
      
      if (isFirebaseConnected && isFirebaseReady()) {
          const db = getDb();
          const map: any = {};
          newStash.forEach(s => map[s.id] = sanitizeForFirebase(s));
          set(ref(db, `user_caches/${currentUser.id}`), map);
      } else {
          const allCaches = safeParse(localStorage.getItem('gs_jam_user_caches'), {});
          allCaches[currentUser.id] = newStash;
          localStorage.setItem('gs_jam_user_caches', JSON.stringify(allCaches));
      }
      setMyStash(newStash);
  };

  const addToPendingRecovery = (userId: string, songsToSave: SongChoice[]) => {
      if (songsToSave.length === 0) return;
      const cleanSongs = sanitizeForFirebase(songsToSave);
      if (isFirebaseConnected && isFirebaseReady()) {
          const db = getDb();
          const updates: any = {};
          cleanSongs.forEach((s: any) => {
              updates[`user_recovery/${userId}/${s.id}`] = s;
          });
          update(ref(db), updates);
      } else {
          // Local storage pending recovery
          const allPending = safeParse(localStorage.getItem('gs_jam_pending_recovery'), {});
          const userPending = allPending[userId] || {};
          cleanSongs.forEach((s: any) => userPending[s.id] = s);
          allPending[userId] = userPending;
          localStorage.setItem('gs_jam_pending_recovery', JSON.stringify(allPending));
      }
  };

  const clearPendingRecovery = (userId: string) => {
      if (isFirebaseConnected && isFirebaseReady()) {
          const db = getDb();
          remove(ref(db, `user_recovery/${userId}`));
      } else {
          const allPending = safeParse(localStorage.getItem('gs_jam_pending_recovery'), {});
          delete allPending[userId];
          localStorage.setItem('gs_jam_pending_recovery', JSON.stringify(allPending));
      }
  };

  useEffect(() => { if (!isFirebaseConnected && participants.length > 0) localStorage.setItem('gs_jam_participants', JSON.stringify(participants)); }, [participants, isFirebaseConnected]);
  useEffect(() => { if (!isFirebaseConnected && songs.length > 0) localStorage.setItem('gs_jam_songs', JSON.stringify(songs)); }, [songs, isFirebaseConnected]);
  useEffect(() => { if (!isFirebaseConnected && ratings.length > 0) localStorage.setItem('gs_jam_ratings', JSON.stringify(ratings)); }, [ratings, isFirebaseConnected]);
  useEffect(() => { if (!isFirebaseConnected && queueIds.length > 0) localStorage.setItem('gs_jam_queue_ids', JSON.stringify(queueIds)); }, [queueIds, isFirebaseConnected]);


  // --- Logic Helpers ---

  // Helper to open the custom confirmation modal
  const requestConfirmation = (title: string, message: string, onConfirm: () => void, type: 'danger' | 'neutral' = 'neutral') => {
      setConfirmation({
          isOpen: true,
          title,
          message,
          onConfirm,
          type
      });
  };
  
  const startNewSession = () => {
      if (!session) return;
      
      requestConfirmation(
          "Start New Session?",
          "This will archive the current session to History and start a fresh queue for today.",
          () => {
              const archiveDate = session.date;
              const today = getLocalDate();
              
              // 1. Archive Data
              const archiveData = {
                  session,
                  participants,
                  songs,
                  ratings
              };

              // 2. Save unplayed songs to pending recovery for everyone (Current Logic Correct, now matched with Real-time listener)
              const unplayed = songs.filter(s => s.playStatus === 'not_played');
              const byUser: Record<string, SongChoice[]> = {};
              unplayed.forEach(s => {
                  if(!byUser[s.ownerUserId]) byUser[s.ownerUserId] = [];
                  byUser[s.ownerUserId].push(s);
              });
              Object.keys(byUser).forEach(uid => addToPendingRecovery(uid, byUser[uid]));
              
              // 3. Reset Data Object
              const newSession = { id: generateId(), date: today, status: 'active' };
              
              if (isFirebaseConnected && isFirebaseReady()) {
                  const db = getDb();
                  const updates: any = {};
                  
                  // Save to Archive
                  updates[`archives/${archiveDate}`] = sanitizeForFirebase(archiveData);
                  
                  // Reset Current
                  updates['session'] = newSession;
                  updates['participants'] = null; // null deletes the node
                  updates['songs'] = null;
                  updates['ratings'] = null;
                  updates['queueIds'] = null;
                  
                  update(ref(db), updates);
              } else {
                  // Local Storage logic
                  const newArchives = { ...archives, [archiveDate]: archiveData };
                  setArchives(newArchives);
                  localStorage.setItem('gs_jam_archive', JSON.stringify(newArchives));
                  
                  setSession(newSession as JamSession);
                  localStorage.setItem('gs_jam_session', JSON.stringify(newSession));
                  
                  setParticipants([]); localStorage.setItem('gs_jam_participants', '[]');
                  setSongs([]); localStorage.setItem('gs_jam_songs', '[]');
                  setRatings([]); localStorage.setItem('gs_jam_ratings', '[]');
                  setQueueIds([]); localStorage.setItem('gs_jam_queue_ids', '[]');
              }
              
              // Reset local UI states
              setParticipants([]);
              setSongs([]);
              setRatings([]);
              setQueueIds([]);
              setSession(newSession as JamSession);
          }
      );
  };

  const endSession = () => {
      if(!session) return;
      requestConfirmation(
          "End Session?",
          "Are you sure you want to end this jam session? This will close the jam for everyone.",
          () => {
              const updatedSession: JamSession = { ...session, status: 'ended' };
              setSession(updatedSession);
              updateData('session', updatedSession);
              setShowMobileMenu(false);
          },
          'danger'
      );
  };

  const reopenSession = () => {
      if(!session) return;
      const updatedSession: JamSession = { ...session, status: 'active' };
      setSession(updatedSession);
      updateData('session', updatedSession);
  };

  const leaveSession = () => {
      if (!currentUser) return;
      
      requestConfirmation(
          "Leave Session?",
          "This will remove you from the participant list and delete any songs you added that haven't been played yet. You will remain logged in.",
          () => {
              const userIdToRemove = currentUser.id;

              // 1. Identify unplayed songs to save for recovery
              const songsToRemove = songs.filter(s => s.ownerUserId === userIdToRemove && s.playStatus === 'not_played');
              addToPendingRecovery(userIdToRemove, songsToRemove);

              // 2. Remove user's unplayed songs from active queue
              const songsToKeep = songs.filter(s => s.ownerUserId !== userIdToRemove || s.playStatus !== 'not_played');
              setSongs(songsToKeep);
              updateData('songs', songsToKeep);
              
              // 3. Remove participant
              const participantsToKeep = participants.filter(p => p.userId !== userIdToRemove);
              setParticipants(participantsToKeep);
              updateData('participants', participantsToKeep);

              // 4. Rebalance queue
              const newQ = rebalanceQueue(songsToKeep, participantsToKeep, queueIds);
              setQueueIds(newQ);
              updateData('queueIds', newQ);

              // 5. Close menu but DO NOT log out (User will be redirected to Lobby by render logic)
              setShowMobileMenu(false);
          },
          'danger'
      );
  };

  const handleJoinSelection = (userName: UserName) => {
    setJoiningUser(userName);
    const now = new Date();
    const timeString = now.toTimeString().split(' ')[0]; // HH:mm:ss
    setManualArrivalTime(timeString);
  };

  // Log in ONLY (for stash management), don't join session yet
  const accessStashOnly = () => {
      if (!joiningUser) return;
      const userId = joiningUser.toLowerCase().replace(' ', '_');
      const user = { id: userId, name: joiningUser };
      setCurrentUser(user);
      setJoiningUser(null);
      setView('personal_stash');
  };

  const confirmJoin = (timeMode: 'now' | 'manual') => {
    // Determine user: Either the selected joiningUser OR the already logged in currentUser
    const userToJoin = joiningUser || (currentUser ? currentUser.name : null);
    if (!session || !userToJoin) return;
    
    const userId = userToJoin.toLowerCase().replace(' ', '_');
    const user = { id: userId, name: userToJoin };
    setCurrentUser(user);

    const existing = participants.find(p => p.userId === userId);
    if (!existing) {
      const timePart = manualArrivalTime.length === 5 ? manualArrivalTime + ':00' : manualArrivalTime;
      const arrival = timeMode === 'now' 
        ? Date.now() 
        : new Date(`${session.date}T${timePart}`).getTime();
      
      const p: JamParticipant = {
        id: generateId(),
        sessionId: session.id,
        userId,
        name: userToJoin,
        arrivalTime: arrival
      };
      
      const newParticipants = [...participants, p];
      setParticipants(newParticipants); // Optimistic
      updateData('participants', newParticipants);
      
      // Rebalance queue if the new arrival affects fair order
      const newQueue = rebalanceQueue(songs, newParticipants, queueIds);
      setQueueIds(newQueue);
      updateData('queueIds', newQueue);
    }
    setJoiningUser(null);
    setView('jam'); // Ensure we go to Jam view
  };

  const handleAddProxyParticipant = () => {
    setProxyUserToAdd('');
    const now = new Date();
    const timeString = now.toTimeString().split(' ')[0];
    setProxyArrivalTime(timeString);
    setShowAddParticipantModal(true);
  };

  const confirmProxyParticipant = () => {
    if (!session || !proxyUserToAdd) return;
    
    const userId = proxyUserToAdd.toLowerCase().replace(' ', '_');
    const existing = participants.find(p => p.userId === userId);
    
    if (!existing) {
        const timePart = proxyArrivalTime.length === 5 ? proxyArrivalTime + ':00' : proxyArrivalTime;
        const arrival = new Date(`${session.date}T${timePart}`).getTime();
        const p: JamParticipant = {
            id: generateId(),
            sessionId: session.id,
            userId,
            name: proxyUserToAdd as UserName,
            arrivalTime: arrival
        };
        const newParticipants = [...participants, p];
        setParticipants(newParticipants);
        updateData('participants', newParticipants);

        const newQueue = rebalanceQueue(songs, newParticipants, queueIds);
        setQueueIds(newQueue);
        updateData('queueIds', newQueue);
    }
    setShowAddParticipantModal(false);
  };

  const openEditParticipantModal = (p: JamParticipant) => {
      setEditingParticipant(p);
      const d = new Date(p.arrivalTime);
      const timeString = d.toTimeString().split(' ')[0];
      setEditArrivalTimeValue(timeString);
  };

  const deleteParticipant = (p: JamParticipant) => {
    requestConfirmation(
        `Remove ${p.name}?`,
        `Are you sure you want to remove ${p.name} from this session?`,
        () => {
            const newParticipants = participants.filter(x => x.id !== p.id);
            setParticipants(newParticipants);
            updateData('participants', newParticipants);

            // Rebalance queue without them
            const newQueue = rebalanceQueue(songs, newParticipants, queueIds);
            setQueueIds(newQueue);
            updateData('queueIds', newQueue);
        },
        'danger'
    );
  };

  const saveParticipantEdit = () => {
      if (!editingParticipant || !session) return;
      
      const timePart = editArrivalTimeValue.length === 5 ? editArrivalTimeValue + ':00' : editArrivalTimeValue;
      const newArrival = new Date(`${session.date}T${timePart}`).getTime();

      const newParticipants = participants.map(p => 
          p.id === editingParticipant.id ? { ...p, arrivalTime: newArrival } : p
      );
      
      setParticipants(newParticipants);
      updateData('participants', newParticipants);
      
      const newQueue = rebalanceQueue(songs, newParticipants, queueIds);
      setQueueIds(newQueue);
      updateData('queueIds', newQueue);
      
      setEditingParticipant(null);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setNewSong({ ...newSong, screenshot: reader.result as string, chordType: 'screenshot' });
      };
      reader.readAsDataURL(file);
    }
  };

  const openAddModal = () => {
    setEditingSongId(null);
    setEditingStashItemMode(false); // Reset stash edit mode
    setNewSong({ 
      title: '', artist: '', ownerId: currentUser?.id || '', 
      chordType: 'auto_search', link: '', screenshot: '', searchTerm: '' 
    });
    setSearchResults([]);
    setHasSearched(false);
    setSearchError(null);
    setManualSearchUrl('');
    setAddSongTab('search');
    setSelectedStashId(null); // Reset origin
    setShowAddSong(true);
  };

  const openEditModal = (song: SongChoice) => {
    setEditingSongId(song.id);
    setEditingStashItemMode(false); // Ensure false
    setNewSong({
      title: song.title,
      artist: song.artist,
      ownerId: song.ownerUserId,
      chordType: song.chordSourceType,
      link: song.chordLink || '',
      screenshot: song.chordScreenshotUrl || '',
      searchTerm: ''
    });
    setSearchResults([]);
    setHasSearched(false);
    setSearchError(null);
    setManualSearchUrl('');
    setAddSongTab('search');
    setSelectedStashId(null);
    setShowAddSong(true);
  };

  // Allow editing a stash item directly
  const openEditStashModal = (item: SongCacheItem) => {
      setEditingSongId(item.id); // Re-use this state ID for stash editing
      setEditingStashItemMode(true); // Flag that we are editing a stash item, not a queue item
      setNewSong({
          title: item.title,
          artist: item.artist,
          ownerId: currentUser?.id || '',
          chordType: item.chordSourceType,
          link: item.chordLink || '',
          screenshot: item.chordScreenshotUrl || '',
          searchTerm: ''
      });
      setSearchResults([]);
      setHasSearched(false);
      setSearchError(null);
      setManualSearchUrl('');
      // Force stash mode in modal logic if we are in stash view
      setShowAddSong(true);
  };

  const saveToStash = () => {
      if (!currentUser) return;
      
      let updatedStash;
      if (editingSongId) {
          // Update existing stash item
          updatedStash = myStash.map(item => item.id === editingSongId ? {
              ...item,
              title: newSong.title,
              artist: newSong.artist,
              chordSourceType: newSong.chordType as any,
              chordLink: newSong.link,
              chordScreenshotUrl: newSong.screenshot
          } : item);
      } else {
          // Create new stash item
          const newItem: SongCacheItem = {
              id: generateId(),
              userId: currentUser.id,
              title: newSong.title,
              artist: newSong.artist,
              chordSourceType: newSong.chordType as any,
              chordLink: newSong.link,
              chordScreenshotUrl: newSong.screenshot,
              createdAt: Date.now()
          };
          updatedStash = [newItem, ...myStash];
      }
      
      updateStash(updatedStash);
      
      // Navigation logic after save
      if (editingStashItemMode) {
          // If editing inside the Add Modal (stash tab), go back to list
          setEditingSongId(null);
          setEditingStashItemMode(false);
          setAddSongTab('stash');
      } else if (view === 'personal_stash') {
          setShowAddSong(false);
      } else {
          alert("Saved to your Stash!");
      }
  };

  const handleSaveSong = () => {
    // If we are in Stash View or Stash Edit Mode, "Save" means "Save to Stash"
    if (view === 'personal_stash' || editingStashItemMode) {
        saveToStash();
        return;
    }

    if (!session || !currentUser) return;
    const owner = participants.find(p => p.userId === newSong.ownerId);
    if (!owner) return;

    let updatedSongs = [...songs];

    if (editingSongId) {
      updatedSongs = songs.map(s => {
        if (s.id === editingSongId) {
          return {
            ...s,
            ownerUserId: owner.userId,
            ownerName: owner.name,
            title: newSong.title,
            artist: newSong.artist,
            chordSourceType: newSong.chordType as any,
            chordLink: newSong.link,
            chordScreenshotUrl: newSong.screenshot,
          };
        }
        return s;
      });
    } else {
      const song: SongChoice = {
        id: generateId(),
        sessionId: session.id,
        chooserUserId: currentUser.id,
        ownerUserId: owner.userId,
        ownerName: owner.name,
        title: newSong.title,
        artist: newSong.artist,
        chordSourceType: newSong.chordType as any,
        chordLink: newSong.link,
        chordScreenshotUrl: newSong.screenshot,
        submissionTime: Date.now(),
        playStatus: 'not_played',
        isStolen: false
      };
      updatedSongs.push(song);
    }

    const newQueue = rebalanceQueue(updatedSongs, participants, queueIds);
    setSongs(updatedSongs); // Optimistic
    setQueueIds(newQueue); // Optimistic
    
    updateData('songs', updatedSongs);
    updateData('queueIds', newQueue);

    // If added from Stash, remove it from Stash
    if (selectedStashId) {
        const updatedStash = myStash.filter(s => s.id !== selectedStashId);
        updateStash(updatedStash);
        setSelectedStashId(null);
    }

    setShowAddSong(false);
  };

  const selectFromStash = (item: SongCacheItem) => {
      // Pre-fill the form with Stash Item data
      setNewSong({
          title: item.title,
          artist: item.artist,
          ownerId: currentUser?.id || '',
          chordType: item.chordSourceType,
          link: item.chordLink || '',
          screenshot: item.chordScreenshotUrl || '',
          searchTerm: ''
      });
      setAddSongTab('search'); // Switch back to form view so they can review/edit before submitting
      setSelectedStashId(item.id); // Mark origin so we can delete it later
  };

  const deleteFromStash = (id: string) => {
      // Using window.confirm here is fine for stash, but let's be consistent eventually.
      // For now, keep simple for Stash as it's not the main issue.
      if(!confirm("Remove from stash?")) return;
      const updated = myStash.filter(s => s.id !== id);
      updateStash(updated);
  };

  const deleteHistorySession = (date: string) => {
    requestConfirmation(
        "Delete History?",
        `Are you sure you want to delete the records for ${date}? This cannot be undone.`,
        () => {
            const newArchives = { ...archives };
            delete newArchives[date];
            setArchives(newArchives);
            updateData('archives', newArchives);
            if (historyDate === date) setHistoryDate('');
        },
        'danger'
    );
  };

  const confirmRecovery = () => {
      if (!currentUser) return;
      const songsToRecover = recoverySongs.filter(s => selectedRecoveryIds.has(s.id));
      
      if (songsToRecover.length > 0) {
          const newStashItems: SongCacheItem[] = songsToRecover.map(s => ({
              id: generateId(),
              userId: currentUser.id,
              title: s.title,
              artist: s.artist,
              chordSourceType: s.chordSourceType,
              chordLink: s.chordLink,
              chordScreenshotUrl: s.chordScreenshotUrl,
              createdAt: Date.now()
          }));
          
          updateStash([...newStashItems, ...myStash]);
          alert(`${newStashItems.length} songs recovered to your stash.`);
      }
      
      clearPendingRecovery(currentUser.id);
      setShowRecoveryModal(false);
  };

  const toggleRecoverySelection = (id: string) => {
      const newSet = new Set(selectedRecoveryIds);
      if (newSet.has(id)) newSet.delete(id);
      else newSet.add(id);
      setSelectedRecoveryIds(newSet);
  };

  const performSearch = async () => {
    setHasSearched(true);
    setIsSearching(true);
    setSearchError(null);
    setManualSearchUrl('');
    setSearchResults([]); 

    const result = await searchChords(newSong.title, newSong.artist);
    
    if (result.success) {
        setSearchResults(result.data);
    } else {
        setSearchError(result.error || "Unknown search error");
        if (result.manualSearchUrl) setManualSearchUrl(result.manualSearchUrl);
    }
    
    setIsSearching(false);
  };

  const selectSearchResult = (result: ChordSearchResult) => {
      setNewSong({ ...newSong, link: result.url });
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (active.id !== over?.id) {
        const oldIndex = queueIds.indexOf(active.id as string);
        const newIndex = queueIds.indexOf(over?.id as string);
        
        let newSongs = [...songs];
        const draggedSong = newSongs.find(s => s.id === active.id);
        
        if (draggedSong && !draggedSong.isStolen) {
             newSongs = newSongs.map(s => s.id === active.id ? { ...s, isStolen: true } : s);
             setSongs(newSongs);
             updateData('songs', newSongs);
        }

        const newQ = arrayMove(queueIds, oldIndex, newIndex);
        setQueueIds(newQ);
        updateData('queueIds', newQ);
    }
  };

  const updateStatus = (id: string, status: 'playing' | 'played') => {
    const updatedSongs = songs.map(s => {
      if (s.id === id) {
        if (status === 'playing') return { ...s, playStatus: 'playing' } as SongChoice;
        if (status === 'played') return { ...s, playStatus: 'played', playedAt: Date.now() } as SongChoice;
      }
      if (status === 'playing' && s.playStatus === 'playing') return { ...s, playStatus: 'not_played' } as SongChoice; 
      return s;
    });

    setSongs(updatedSongs);
    updateData('songs', updatedSongs);

    if (status === 'played') {
        const song = songs.find(s => s.id === id);
        if (song) setShowRatingModal({ ...song, playStatus: 'played' });
        
        const newQ = queueIds.filter(qid => qid !== id);
        setQueueIds(newQ);
        updateData('queueIds', newQ);
    }
  };

  const reviveSong = (id: string) => {
      const updatedSongs = songs.map(s => s.id === id ? { ...s, playStatus: 'not_played', isStolen: false, playedAt: undefined } as SongChoice : s);
      setSongs(updatedSongs);
      updateData('songs', updatedSongs);
      
      const newRatings = ratings.filter(r => r.songChoiceId !== id);
      setRatings(newRatings);
      updateData('ratings', newRatings);

      setTimeout(() => {
          const newQ = rebalanceQueue(updatedSongs, participants, queueIds);
          setQueueIds(newQ);
          updateData('queueIds', newQ);
      }, 50);
  };

  const unstealSong = (id: string) => {
    const updatedSongs = songs.map(s => s.id === id ? { ...s, isStolen: false } : s);
    setSongs(updatedSongs);
    updateData('songs', updatedSongs);

    const newQ = rebalanceQueue(updatedSongs, participants, queueIds);
    setQueueIds(newQ);
    updateData('queueIds', newQ);
  };

  const deleteSong = (id: string) => {
      const updatedSongs = songs.filter(s => s.id !== id);
      setSongs(updatedSongs);
      updateData('songs', updatedSongs);
      
      const newQ = queueIds.filter(qid => qid !== id);
      setQueueIds(newQ);
      updateData('queueIds', newQ);
  };

  const submitRating = (val: Rating['value']) => {
    if (!showRatingModal || !currentUser) return;
    
    const existingIdx = ratings.findIndex(r => r.songChoiceId === showRatingModal.id && r.userId === currentUser.id);
    let newRatings;

    if (existingIdx >= 0) {
        newRatings = [...ratings];
        newRatings[existingIdx] = { ...newRatings[existingIdx], value: val };
    } else {
        const rating: Rating = {
            id: generateId(),
            songChoiceId: showRatingModal.id,
            userId: currentUser.id,
            value: val
        };
        newRatings = [...ratings, rating];
    }
    
    setRatings(newRatings);
    updateData('ratings', newRatings);
    setShowRatingModal(null);
  };

  // --- Stats Aggregation ---
  const globalDataset = useMemo(() => {
      let allSongs = [...songs];
      let allRatings = [...ratings];
      let allParticipants = [...participants]; 
      const archivedSessions = Object.values(archives) as ArchivedSessionData[];
      archivedSessions.forEach(arch => {
          allSongs = [...allSongs, ...arch.songs];
          allRatings = [...allRatings, ...arch.ratings];
          allParticipants = [...allParticipants, ...arch.participants];
      });
      return { songs: allSongs, ratings: allRatings, participants: allParticipants };
  }, [songs, ratings, participants, archives]);

  const activeViewDataset = useMemo(() => {
      if (statsTab === 'history' && historyDate && archives[historyDate]) {
          return archives[historyDate];
      }
      return { participants, songs, ratings };
  }, [statsTab, historyDate, archives, participants, songs, ratings]);

  const sessionSummary = useMemo(() => getSessionSummary(activeViewDataset.songs, activeViewDataset.ratings), [activeViewDataset]);

  const sessionDigest = useMemo(() => {
    const played = activeViewDataset.songs
      .filter(s => s.playStatus === 'played')
      .sort((a,b) => (a.playedAt || 0) - (b.playedAt || 0)); 
    return played.map(s => {
      const stats = calculateSongScore(s.id, activeViewDataset.ratings);
      return { ...s, score: stats ? stats.score : 0 };
    });
  }, [activeViewDataset]);

  const mergedTimeline = useMemo(() => {
    const arrivals = activeViewDataset.participants.map(p => ({
        type: 'arrival' as const,
        data: p,
        time: p.arrivalTime,
        id: p.id
    }));
    const songs = sessionDigest.map(s => ({
        type: 'song' as const,
        data: s,
        time: s.playedAt || 0,
        id: s.id
    }));
    return [...arrivals, ...songs].sort((a, b) => a.time - b.time);
  }, [activeViewDataset, sessionDigest]);

  const sessionLeaderboard = useMemo(() => getLeaderboard(activeViewDataset.songs, activeViewDataset.ratings), [activeViewDataset]);
  const sessionThieves = useMemo(() => getBiggestThieves(activeViewDataset.songs), [activeViewDataset]);
  const sessionLanguagePreferences = useMemo(() => getLanguagePreferences(activeViewDataset.songs, activeViewDataset.ratings), [activeViewDataset]);
  const globalLeaderboard = useMemo(() => getLeaderboard(globalDataset.songs, globalDataset.ratings, leaderboardPerspective === 'all' ? undefined : leaderboardPerspective), [globalDataset, leaderboardPerspective]);
  const crowdPleasers = useMemo(() => getCrowdPleasers(globalDataset.songs, globalDataset.ratings), [globalDataset]);
  const tasteData = useMemo(() => calculateTasteSimilarity(globalDataset.ratings, globalDataset.participants), [globalDataset]);
  const globalLanguagePreferences = useMemo(() => getLanguagePreferences(globalDataset.songs, globalDataset.ratings), [globalDataset]);
  const userRatingsHistory = useMemo(() => rankingHistoryUser ? getUserRatingHistory(rankingHistoryUser, globalDataset.ratings, globalDataset.songs) : [], [rankingHistoryUser, globalDataset]);
  const userLanguageStats = useMemo(() => getUserLanguageStats(globalDataset.songs), [globalDataset]);

  const activeQueue = queueIds.map(id => songs.find(s => s.id === id)).filter(Boolean) as SongChoice[];
  const playedSongsList = songs.filter(s => s.playStatus === 'played').sort((a, b) => (a.playedAt || 0) - (b.playedAt || 0));
  const isFormValid = newSong.title && (newSong.link || newSong.screenshot);
  const isSessionOld = session && session.date !== getLocalDate();
  const isCurrentUserParticipant = participants.some(p => p.userId === currentUser?.id);

  // --- Render Dashboard Helper ---
  const renderDashboardContent = () => (
      <div className="space-y-6 animate-fade-in px-1 md:px-0">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
              <div className="bg-jam-800/50 border border-jam-700 p-3 md:p-4 rounded-2xl flex flex-col items-center justify-center">
                  <div className="text-jam-400 text-[10px] md:text-xs font-bold uppercase tracking-wider mb-1">Total Songs</div>
                  <div className="text-2xl md:text-3xl font-bold text-white">{sessionSummary.totalSongs}</div>
              </div>
              <div className="bg-jam-800/50 border border-jam-700 p-3 md:p-4 rounded-2xl flex flex-col items-center justify-center">
                  <div className="text-jam-400 text-[10px] md:text-xs font-bold uppercase tracking-wider mb-1">Duration</div>
                  <div className="text-2xl md:text-3xl font-bold text-white">{sessionSummary.totalDurationMin} <span className="text-xs md:text-sm font-normal text-jam-500">min</span></div>
              </div>
              <div className="bg-jam-800/50 border border-jam-700 p-3 md:p-4 rounded-2xl flex flex-col items-center justify-center relative overflow-hidden">
                  <div className="text-jam-400 text-[10px] md:text-xs font-bold uppercase tracking-wider mb-1">Vibe Score</div>
                  <div className="text-2xl md:text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-orange-400 to-yellow-400">{sessionSummary.vibeScore}</div>
                  <Activity className="absolute bottom-1 right-1 md:bottom-2 md:right-2 text-jam-700 opacity-20 w-8 h-8 md:w-10 md:h-10" />
              </div>
              <div className="hidden md:block">
                  <LanguageBalanceCard languages={sessionSummary.languages} />
              </div>
          </div>
          <div className="md:hidden">
             <LanguageBalanceCard languages={sessionSummary.languages} />
          </div>

          <div className="bg-jam-800/50 border border-jam-700 rounded-2xl p-4 md:p-6">
              <h3 className="text-base md:text-lg font-bold text-white mb-6 flex items-center gap-2">
                  <Activity className="text-orange-500" size={18} /> Session Timeline
              </h3>
              <div className="relative border-l border-jam-700 ml-2 md:ml-3 space-y-6 pb-2">
                  {mergedTimeline.map((item, idx) => {
                      if (item.type === 'arrival') {
                          const p = item.data as JamParticipant;
                          return (
                              <div key={idx} className="relative pl-5 md:pl-6">
                                  <div className="absolute -left-[4.5px] md:-left-[5px] top-1 w-2 h-2 md:w-2.5 md:h-2.5 rounded-full bg-blue-500 ring-4 ring-jam-950"></div>
                                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-0.5">
                                      <div className="text-[10px] md:text-xs font-mono text-jam-500">
                                          {new Date(item.time).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                                      </div>
                                      <div className="flex-1 sm:ml-4 text-xs md:text-sm text-blue-300">
                                          <span className="font-bold text-white">{p.name}</span> arrived
                                      </div>
                                  </div>
                              </div>
                          );
                      } else {
                          const s = item.data as any;
                          return (
                              <div key={idx} className="relative pl-5 md:pl-6">
                                  <div className="absolute -left-[4.5px] md:-left-[5px] top-1 w-2 h-2 md:w-2.5 md:h-2.5 rounded-full bg-green-500 ring-4 ring-jam-950"></div>
                                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-0.5">
                                      <div className="text-[10px] md:text-xs font-mono text-jam-500">
                                          {new Date(item.time).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                                      </div>
                                      <div className="flex-1 sm:ml-4 bg-jam-900/50 p-2 md:p-3 rounded-lg border border-jam-800">
                                          <div className="font-bold text-white text-[13px] md:text-sm truncate">{s.title}</div>
                                          <div className="flex items-center justify-between mt-1">
                                              <div className="text-[10px] md:text-xs text-jam-400 truncate pr-2">{s.artist} • {s.ownerName}</div>
                                              {s.score > 0 && (
                                                  <div className="text-[9px] md:text-xs font-bold text-green-400 bg-green-900/20 px-1.5 py-0.5 rounded border border-green-900/30 shrink-0">
                                                      {s.score} pts
                                                  </div>
                                              )}
                                          </div>
                                      </div>
                                  </div>
                              </div>
                          );
                      }
                  })}
                  {mergedTimeline.length === 0 && <div className="text-jam-500 text-xs md:text-sm italic pl-6">Nothing happened yet.</div>}
              </div>
          </div>
          
          <div className="bg-jam-800/50 border border-jam-700 rounded-2xl p-4 md:p-6">
              <h3 className="text-base md:text-lg font-bold text-white mb-6 flex items-center gap-2">
                   <Trophy className="text-yellow-500" size={18} /> Top Rated (Session)
              </h3>
              <div className="space-y-3">
                  {sessionLeaderboard.slice(0, 5).map((item, idx) => (
                       <div key={item.song.id} className="flex items-center gap-3 md:gap-4 p-2.5 md:p-3 bg-jam-900/50 border border-jam-800 rounded-xl">
                           <div className={`text-base md:text-lg font-bold w-5 md:w-6 text-center ${idx===0 ? 'text-yellow-400' : idx===1 ? 'text-gray-300' : idx===2 ? 'text-orange-400' : 'text-jam-600'}`}>{idx+1}</div>
                           <div className="flex-1 min-w-0">
                               <div className="font-bold text-white text-[13px] md:text-sm truncate">{item.song.title}</div>
                               <div className="text-[10px] md:text-xs text-jam-400 truncate">{item.song.ownerName}</div>
                           </div>
                           <div className="font-mono font-bold text-green-400 text-sm md:text-base">{item.score}</div>
                       </div>
                  ))}
                  {sessionLeaderboard.length === 0 && <div className="text-jam-500 italic text-xs md:text-sm">No ratings yet.</div>}
              </div>
          </div>

          {sessionThieves.length > 0 && (
              <div className="bg-jam-800/50 border border-jam-700 rounded-2xl p-4 md:p-6">
                  <h3 className="text-base md:text-lg font-bold text-white mb-6 flex items-center gap-2">
                       <Flame className="text-red-500" size={18} /> Biggest Thieves
                  </h3>
                  <div className="space-y-2">
                      {sessionThieves.map((t, idx) => (
                          <div key={idx} className="flex items-center justify-between p-2 rounded hover:bg-jam-800 transition-colors">
                              <span className="text-white text-sm font-medium">{t.name}</span>
                              <span className="text-red-400 text-sm font-bold">{t.count} steals</span>
                          </div>
                      ))}
                  </div>
              </div>
          )}

          <LanguageLoversSection preferences={sessionLanguagePreferences} titleSuffix="(Session)" />
      </div>
  );

  // --- Session Ended Overlay ---
  if (session && session.status === 'ended' && currentUser && view === 'jam') {
      return (
          <div className="fixed inset-0 z-50 bg-gradient-to-br from-purple-900 via-jam-900 to-orange-900 flex flex-col items-center justify-center text-center p-6 animate-fade-in">
              <div className="animate-pulse-glow p-8 rounded-full bg-white/5 border border-white/10 mb-8 backdrop-blur-lg">
                  <Music size={80} className="text-white" />
              </div>
              <p className="text-lg md:text-xl text-jam-300 font-medium mb-4 uppercase tracking-widest opacity-80">
                  JAM SESSION IS OVER
              </p>
              <h1 className="text-3xl md:text-6xl font-black text-transparent bg-clip-text bg-gradient-to-r from-orange-400 to-purple-400 mb-12 tracking-tight animate-bounce">
                  Now get up and dance! 💃🕺
              </h1>
              
              <div className="flex flex-col gap-4 w-full max-w-sm">
                  <Button variant="secondary" onClick={reopenSession} className="bg-white/10 hover:bg-white/20 border-white/20 text-white w-full">
                      <Undo2 size={18} /> Reopen Session
                  </Button>
                  <Button variant="primary" onClick={startNewSession} className="w-full">
                      <Plus size={18} /> Start New Session
                  </Button>
                  <Button variant="secondary" onClick={() => setView('personal_stash')} className="w-full bg-jam-800 border-jam-700 hover:bg-jam-700 text-jam-300">
                      <Bookmark size={18} /> Manage My Stash
                  </Button>
                  {isCurrentUserParticipant ? (
                      <Button variant="ghost" onClick={leaveSession} className="w-full text-jam-400 hover:text-white">
                          <LogOut size={18} /> Leave Session
                      </Button>
                  ) : (
                      <Button variant="ghost" onClick={() => setCurrentUser(null)} className="w-full text-jam-400 hover:text-white">
                          <LogOut size={18} /> Logout
                      </Button>
                  )}
              </div>
              
              <Modal isOpen={confirmation.isOpen} onClose={() => setConfirmation({...confirmation, isOpen: false})} title={confirmation.title}>
                  <div className="text-center space-y-6">
                      <div className="mx-auto w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center text-red-500">
                          <AlertTriangle size={32} />
                      </div>
                      <p className="text-jam-200">{confirmation.message}</p>
                      <div className="flex gap-3">
                          <Button variant="secondary" onClick={() => setConfirmation({...confirmation, isOpen: false})} className="flex-1">
                              Cancel
                          </Button>
                          <Button 
                              variant={confirmation.type === 'danger' ? 'danger' : 'primary'} 
                              onClick={() => { confirmation.onConfirm(); setConfirmation({...confirmation, isOpen: false}); }} 
                              className={`flex-1 ${confirmation.type === 'danger' ? 'bg-red-600 hover:bg-red-500 text-white border-red-500' : ''}`}
                          >
                              Confirm
                          </Button>
                      </div>
                  </div>
              </Modal>
          </div>
      );
  }

  // --- Render (Logged Out) ---
  if (!currentUser) {
      if (joiningUser) {
        return (
          <div className="min-h-screen flex items-center justify-center bg-jam-950 p-6">
            <div className="bg-jam-800 p-8 rounded-2xl border border-jam-700 shadow-2xl w-full max-w-md animate-fade-in">
               <button onClick={() => setJoiningUser(null)} className="flex items-center gap-2 text-jam-400 hover:text-white mb-6">
                 <ArrowLeft size={16} /> Back
               </button>
               <h2 className="text-2xl font-bold mb-2 text-white">Hi, {joiningUser} 👋</h2>
               <p className="text-jam-400 mb-6">What would you like to do?</p>
               <div className="space-y-4">
                  <Button variant="primary" className="w-full py-4 text-lg" onClick={() => confirmJoin('now')} disabled={!session}>
                    {session ? <><Clock size={24} /> Join Session</> : "Loading..."}
                  </Button>
                  
                  <div className="relative py-2">
                    <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-jam-700"></div></div>
                    <div className="relative flex justify-center text-xs uppercase"><span className="bg-jam-800 px-3 text-jam-500 font-medium">Or</span></div>
                  </div>
  
                  <Button variant="secondary" onClick={accessStashOnly} className="w-full py-3 bg-jam-900 border-jam-700 hover:bg-jam-800 text-jam-300">
                      <Bookmark size={18} /> Manage My Stash (Offline)
                  </Button>
  
                  <button onClick={() => confirmJoin('manual')} className="text-xs text-jam-500 underline hover:text-jam-400 mt-4 mx-auto block">
                      Join with specific arrival time
                  </button>
               </div>
            </div>
          </div>
        );
      }
      return (
        <div className="min-h-screen flex items-center justify-center bg-jam-950 p-4 md:p-6">
          <div className="bg-jam-800 p-6 md:p-8 rounded-2xl border border-jam-700 shadow-2xl w-full max-w-md relative overflow-hidden">
            {/* Status Indicator */}
            <div className="absolute top-4 right-4 flex items-center gap-2">
              {isFirebaseConnected ? (
                 <span className="flex items-center gap-1.5 text-green-400 text-[10px] font-bold uppercase tracking-wider bg-green-500/10 px-2 py-1 rounded-full border border-green-500/20" title="Data saved to Database">
                   <Database size={10} /> Online
                 </span>
              ) : (
                 <span className="flex items-center gap-1.5 text-jam-400 text-[10px] font-bold uppercase tracking-wider bg-jam-700 px-2 py-1 rounded-full border border-jam-600" title="Data saved to Browser only">
                   <Database size={10} /> Local
                 </span>
              )}
            </div>
            
            <div className="text-center mb-6 md:mb-8">
              <div className="inline-block p-3 md:p-4 bg-orange-500/10 rounded-full mb-4 border border-orange-500/20"><Guitar size={40} className="text-orange-500 md:w-12 md:h-12" /></div>
              <h1 className="text-2xl md:text-3xl font-bold text-white mb-1">GS Jam</h1>
              <p className="text-xs md:text-sm text-jam-400">Select your name to start</p>
            </div>
            <div className="grid grid-cols-2 gap-2 md:gap-3 max-h-60 overflow-y-auto mb-6 pr-1 scrollbar-thin scrollbar-thumb-jam-600">
              {ALL_USERS.map(u => (
                <button key={u} onClick={() => handleJoinSelection(u)} className="bg-jam-700/50 hover:bg-orange-600 hover:text-white p-2.5 md:p-3 rounded-lg text-xs md:text-sm font-medium transition-all text-left text-jam-200 border border-transparent hover:border-orange-500/50 truncate">
                  {u}
                </button>
              ))}
            </div>
            <div className="text-center text-[10px] text-jam-500">
              Current Session: <span className="text-jam-300 font-mono">{session?.date || getLocalDate()}</span>
            </div>
  
            {session && (
              <div className="mt-6 md:mt-8 pt-6 border-t border-jam-700 w-full">
                  <h3 className="text-jam-400 text-[10px] font-bold uppercase mb-3 text-center">Current Session</h3>
                  {session.status === 'ended' ? (
                      <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 md:p-4 text-center">
                          <div className="text-red-400 text-sm font-bold mb-1">Session Ended</div>
                          <div className="text-[10px] text-jam-400">Join to reopen if needed</div>
                      </div>
                  ) : (
                      <div className="bg-jam-900/50 rounded-xl p-3 md:p-4 space-y-2 md:space-y-3">
                          <div className="flex justify-between items-center text-xs md:text-sm">
                              <span className="text-jam-300">Participants</span>
                              <span className="text-white font-bold">{participants.length}</span>
                          </div>
                          <div className="flex justify-between items-center text-xs md:text-sm">
                              <span className="text-jam-300">In Queue</span>
                              <span className="text-white font-bold">{queueIds.length}</span>
                          </div>
                          <div className="flex justify-between items-center text-xs md:text-sm">
                              <span className="text-jam-300">Played</span>
                              <span className="text-white font-bold">{songs.filter(s => s.playStatus === 'played').length}</span>
                          </div>
                      </div>
                  )}
              </div>
            )}
          </div>
        </div>
      );
  }

  const isParticipant = participants.some(p => p.userId === currentUser.id);
  
  if (!isParticipant && view !== 'personal_stash') {
      return (
          <div className="min-h-screen flex items-center justify-center bg-jam-950 p-6">
              <div className="bg-jam-800 p-8 rounded-2xl border border-jam-700 shadow-2xl w-full max-w-md animate-fade-in text-center">
                  <div className="mx-auto w-16 h-16 md:w-20 md:h-20 bg-jam-700 rounded-full flex items-center justify-center mb-6 border border-jam-600">
                      <UserPlus size={32} className="text-jam-400 md:w-10 md:h-10" />
                  </div>
                  <h2 className="text-xl md:text-2xl font-bold text-white mb-2">Welcome back, {currentUser.name}</h2>
                  <p className="text-sm md:text-base text-jam-400 mb-8">You are not currently part of the active session.</p>
                  
                  <div className="space-y-4">
                      <Button variant="primary" className="w-full py-4 text-lg" onClick={() => confirmJoin('now')} disabled={!session || session.status === 'ended'}>
                          {session && session.status === 'active' ? 'Join Session' : 'Waiting for Session...'}
                      </Button>
                      <Button variant="secondary" onClick={() => setView('personal_stash')} className="w-full">
                          <Bookmark size={18} /> Manage My Stash
                      </Button>
                      <button onClick={() => setCurrentUser(null)} className="text-jam-500 hover:text-jam-300 text-[11px] md:text-sm font-bold uppercase tracking-wider mt-4">
                          Log Out
                      </button>
                  </div>
                  
                  <Modal isOpen={showRecoveryModal} onClose={() => setShowRecoveryModal(false)} title="Recover Songs?">
                      <div className="space-y-4 text-left">
                          <p className="text-xs md:text-sm text-jam-300">
                              We found <strong>{recoverySongs.length}</strong> songs from a previous session that weren't played. 
                              Would you like to save them to your stash?
                          </p>
                          
                          <div className="max-h-[300px] overflow-y-auto space-y-2 pr-1 scrollbar-thin scrollbar-thumb-jam-600 bg-jam-900/50 p-2 rounded-xl border border-jam-800">
                              {recoverySongs.map(song => {
                                  const isSelected = selectedRecoveryIds.has(song.id);
                                  return (
                                      <div 
                                          key={song.id} 
                                          onClick={() => toggleRecoverySelection(song.id)}
                                          className={`flex items-center gap-3 p-2.5 md:p-3 rounded-lg border cursor-pointer transition-colors ${isSelected ? 'bg-orange-600/10 border-orange-500' : 'bg-jam-800 border-jam-700 hover:border-jam-600'}`}
                                      >
                                          <div className={`text-orange-500 ${isSelected ? 'opacity-100' : 'opacity-30'}`}>
                                              {isSelected ? <CheckSquare size={18} /> : <Square size={18} />}
                                          </div>
                                          <div className="flex-1 min-w-0">
                                              <div className={`font-bold text-xs md:text-sm ${isSelected ? 'text-white' : 'text-jam-400'} truncate`}>{song.title}</div>
                                              <div className="text-[10px] md:text-xs text-jam-500 truncate">{song.artist}</div>
                                          </div>
                                      </div>
                                  );
                              })}
                          </div>

                          <div className="flex gap-3 pt-2">
                              <Button variant="secondary" onClick={() => { clearPendingRecovery(currentUser!.id); setShowRecoveryModal(false); }} className="flex-1 text-[11px]">
                                  Discard All
                              </Button>
                              <Button variant="primary" onClick={confirmRecovery} className="flex-1 text-[11px]" disabled={selectedRecoveryIds.size === 0}>
                                  Save ({selectedRecoveryIds.size})
                              </Button>
                          </div>
                      </div>
                  </Modal>
              </div>
          </div>
      );
  }

  // --- Main View (Logged In & Participant) ---

  return (
    <div className="min-h-screen bg-jam-950 text-jam-100 flex">
      {/* Sidebar (Desktop) */}
      <aside className="w-64 bg-jam-900 border-r border-jam-800 flex flex-col fixed h-full z-20 hidden md:flex">
        <div className="p-6 border-b border-jam-800">
           <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2">
             <span className="text-orange-500">GS</span> Jam
           </h1>
           <div className="mt-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${isFirebaseConnected ? 'bg-green-500' : 'bg-jam-500'} animate-pulse`}></div>
                <span className="text-xs font-bold text-jam-300 uppercase tracking-wider">{isFirebaseConnected ? 'Live Session' : 'Local Mode'}</span>
              </div>
              <div className={`text-xs font-mono ${isSessionOld ? 'text-red-400 font-bold' : 'text-jam-500'}`}>{session?.date}</div>
           </div>
        </div>
        
        {view !== 'personal_stash' ? (
            <nav className="p-4 space-y-1">
              <button onClick={() => setView('jam')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all ${view === 'jam' ? 'bg-orange-600 text-white shadow-lg shadow-orange-900/20' : 'text-jam-400 hover:text-white hover:bg-jam-800'}`}>
                <Music size={18} /> Today's Jam
              </button>
              <button onClick={() => setView('stats')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all ${view === 'stats' ? 'bg-orange-600 text-white shadow-lg shadow-orange-900/20' : 'text-jam-400 hover:text-white hover:bg-jam-800'}`}>
                <BarChart2 size={18} /> Stats & History
              </button>
            </nav>
        ) : (
            <nav className="p-4 space-y-1">
               <div className="px-4 py-3 text-xs font-bold text-jam-500 uppercase tracking-wider">
                   Offline Mode
               </div>
               <button className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium bg-jam-800 text-jam-200 cursor-default">
                   <Bookmark size={18} /> My Song Stash
               </button>
            </nav>
        )}

        {view !== 'personal_stash' && (
            <div className="flex-1 overflow-y-auto p-4">
              <div className="flex items-center justify-between mb-3 px-2">
                <h3 className="text-xs font-bold text-jam-500 uppercase tracking-wider">Participants</h3>
                <button onClick={handleAddProxyParticipant} className="text-jam-500 hover:text-orange-400 transition-colors" title="Add Participant">
                    <UserPlus size={14} />
                </button>
              </div>
              <div className="space-y-2">
                {[...participants].sort((a,b) => a.arrivalTime - b.arrivalTime).map(p => (
                  <div key={p.id} className="group flex items-center justify-between p-3 rounded-lg bg-jam-800/50 border border-jam-800 hover:border-jam-700 transition-colors">
                    <div>
                       <div className="text-sm font-medium text-white">{p.name}</div>
                       <div className="text-xs text-jam-500 flex items-center gap-1">
                         <Clock size={10} /> {new Date(p.arrivalTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                       </div>
                    </div>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => openEditParticipantModal(p)} className="p-1 text-jam-500 hover:text-white transition-colors" title="Edit Time">
                            <Pencil size={12} />
                        </button>
                        <button onClick={() => deleteParticipant(p)} className="p-1 text-jam-500 hover:text-red-400 transition-colors" title="Remove">
                            <Trash2 size={12} />
                        </button>
                    </div>
                  </div>
                ))}
                {participants.length === 0 && <div className="text-xs text-jam-600 italic px-2">No one here yet...</div>}
              </div>
            </div>
        )}

        <div className="mt-auto px-4 pb-2 space-y-2">
             {view !== 'personal_stash' && (
                 <>
                     {isCurrentUserParticipant && (
                       <button onClick={leaveSession} className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-bold uppercase tracking-wider text-jam-400 hover:text-white hover:bg-jam-800 border border-jam-800 hover:border-jam-700 transition-all">
                          <LogOut size={14} /> Leave Session
                       </button>
                     )}
                     <button onClick={endSession} className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-bold uppercase tracking-wider text-red-400 hover:text-red-300 hover:bg-red-500/10 border border-red-500/20 transition-all">
                        <StopCircle size={14} /> End Session
                     </button>
                 </>
             )}
        </div>

        <div className="p-4 border-t border-jam-800 bg-jam-900/50">
           <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-jam-500">Logged in as</span>
              <button onClick={() => setCurrentUser(null)} className="text-xs font-bold uppercase tracking-wider text-jam-400 hover:text-white flex items-center gap-1 bg-jam-800 px-2 py-1 rounded border border-jam-700 hover:bg-jam-700 transition-all">
                  <LogOut size={12} /> Logout
              </button>
           </div>
           <div className="font-bold text-white truncate">{currentUser.name}</div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 md:ml-64 p-2 md:p-8 min-h-screen max-w-full overflow-x-hidden">
        
        {/* Mobile Header */}
        <div className="md:hidden mb-4 p-2">
            <div className="flex items-center justify-between mb-3">
               <div className="font-bold text-xl text-white">GS <span className="text-orange-500">Jam</span></div>
               <div className="flex items-center gap-2">
                    {view !== 'personal_stash' && (
                        <button 
                            onClick={() => setShowManageParticipantsModal(true)} 
                            className="p-2 rounded-lg bg-jam-800 text-jam-400 hover:text-white border border-jam-700"
                        >
                            <Users size={18} />
                        </button>
                    )}
                    <button 
                        onClick={() => setShowMobileMenu(true)} 
                        className="p-2 rounded-lg bg-jam-800 text-jam-400 hover:text-white border border-jam-700"
                    >
                        <MenuIcon size={18}/>
                    </button>
               </div>
            </div>
            
            <div className="flex items-center justify-between bg-jam-800/50 p-2.5 rounded-xl border border-jam-700 mb-1">
                <div className="text-[11px] font-bold text-jam-400">User: <span className="text-white ml-1">{currentUser.name}</span></div>
                {view !== 'personal_stash' ? (
                    <div className="flex gap-1.5">
                      <button onClick={() => setView('jam')} className={`p-1 px-3 rounded-lg text-[10px] font-bold uppercase tracking-wider ${view === 'jam' ? 'bg-orange-600 text-white shadow-sm' : 'bg-jam-800 text-jam-400'}`}>Jam</button>
                      <button onClick={() => setView('stats')} className={`p-1 px-3 rounded-lg text-[10px] font-bold uppercase tracking-wider ${view === 'stats' ? 'bg-orange-600 text-white shadow-sm' : 'bg-jam-800 text-jam-400'}`}>Stats</button>
                   </div>
                ) : (
                    <div className="px-2 py-0.5 text-[10px] font-bold bg-jam-800 text-jam-300 rounded uppercase tracking-wider">Stash Mode</div>
                )}
            </div>
        </div>
        
        {isSessionOld && view !== 'personal_stash' && (
            <div className="mb-6 p-4 rounded-xl bg-orange-600/10 border border-orange-500/30 flex flex-col md:flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-orange-500/20 rounded-full text-orange-500"><Archive size={20} /></div>
                    <div>
                        <h3 className="font-bold text-white text-sm">Previous Session Active ({session?.date})</h3>
                        <p className="text-xs text-jam-400">Archive this session to history and start today's jam?</p>
                    </div>
                </div>
                <Button variant="primary" onClick={startNewSession} className="text-xs">
                    Archive & Start New Session
                </Button>
            </div>
        )}

        {!isFirebaseConnected && (
             <div className="mb-4 px-4 py-2 rounded-lg bg-jam-800 border border-jam-700 flex items-center gap-2 text-[10px] md:text-xs text-jam-400">
                <Database size={10} className="text-jam-500" />
                <span>Running in Local Mode. Set Firebase Env Vars to sync across devices.</span>
             </div>
        )}

        {view === 'personal_stash' && (
            <div className="w-full max-w-3xl mx-auto space-y-6 pb-40 animate-fade-in px-2 md:px-0">
                <div className="flex items-center justify-between">
                   <div>
                      <h2 className="text-2xl md:text-3xl font-bold text-white flex items-center gap-3">
                          My Stash <Bookmark className="text-orange-500" size={24} />
                      </h2>
                      <p className="text-jam-400 text-xs md:text-sm">Songs you want to play later. Saved just for you.</p>
                   </div>
                   <Button onClick={openAddModal} className="text-xs">
                     <Plus size={16} /> Add
                   </Button>
                </div>

                <div className="space-y-3 min-h-[200px]">
                    {myStash.length === 0 ? (
                        <div className="text-center py-12 border-2 border-dashed border-jam-800 rounded-2xl text-jam-500 bg-jam-900/20">
                            <Bookmark size={40} className="mx-auto mb-3 opacity-20" />
                            <p className="text-sm">Your stash is empty.</p>
                            <p className="text-[10px] mt-1">Add songs here to be ready for the next jam!</p>
                        </div>
                    ) : (
                        myStash.map(item => (
                            <div key={item.id} className="flex items-center gap-3 md:gap-4 p-3 md:p-4 rounded-xl border border-jam-700 bg-jam-800 hover:border-jam-600 transition-all">
                                <div className="flex-1 min-w-0">
                                    <div className="font-bold text-white text-sm md:text-base truncate">{item.title}</div>
                                    <div className="text-xs text-jam-400 truncate">{item.artist}</div>
                                    
                                    <div className="flex gap-2 mt-2">
                                         {item.chordLink && (
                                           <a href={item.chordLink} target="_blank" rel="noreferrer" className="px-1.5 py-0.5 rounded bg-jam-700/50 border border-jam-600/50 text-[10px] flex items-center gap-1 text-orange-400 hover:text-orange-300">
                                             <ExternalLink size={10} /> Link
                                           </a>
                                         )}
                                         {item.chordScreenshotUrl && (
                                           <button 
                                             onClick={() => setViewingImage(item.chordScreenshotUrl || null)}
                                             className="px-1.5 py-0.5 rounded bg-jam-700/50 border border-jam-600/50 text-[10px] flex items-center gap-1 text-blue-400 hover:text-blue-300"
                                           >
                                             <ImageIcon size={10} /> Image
                                           </button>
                                         )}
                                    </div>
                                </div>
                                <div className="flex items-center gap-1 md:gap-2">
                                    <button onClick={() => openEditStashModal(item)} className="p-2 text-jam-600 hover:text-white hover:bg-jam-700 rounded-full transition-all">
                                        <Pencil size={16} />
                                    </button>
                                    <button onClick={() => deleteFromStash(item.id)} className="p-2 text-jam-600 hover:text-red-400 hover:bg-red-500/10 rounded-full transition-all">
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        )}

        {view === 'jam' && (
          <div className="w-full max-w-3xl mx-auto space-y-4 md:space-y-6 pb-40 px-1 md:px-0">
             <div className="flex items-center justify-between">
               <div>
                  <h2 className="text-2xl md:text-3xl font-bold text-white">Queue</h2>
                  <p className="text-jam-400 text-[10px] md:text-sm">Drag to reorder • Fair by default</p>
               </div>
               <Button onClick={openAddModal} className="text-xs">
                 <Plus size={16} /> Add Song
               </Button>
             </div>

             <DndContext 
                sensors={sensors} 
                collisionDetection={closestCenter} 
                onDragEnd={handleDragEnd}
             >
               <SortableContext items={queueIds} strategy={verticalListSortingStrategy}>
                 <div className="space-y-3 min-h-[100px]">
                   {activeQueue.length === 0 ? (
                      <div className="text-center py-12 border-2 border-dashed border-jam-800 rounded-2xl text-jam-500">
                        <Music size={40} className="mx-auto mb-3 opacity-20" />
                        <p className="text-sm">Queue is empty.</p>
                        <button onClick={openAddModal} className="text-orange-500 text-xs font-bold hover:underline mt-2">Add the first one!</button>
                      </div>
                   ) : (
                      activeQueue.map((song, index) => (
                        <SortableSongItem 
                          key={song.id} 
                          song={song} 
                          index={index}
                          isCurrent={song.playStatus === 'playing'}
                          onMarkPlaying={() => updateStatus(song.id, 'playing')}
                          onMarkPlayed={() => updateStatus(song.id, 'played')}
                          onDelete={() => deleteSong(song.id)}
                          onEdit={() => openEditModal(song)}
                          onUnsteal={() => unstealSong(song.id)}
                          onViewImage={(url) => setViewingImage(url)}
                        />
                      ))
                   )}
                 </div>
               </SortableContext>
             </DndContext>

             {playedSongsList.length > 0 && (
                 <div className="mt-10 md:mt-12 pt-8 border-t border-jam-800">
                    <h3 className="text-lg md:text-xl font-bold text-white mb-4 flex items-center gap-2">
                        <History size={18} className="text-jam-500" />
                        Played Songs
                    </h3>
                    <div className="space-y-3 opacity-90">
                        {playedSongsList.map((song, index) => {
                           const userParticipant = participants.find(p => p.userId === currentUser?.id);
                           const arrivalTime = userParticipant?.arrivalTime || 0;
                           const playedAt = song.playedAt || 0;
                           const canRate = currentUser && (playedAt >= arrivalTime);
                           const userRating = ratings.find(r => r.songChoiceId === song.id && r.userId === currentUser?.id);

                           return (
                               <SortableSongItem
                                  key={song.id}
                                  song={song}
                                  index={index}
                                  isCurrent={false}
                                  onRevive={() => reviveSong(song.id)}
                                  onViewImage={(url) => setViewingImage(url)}
                                  onRate={canRate ? () => setShowRatingModal(song) : undefined}
                                  existingRatingValue={userRating?.value}
                               />
                           );
                        })}
                    </div>
                 </div>
             )}
          </div>
        )}

        {view === 'stats' && (
           <div className="w-full max-w-4xl mx-auto pb-40 px-1 md:px-0">
              <div className="flex gap-2.5 md:gap-4 mb-6 md:mb-8 overflow-x-auto pb-2 scrollbar-hide">
                 {[
                   { id: 'today', label: 'Summary', icon: Activity },
                   { id: 'history', label: 'History', icon: History },
                   { id: 'leaderboards', label: 'Ranks', icon: Trophy },
                   { id: 'taste', label: 'Taste', icon: Heart },
                 ].map(tab => (
                    <button 
                      key={tab.id}
                      onClick={() => setStatsTab(tab.id as any)}
                      className={`flex items-center gap-1.5 md:gap-2 px-3.5 md:px-5 py-2 md:py-2.5 rounded-full text-[11px] md:text-sm font-bold whitespace-nowrap transition-all border ${statsTab === tab.id ? 'bg-orange-600 border-orange-500 text-white shadow-lg' : 'bg-jam-800 border-jam-700 text-jam-400 hover:bg-jam-700 hover:text-white'}`}
                    >
                      <tab.icon size={14} className="md:w-4 md:h-4" /> {tab.label}
                    </button>
                 ))}
              </div>

              {statsTab === 'today' && renderDashboardContent()}

              {statsTab === 'history' && (
                  <div className="space-y-6 animate-fade-in">
                      <div className="flex flex-col md:flex-row items-center gap-3 md:gap-4 bg-jam-800/50 p-4 md:p-6 rounded-2xl border border-jam-700 backdrop-blur-sm">
                          <div className="flex-1 w-full">
                              <label className="text-[10px] md:text-xs font-bold text-jam-400 uppercase tracking-wider mb-2 block">Select Session Date</label>
                              <div className="relative">
                                  <select 
                                    value={historyDate} 
                                    onChange={(e) => setHistoryDate(e.target.value)}
                                    className="w-full appearance-none bg-jam-900 border border-jam-600 rounded-xl px-4 py-2.5 md:py-3 text-white outline-none focus:border-orange-500 cursor-pointer font-mono text-xs md:text-sm"
                                  >
                                      <option value="">-- Choose a session --</option>
                                      {Object.keys(archives).sort().reverse().map(date => (
                                          <option key={date} value={date}>{date}</option>
                                      ))}
                                  </select>
                                  <ChevronDown className="absolute right-4 top-2.5 md:top-3.5 text-jam-500 pointer-events-none" size={14} />
                              </div>
                          </div>
                          {historyDate && (
                              <button onClick={() => deleteHistorySession(historyDate)} className="p-2.5 md:p-3 text-jam-500 hover:text-red-400 hover:bg-red-500/10 rounded-xl border border-jam-700 hover:border-red-500/30 transition-all self-end md:self-auto">
                                  <Trash2 size={18} className="md:w-5 md:h-5" />
                              </button>
                          )}
                      </div>

                      {historyDate && (
                          <div className="border-t border-jam-800 pt-6">
                              {renderDashboardContent()}
                          </div>
                      )}
                  </div>
              )}

              {statsTab === 'leaderboards' && (
                  <div className="space-y-6 md:space-y-8 animate-fade-in">
                      <div className="relative pt-6 md:pt-10 px-2 md:px-4">
                         <h3 className="text-center font-bold text-white text-base md:text-xl mb-6 md:mb-8 uppercase tracking-widest flex items-center justify-center gap-2">
                             <Trophy size={20} className="text-yellow-500 md:w-6 md:h-6" />
                             Crowd Pleasers
                         </h3>
                         {crowdPleasers.length > 0 ? (
                             <div className="flex items-end justify-center gap-1.5 md:gap-6 mb-8">
                                 {crowdPleasers[1] && (
                                     <div className="flex flex-col items-center w-1/3 max-w-[100px] md:max-w-[120px]">
                                         <div className="text-[10px] font-bold text-jam-400 mb-1.5 truncate w-full text-center">{crowdPleasers[1].userId}</div>
                                         <div className="w-full bg-gradient-to-t from-gray-500 to-gray-400 rounded-t-lg h-20 md:h-24 flex items-end justify-center pb-2 relative shadow-lg">
                                             <div className="text-2xl md:text-3xl font-bold text-gray-800 opacity-50">2</div>
                                         </div>
                                         <div className="mt-1.5 bg-jam-800 px-2 md:px-3 py-1 rounded-full border border-gray-500/50 text-[9px] md:text-xs font-mono text-gray-300 whitespace-nowrap">
                                             {crowdPleasers[1].avgScore} pts
                                         </div>
                                     </div>
                                 )}
                                 {crowdPleasers[0] && (
                                     <div className="flex flex-col items-center w-1/3 max-w-[120px] md:max-w-[140px] z-10">
                                          <div className="text-yellow-400 mb-1.5 animate-bounce"><Star size={16} className="md:w-5 md:h-5" fill="currentColor" /></div>
                                         <div className="text-[11px] md:text-sm font-bold text-white mb-1.5 truncate w-full text-center">{crowdPleasers[0].userId}</div>
                                         <div className="w-full bg-gradient-to-t from-yellow-500 to-yellow-400 rounded-t-lg h-28 md:h-32 flex items-end justify-center pb-2 relative shadow-[0_0_30px_rgba(234,179,8,0.3)]">
                                             <div className="text-3xl md:text-4xl font-bold text-yellow-800 opacity-50">1</div>
                                         </div>
                                         <div className="mt-1.5 bg-jam-800 px-3 md:px-4 py-1 rounded-full border border-yellow-500/50 text-[10px] md:text-sm font-bold font-mono text-yellow-400 whitespace-nowrap">
                                             {crowdPleasers[0].avgScore} pts
                                         </div>
                                     </div>
                                 )}
                                 {crowdPleasers[2] && (
                                     <div className="flex flex-col items-center w-1/3 max-w-[100px] md:max-w-[120px]">
                                         <div className="text-[10px] font-bold text-jam-400 mb-1.5 truncate w-full text-center">{crowdPleasers[2].userId}</div>
                                         <div className="w-full bg-gradient-to-t from-orange-700 to-orange-600 rounded-t-lg h-14 md:h-16 flex items-end justify-center pb-2 relative shadow-lg">
                                             <div className="text-2xl md:text-3xl font-bold text-orange-900 opacity-50">3</div>
                                         </div>
                                         <div className="mt-1.5 bg-jam-800 px-2 md:px-3 py-1 rounded-full border border-orange-700/50 text-[9px] md:text-xs font-mono text-orange-400 whitespace-nowrap">
                                             {crowdPleasers[2].avgScore} pts
                                         </div>
                                     </div>
                                 )}
                             </div>
                         ) : (
                             <div className="text-center text-jam-500 italic py-6 text-xs md:text-sm">Not enough data for crowd pleasers yet.</div>
                         )}
                         <div className="border-t border-jam-800"></div>
                      </div>

                       <div className="bg-jam-800/50 border border-jam-700 rounded-2xl p-4 md:p-6">
                           <div className="flex items-center justify-between mb-5 md:mb-6">
                               <h3 className="text-base md:text-lg font-bold text-white flex items-center gap-2">
                                   <Star className="text-yellow-400" size={18} /> Hall of Fame
                               </h3>
                               <select 
                                  className="bg-jam-900 border border-jam-700 rounded-lg px-2 py-1 text-[10px] md:text-xs text-white outline-none focus:border-orange-500 max-w-[120px]"
                                  value={leaderboardPerspective}
                                  onChange={(e) => setLeaderboardPerspective(e.target.value)}
                               >
                                  <option value="all">Global Rank</option>
                                  {ALL_USERS.map(u => (
                                      <option key={u} value={u.toLowerCase().replace(' ','_')}>{u}'s Favs</option>
                                  ))}
                               </select>
                           </div>
                           <div className="space-y-2 md:space-y-3 max-h-[400px] md:max-h-[500px] overflow-y-auto pr-1 md:pr-2 scrollbar-thin scrollbar-thumb-jam-600">
                               {globalLeaderboard.length > 0 ? globalLeaderboard.map((item, idx) => (
                                   <div key={item.song.id} className="p-2.5 md:p-3 rounded-xl bg-jam-900/50 border border-jam-800 hover:border-jam-600 flex items-center gap-3 md:gap-4 transition-all">
                                       <div className={`font-bold text-base md:text-xl w-6 md:w-8 text-center ${idx < 3 ? 'text-yellow-400' : 'text-jam-700'}`}>#{idx + 1}</div>
                                       <div className="flex-1 min-w-0">
                                           <div className="font-bold text-xs md:text-sm text-white truncate">{item.song.title}</div>
                                           <div className="text-[10px] md:text-xs text-jam-400 truncate">
                                                {item.song.artist} <span className="text-jam-700">•</span> {item.song.ownerName}
                                           </div>
                                       </div>
                                       <div className="flex flex-col items-end shrink-0">
                                            <div className="font-mono font-bold text-green-400 text-sm md:text-lg">{item.score}</div>
                                            <div className="text-[8px] md:text-[9px] text-jam-500 uppercase tracking-tighter">Points</div>
                                       </div>
                                   </div>
                               )) : (
                                   <div className="text-center text-jam-500 italic py-4 text-xs md:text-sm">No songs rated yet.</div>
                               )}
                           </div>
                       </div>

                       {userLanguageStats.length > 0 && (
                          <div className="bg-jam-800/50 border border-jam-700 rounded-2xl p-4 md:p-6 overflow-hidden">
                             <h3 className="text-base md:text-lg font-bold text-white mb-5 md:mb-6 flex items-center gap-2">
                                 <Languages className="text-purple-400" size={18} /> Languages (All Time)
                             </h3>
                             <div className="overflow-x-auto -mx-4 md:-mx-0">
                                <div className="inline-block min-w-full align-middle px-4 md:px-0">
                                    <table className="min-w-full text-left">
                                    <thead>
                                        <tr className="text-jam-400 uppercase text-[9px] md:text-[10px] border-b border-jam-700">
                                            <th className="pb-3 pr-2">User</th>
                                            <th className="pb-3 text-center px-1">#</th>
                                            <th className="pb-3 text-center px-1">Heb</th>
                                            <th className="pb-3 text-center px-1">Eng</th>
                                            <th className="pb-3 min-w-[60px] md:w-32">Ratio</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-jam-800">
                                        {userLanguageStats.map(stat => (
                                            <tr key={stat.userId} className="group hover:bg-jam-900/30 transition-colors">
                                            <td className="py-2.5 md:py-3 pr-2 font-medium text-white text-[11px] md:text-sm truncate max-w-[70px] md:max-w-none">{stat.name}</td>
                                            <td className="py-2.5 md:py-3 text-center text-jam-300 text-[11px] md:text-sm px-1">{stat.total}</td>
                                            <td className="py-2.5 md:py-3 text-center text-jam-300 text-[11px] md:text-sm px-1">{stat.hebrew}</td>
                                            <td className="py-2.5 md:py-3 text-center text-jam-300 text-[11px] md:text-sm px-1">{stat.english}</td>
                                            <td className="py-2.5 md:py-3 px-1">
                                                <div className="flex h-1.5 md:h-2 rounded-full overflow-hidden w-full bg-jam-900">
                                                    <div style={{width: `${stat.hebrewPct}%`}} className="bg-purple-500 shrink-0"></div>
                                                    <div style={{width: `${stat.englishPct}%`}} className="bg-blue-500 shrink-0"></div>
                                                </div>
                                            </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                    </table>
                                </div>
                             </div>
                          </div>
                       )}
                  </div>
              )}

              {statsTab === 'taste' && (
                  <div className="space-y-6 md:space-y-8 animate-fade-in">
                       <div className="bg-jam-800/50 border border-jam-700 rounded-2xl p-4 md:p-6">
                           <h3 className="text-base md:text-lg font-bold text-white mb-4 flex items-center gap-2">
                               <History className="text-blue-400" size={18} /> Voter History
                           </h3>
                           <div className="mb-4">
                               <label className="text-[10px] md:text-xs font-bold text-jam-400 uppercase tracking-wider mb-2 block">See ratings by:</label>
                               <div className="relative">
                                  <select 
                                    className="w-full appearance-none bg-jam-900 border border-jam-600 rounded-xl px-4 py-2.5 md:py-3 text-white outline-none focus:border-orange-500 cursor-pointer text-xs md:text-sm"
                                    value={rankingHistoryUser}
                                    onChange={(e) => setRankingHistoryUser(e.target.value)}
                                  >
                                      <option value="">Select a user...</option>
                                      {ALL_USERS.map(u => (
                                          <option key={u} value={u.toLowerCase().replace(' ','_')}>{u}</option>
                                      ))}
                                  </select>
                                  <ChevronDown className="absolute right-4 top-2.5 md:top-3.5 text-jam-500 pointer-events-none" size={14} />
                               </div>
                           </div>

                           {rankingHistoryUser && (
                               <div className="space-y-2 max-h-[350px] md:max-h-[400px] overflow-y-auto pr-1 md:pr-2 scrollbar-thin scrollbar-thumb-jam-600">
                                   {userRatingsHistory.length > 0 ? (
                                       userRatingsHistory.map((item, idx) => (
                                           <div key={idx} className="bg-jam-900/50 p-2.5 md:p-3 rounded-lg border border-jam-800 flex items-center justify-between">
                                                <div className="flex-1 min-w-0 mr-3">
                                                    <div className="text-xs md:text-sm font-bold text-white truncate">{item.songTitle}</div>
                                                    <div className="text-[10px] md:text-xs text-jam-400 truncate">For: {item.performer}</div>
                                                </div>
                                                <div className={`shrink-0 px-1.5 md:px-2 py-0.5 md:py-1 rounded text-[9px] md:text-xs font-bold ${item.rating === 'Highlight' ? 'bg-green-500/20 text-green-400' : item.rating === 'Sababa' ? 'bg-yellow-500/20 text-yellow-400' : item.rating === 'Needs work' ? 'bg-red-500/20 text-red-400' : 'bg-jam-700 text-jam-300'}`}>
                                                    {item.rating.split(' ').pop()}
                                                </div>
                                           </div>
                                       ))
                                   ) : (
                                       <div className="text-center py-6 text-jam-500 italic text-[11px] md:text-sm">No ratings found yet.</div>
                                   )}
                               </div>
                           )}
                       </div>

                       <div className="bg-jam-800/50 border border-jam-700 rounded-2xl p-4 md:p-6">
                           <h3 className="text-base md:text-lg font-bold text-white mb-6 flex items-center gap-2">
                               <Heart className="text-red-400" size={18} /> Soulmates (All Time)
                           </h3>
                           <p className="text-[11px] md:text-sm text-jam-400 mb-6">Users with the most similar voting history.</p>
                           
                           <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 md:gap-4">
                               {tasteData.soulmates.slice(0, 6).map((pair, idx) => {
                                   const userA = ALL_USERS.find(u => u.toLowerCase().replace(' ','_') === pair.userA) || pair.userA;
                                   const userB = ALL_USERS.find(u => u.toLowerCase().replace(' ','_') === pair.userB) || pair.userB;
                                   
                                   return (
                                       <div key={idx} className="bg-jam-900/50 p-4 rounded-2xl border border-jam-700 relative overflow-hidden group">
                                            <div className="flex items-center justify-between relative z-10 mb-2 gap-1">
                                                <div className="font-bold text-white text-[13px] md:text-base truncate flex-1">{userA}</div>
                                                <Heart size={14} className="text-red-500 fill-red-500/20 shrink-0 mx-1" />
                                                <div className="font-bold text-white text-[13px] md:text-base truncate flex-1 text-right">{userB}</div>
                                            </div>
                                            <div className="flex items-end justify-between relative z-10">
                                                <div className="text-3xl md:text-4xl font-bold text-white tracking-tighter">{pair.score}%</div>
                                                <div className="text-[10px] text-jam-400 bg-jam-950 px-2 py-1 rounded-lg border border-jam-800">{pair.commonSongs} jams</div>
                                            </div>
                                            <div className="absolute bottom-0 left-0 h-1 bg-jam-800 w-full">
                                                <div className="h-full bg-gradient-to-r from-red-500 to-pink-500" style={{width: `${pair.score}%`}}></div>
                                            </div>
                                       </div>
                                   );
                               })}
                               {tasteData.soulmates.length === 0 && (
                                   <div className="col-span-full text-center py-10 text-jam-500 italic text-xs md:text-sm">
                                       No shared ratings found. Keep jamming!
                                   </div>
                               )}
                           </div>
                       </div>

                       {tasteData.opposites.length > 0 && (
                            <div className="bg-jam-800/50 border border-jam-700 rounded-2xl p-4 md:p-6">
                                <h3 className="text-base md:text-lg font-bold text-white mb-6 flex items-center gap-2">
                                    <Zap className="text-purple-400" size={18} /> Musical Opposites
                                </h3>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    {tasteData.opposites.slice(0, 4).map((pair, idx) => {
                                        const userA = ALL_USERS.find(u => u.toLowerCase().replace(' ','_') === pair.userA) || pair.userA;
                                        const userB = ALL_USERS.find(u => u.toLowerCase().replace(' ','_') === pair.userB) || pair.userB;
                                        return (
                                            <div key={idx} className="bg-jam-900/50 p-3 rounded-xl border border-jam-700 flex items-center justify-between opacity-90 transition-opacity">
                                                <div className="text-xs font-medium text-jam-300 truncate pr-2 flex-1">
                                                    {userA} & {userB}
                                                </div>
                                                <div className="text-[11px] font-bold text-purple-400 shrink-0">{pair.score}% match</div>
                                            </div>
                                        )
                                    })}
                                </div>
                            </div>
                       )}

                       <LanguageLoversSection preferences={globalLanguagePreferences} titleSuffix="(All Time)" />
                  </div>
              )}
           </div>
        )}
      </main>

      {/* --- Modals --- */}
      
      <Modal isOpen={confirmation.isOpen} onClose={() => setConfirmation({...confirmation, isOpen: false})} title={confirmation.title}>
          <div className="text-center space-y-6">
              <div className={`mx-auto w-14 h-14 md:w-16 md:h-16 rounded-full flex items-center justify-center ${confirmation.type === 'danger' ? 'bg-red-500/20 text-red-500' : 'bg-jam-700 text-jam-300'}`}>
                  <AlertTriangle size={28} className="md:w-8 md:h-8" />
              </div>
              <p className="text-xs md:text-sm text-jam-200">{confirmation.message}</p>
              <div className="flex gap-3">
                  <Button variant="secondary" onClick={() => setConfirmation({...confirmation, isOpen: false})} className="flex-1 text-xs">
                      Cancel
                  </Button>
                  <Button 
                      variant={confirmation.type === 'danger' ? 'danger' : 'primary'} 
                      onClick={() => { confirmation.onConfirm(); setConfirmation({...confirmation, isOpen: false}); }} 
                      className={`flex-1 text-xs ${confirmation.type === 'danger' ? 'bg-red-600 hover:bg-red-500 text-white border-red-500' : ''}`}
                  >
                      Confirm
                  </Button>
              </div>
          </div>
      </Modal>

      <Modal isOpen={showRecoveryModal} onClose={() => setShowRecoveryModal(false)} title="Recover Songs?">
          <div className="space-y-4">
              <p className="text-xs md:text-sm text-jam-300">
                  We found <strong>{recoverySongs.length}</strong> songs from a previous session that weren't played. 
                  Would you like to save them to your stash?
              </p>
              
              <div className="max-h-[250px] md:max-h-[300px] overflow-y-auto space-y-2 pr-1 scrollbar-thin scrollbar-thumb-jam-600 bg-jam-900/50 p-2 rounded-xl border border-jam-800">
                  {recoverySongs.map(song => {
                      const isSelected = selectedRecoveryIds.has(song.id);
                      return (
                          <div 
                              key={song.id} 
                              onClick={() => toggleRecoverySelection(song.id)}
                              className={`flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer transition-colors ${isSelected ? 'bg-orange-600/10 border-orange-500' : 'bg-jam-800 border-jam-700 hover:border-jam-600'}`}
                          >
                              <div className={`text-orange-500 ${isSelected ? 'opacity-100' : 'opacity-30'}`}>
                                  {isSelected ? <CheckSquare size={18} /> : <Square size={18} />}
                              </div>
                              <div className="flex-1 min-w-0">
                                  <div className={`font-bold text-[11px] md:text-sm ${isSelected ? 'text-white' : 'text-jam-400'} truncate`}>{song.title}</div>
                                  <div className="text-[10px] text-jam-500 truncate">{song.artist}</div>
                              </div>
                          </div>
                      );
                  })}
              </div>

              <div className="flex gap-3 pt-2">
                  <Button variant="secondary" onClick={() => { clearPendingRecovery(currentUser!.id); setShowRecoveryModal(false); }} className="flex-1 text-[11px]">
                      Discard All
                  </Button>
                  <Button variant="primary" onClick={confirmRecovery} className="flex-1 text-[11px]" disabled={selectedRecoveryIds.size === 0}>
                      Save ({selectedRecoveryIds.size})
                  </Button>
              </div>
          </div>
      </Modal>

      <Modal isOpen={showAddSong} onClose={() => setShowAddSong(false)} title={editingSongId ? (editingStashItemMode ? "Edit Stash Item" : "Edit Song") : "Add Song"}>
          {!editingSongId && (
              <div className="flex gap-2 mb-4 md:mb-6 border-b border-jam-700 pb-1">
                  <button 
                    onClick={() => setAddSongTab('search')}
                    className={`flex-1 pb-3 text-[11px] md:text-sm font-bold uppercase tracking-wider transition-colors ${addSongTab === 'search' ? 'text-orange-500 border-b-2 border-orange-500' : 'text-jam-400 hover:text-white'}`}
                  >
                      New Search
                  </button>
                  <button 
                    onClick={() => setAddSongTab('stash')}
                    className={`flex-1 pb-3 text-[11px] md:text-sm font-bold uppercase tracking-wider transition-colors ${addSongTab === 'stash' ? 'text-orange-500 border-b-2 border-orange-500' : 'text-jam-400 hover:text-white'}`}
                  >
                      From My Stash
                  </button>
              </div>
          )}

          {addSongTab === 'stash' && !editingSongId ? (
              <div className="space-y-3 max-h-[350px] md:max-h-[400px] overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-jam-600">
                  {myStash.length === 0 ? (
                      <div className="text-center py-8 text-jam-500">
                          <Bookmark className="mx-auto mb-2 opacity-50" size={32} />
                          <p className="text-xs md:text-sm">Your stash is empty.</p>
                          <button onClick={() => setAddSongTab('search')} className="text-orange-500 text-[10px] md:text-xs font-bold hover:underline mt-2">Search to add songs</button>
                      </div>
                  ) : (
                      myStash.map(item => (
                          <div key={item.id} onClick={() => selectFromStash(item)} className="p-3 bg-jam-900 border border-jam-700 hover:border-orange-500 rounded-xl cursor-pointer group transition-all relative">
                              <div className="flex justify-between items-center pr-16">
                                  <div>
                                      <div className="font-bold text-white text-xs md:text-sm truncate">{item.title}</div>
                                      <div className="text-[10px] md:text-xs text-jam-400 truncate">{item.artist}</div>
                                  </div>
                              </div>
                              <div className="absolute right-2 md:right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
                                  <button onClick={(e) => { e.stopPropagation(); openEditStashModal(item); }} className="p-1.5 text-jam-500 hover:text-white bg-jam-800 rounded-full transition-colors z-10" title="Edit">
                                      <Pencil size={12} />
                                  </button>
                                  <button onClick={(e) => { e.stopPropagation(); deleteFromStash(item.id); }} className="p-1.5 text-jam-500 hover:text-red-400 bg-jam-800 rounded-full transition-colors z-10" title="Delete">
                                      <Trash2 size={12} />
                                  </button>
                                  <div className="w-px h-5 bg-jam-700 mx-1"></div>
                                  <div className="text-orange-500 pl-0.5">
                                      <Plus size={18} />
                                  </div>
                              </div>
                          </div>
                      ))
                  )}
              </div>
          ) : (
              <div className="space-y-4">
                 <div>
                   <label className="block text-[10px] font-bold text-jam-400 mb-1 uppercase">Title</label>
                   <input className="w-full bg-jam-900 border border-jam-700 rounded-lg p-2.5 md:p-3 text-sm md:text-base text-white focus:border-orange-500 outline-none" placeholder="e.g. Wonderwall" value={newSong.title} onChange={e => { setNewSong({...newSong, title: e.target.value}); setHasSearched(false); }} />
                 </div>
                 <div>
                   <label className="block text-[10px] font-bold text-jam-400 mb-1 uppercase">Artist (Optional)</label>
                   <input className="w-full bg-jam-900 border border-jam-700 rounded-lg p-2.5 md:p-3 text-sm md:text-base text-white focus:border-orange-500 outline-none" placeholder="e.g. Oasis" value={newSong.artist} onChange={e => { setNewSong({...newSong, artist: e.target.value}); setHasSearched(false); }} />
                 </div>
                 <div>
                   <label className="block text-[10px] font-bold text-jam-400 mb-1 uppercase">Who is this for?</label>
                   <select className="w-full bg-jam-900 border border-jam-700 rounded-lg p-2.5 md:p-3 text-sm md:text-base text-white focus:border-orange-500 outline-none" value={newSong.ownerId} onChange={e => setNewSong({...newSong, ownerId: e.target.value})} disabled={view === 'personal_stash' || editingStashItemMode}>
                     {view === 'personal_stash' || editingStashItemMode ? (
                         <option value={currentUser?.id}>{currentUser?.name}</option>
                     ) : (
                         <>
                             <option value="" disabled>Select Participant</option>
                             {participants.map(p => (
                               <option key={p.userId} value={p.userId}>{p.name}</option>
                             ))}
                         </>
                     )}
                   </select>
                 </div>
                 <div className="border-t border-jam-700 pt-4">
                    <label className="block text-[10px] font-bold text-jam-400 mb-2 uppercase">Chords Source</label>
                    <div className="flex gap-1.5 mb-4 p-1 bg-jam-900 rounded-xl border border-jam-700">
                      <button onClick={() => { setNewSong({...newSong, chordType: 'auto_search'}); setHasSearched(false); }} className={`flex-1 py-2 md:py-2.5 rounded-lg text-[9px] md:text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 md:gap-2 transition-all ${newSong.chordType === 'auto_search' ? 'bg-orange-600 text-white shadow-lg' : 'text-jam-400 hover:text-white'}`}>
                        <Sparkles size={12} className="md:w-3.5 md:h-3.5" /> AI
                      </button>
                      <button onClick={() => { setNewSong({...newSong, chordType: 'link'}); setHasSearched(false); }} className={`flex-1 py-2 md:py-2.5 rounded-lg text-[9px] md:text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 md:gap-2 transition-all ${newSong.chordType === 'link' ? 'bg-orange-600 text-white shadow-lg' : 'text-jam-400 hover:text-white'}`}>
                        <LinkIcon size={12} className="md:w-3.5 md:h-3.5" /> Link
                      </button>
                      <button onClick={() => { setNewSong({...newSong, chordType: 'screenshot'}); setHasSearched(false); }} className={`flex-1 py-2 md:py-2.5 rounded-lg text-[9px] md:text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 md:gap-2 transition-all ${newSong.chordType === 'screenshot' ? 'bg-orange-600 text-white shadow-lg' : 'text-jam-400 hover:text-white'}`}>
                        <ImageIcon size={12} className="md:w-3.5 md:h-3.5" /> Image
                      </button>
                    </div>
                    {newSong.chordType === 'auto_search' && (
                      <div className="space-y-3 md:space-y-4 animate-fade-in">
                        <div className="bg-jam-900/50 p-3 md:p-4 rounded-xl border border-jam-700 text-center">
                            <p className="text-xs text-jam-300 mb-3">AI will find chords from UG, Tab4u, etc.</p>
                            <Button variant="secondary" onClick={performSearch} disabled={isSearching || !newSong.title} className="w-full text-xs">
                                {isSearching ? <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full"></div> : <><Search size={14} /> Find Chords</>}
                            </Button>
                        </div>
                        {newSong.link && (
                             <div className="p-2.5 bg-green-500/10 border border-green-500/30 rounded-lg flex items-center gap-3">
                                 <div className="p-1.5 bg-green-500/20 rounded-full text-green-400 shrink-0"><CheckCircle size={14} /></div>
                                 <div className="flex-1 min-w-0">
                                     <div className="text-[9px] md:text-[10px] font-bold text-green-400 uppercase">Selected</div>
                                     <div className="text-xs text-white truncate underline">{newSong.link}</div>
                                 </div>
                                 <button onClick={() => window.open(newSong.link, '_blank')} className="text-jam-400 hover:text-white shrink-0"><ExternalLink size={12} /></button>
                             </div>
                        )}
                        {searchError && (
                          <div className="mt-2 p-3 rounded-lg border border-red-500/30 bg-red-500/10 text-center">
                             <div className="text-red-400 text-[11px] font-bold flex items-center justify-center gap-2 mb-1.5">
                                 <ShieldAlert size={14} /> Search Failed
                             </div>
                             {manualSearchUrl && (
                                 <button onClick={() => window.open(manualSearchUrl, '_blank')} className="text-[10px] bg-jam-800 hover:bg-jam-700 text-white border border-jam-600 px-3 py-1.5 rounded-full transition-colors flex items-center gap-1 mx-auto">
                                    <Search size={10} /> Google Search
                                 </button>
                             )}
                          </div>
                        )}
                        {searchResults.length > 0 && (
                          <div className="space-y-2 mt-2">
                            {searchResults.map((result, idx) => (
                               <div key={idx} onClick={() => selectSearchResult(result)} className={`p-2.5 rounded-lg border cursor-pointer transition-colors group flex items-center gap-3 ${newSong.link === result.url ? 'bg-orange-600/10 border-orange-500' : 'bg-jam-900 border-jam-700'}`}>
                                  <div className="flex-1 min-w-0">
                                      <div className={`font-bold text-[11px] md:text-sm truncate ${newSong.link === result.url ? 'text-orange-400' : 'text-white'}`}>{result.title}</div>
                                      <div className="text-[8px] md:text-[10px] text-jam-500 uppercase font-bold truncate">{result.snippet}</div>
                                  </div>
                                  <button onClick={(e) => { e.stopPropagation(); window.open(result.url, '_blank'); }} className="p-1.5 text-jam-400 hover:text-white bg-jam-800 rounded-full shrink-0">
                                      <Eye size={14} />
                                  </button>
                               </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    {newSong.chordType === 'link' && (
                      <div className="animate-fade-in">
                          <div className="bg-jam-900 p-1 rounded-xl border border-jam-700 focus-within:border-orange-500 transition-colors flex items-center">
                              <div className="p-2 md:p-3 text-jam-500"><LinkIcon size={16} /></div>
                              <input className="flex-1 bg-transparent p-2.5 pl-0 text-xs md:text-sm text-white outline-none font-mono placeholder-jam-600" placeholder="https://..." value={newSong.link} onChange={e => setNewSong({...newSong, link: e.target.value})} />
                          </div>
                      </div>
                    )}
                    {newSong.chordType === 'screenshot' && (
                      <div className="h-48 md:h-64 border-2 border-dashed border-jam-600 rounded-xl flex flex-col items-center justify-center relative overflow-hidden bg-jam-900/50 animate-fade-in">
                        {newSong.screenshot ? (
                          <div className="relative w-full h-full p-2 flex items-center justify-center">
                             <img src={newSong.screenshot} alt="Preview" className="max-w-full max-h-full object-contain rounded-lg" />
                             <button onClick={() => setNewSong({...newSong, screenshot: ''})} className="absolute top-2 right-2 bg-red-500/80 p-1.5 rounded-full text-white shadow-lg"><Trash2 size={14} /></button>
                          </div>
                        ) : (
                          <>
                            <Upload size={24} className="text-jam-500 mb-2 md:w-8 md:h-8" />
                            <span className="text-[11px] md:text-sm text-jam-400 text-center px-4">Upload screenshot of chords</span>
                            <input type="file" accept="image/*" onChange={handleImageUpload} className="absolute inset-0 opacity-0 cursor-pointer" />
                          </>
                        )}
                      </div>
                    )}
                 </div>
                 <div className="flex gap-2 mt-4">
                     <Button className="flex-1 py-3 text-xs md:text-sm" onClick={handleSaveSong} disabled={!isFormValid}>
                        {editingSongId ? (editingStashItemMode ? 'Save Stash' : 'Save Changes') : (view === 'personal_stash' ? 'Save Stash' : 'Add to Queue')}
                     </Button>
                     {view !== 'personal_stash' && !editingSongId && (
                         <button onClick={saveToStash} disabled={!isFormValid} className="px-4 py-3 rounded-lg border border-jam-700 bg-jam-800 text-jam-300 hover:text-white disabled:opacity-50" title="Stash for later">
                             <Bookmark size={18} />
                         </button>
                     )}
                 </div>
              </div>
          )}
      </Modal>

      <Modal isOpen={!!showRatingModal} onClose={() => setShowRatingModal(null)} title="Rate this Performance">
        <div className="text-center">
           <h3 className="text-lg md:text-xl font-bold text-white mb-1 truncate">{showRatingModal?.title}</h3>
           <p className="text-xs md:text-sm text-jam-400 mb-6 truncate">by {showRatingModal?.ownerName}</p>
           <div className="grid grid-cols-1 gap-2.5 md:gap-3">
             {RATING_OPTIONS.map(option => (
               <button key={option.value} onClick={() => submitRating(option.value)} className="p-3.5 md:p-4 rounded-xl border border-jam-700 bg-jam-800 hover:bg-jam-700 transition-all flex items-center justify-center gap-3">
                 <span className={`text-base md:text-lg font-bold ${option.color}`}>{option.label}</span>
               </button>
             ))}
           </div>
        </div>
      </Modal>

      <Modal isOpen={showAddParticipantModal} onClose={() => setShowAddParticipantModal(false)} title="Add Participant">
          <div className="space-y-4">
             <div>
                <label className="block text-[10px] font-bold text-jam-400 mb-1 uppercase">Name</label>
                <select className="w-full bg-jam-900 border border-jam-700 rounded-lg p-2.5 md:p-3 text-sm md:text-base text-white focus:border-orange-500 outline-none" value={proxyUserToAdd} onChange={(e) => setProxyUserToAdd(e.target.value)}>
                    <option value="" disabled>Select Name</option>
                    {ALL_USERS.map(u => ( <option key={u} value={u}>{u}</option> ))}
                </select>
             </div>
             <div>
                <label className="block text-[10px] font-bold text-jam-400 mb-1 uppercase">Arrival Time</label>
                <input type="time" step="1" value={proxyArrivalTime} onChange={(e) => setProxyArrivalTime(e.target.value)} className="w-full bg-jam-900 border border-jam-700 rounded-lg p-2.5 md:p-3 text-sm md:text-base text-white outline-none" />
             </div>
             <Button className="w-full text-xs" onClick={confirmProxyParticipant} disabled={!proxyUserToAdd}>Add User</Button>
          </div>
      </Modal>

       <Modal isOpen={showManageParticipantsModal} onClose={() => setShowManageParticipantsModal(false)} title="Participants">
            <div className="space-y-4">
                <div className="flex justify-between items-center mb-2">
                     <p className="text-[11px] md:text-sm text-jam-400">Edit times or remove users.</p>
                     <button onClick={() => { setShowManageParticipantsModal(false); handleAddProxyParticipant(); }} className="text-orange-500 font-bold text-xs flex items-center gap-1">
                        <Plus size={14} /> Add New
                     </button>
                </div>
                <div className="space-y-2">
                    {[...participants].sort((a,b) => a.arrivalTime - b.arrivalTime).map(p => (
                        <div key={p.id} className="flex items-center justify-between p-2.5 md:p-3 rounded-lg bg-jam-900 border border-jam-800">
                            <div className="min-w-0 flex-1 pr-2">
                                <div className="text-[13px] md:text-sm font-medium text-white truncate">{p.name}</div>
                                <div className="text-[10px] text-jam-500 font-mono">{new Date(p.arrivalTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</div>
                            </div>
                            <div className="flex gap-1">
                                <button onClick={() => { setShowManageParticipantsModal(false); openEditParticipantModal(p); }} className="p-1.5 md:p-2 bg-jam-800 rounded-full text-jam-400 hover:text-white shrink-0">
                                    <Pencil size={14} />
                                </button>
                                <button onClick={() => deleteParticipant(p)} className="p-1.5 md:p-2 bg-jam-800 rounded-full text-jam-400 hover:text-red-400 shrink-0">
                                    <Trash2 size={14} />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
       </Modal>

       <Modal isOpen={showMobileMenu} onClose={() => setShowMobileMenu(false)} title="Menu">
            <div className="space-y-4">
                <button onClick={() => { setCurrentUser(null); setShowMobileMenu(false); }} className="w-full flex items-center gap-3 p-4 bg-jam-700/50 hover:bg-jam-700 rounded-xl text-white font-bold transition-all border border-jam-600">
                    <LogOut size={20} /> Log Out <span className="text-jam-400 font-normal text-xs ml-auto">Switch user</span>
                </button>
                {view !== 'personal_stash' && (
                    <button onClick={() => { setView('personal_stash'); setShowMobileMenu(false); }} className="w-full flex items-center gap-3 p-4 bg-jam-800 hover:bg-jam-700 rounded-xl text-jam-200 font-bold transition-all border border-jam-700">
                        <Bookmark size={20} /> My Song Stash
                    </button>
                )}
                {view === 'personal_stash' && session?.status === 'active' && (
                    <button onClick={() => { setView('jam'); setShowMobileMenu(false); }} className="w-full flex items-center gap-3 p-4 bg-orange-600 hover:bg-orange-500 rounded-xl text-white font-bold transition-all border border-orange-500">
                        <Music size={20} /> Return to Jam
                    </button>
                )}
                <div className="h-px bg-jam-700 my-4"></div>
                {view !== 'personal_stash' && (
                    <div className="space-y-3">
                        <p className="text-[10px] font-bold text-jam-500 uppercase tracking-wider pl-1">Session Management</p>
                        {isCurrentUserParticipant && (
                            <button onClick={leaveSession} className="w-full flex items-center gap-3 p-4 bg-jam-900 rounded-xl text-jam-300 font-medium border border-jam-800">
                                <LogOut size={20} className="text-orange-500" /> 
                                <div className="text-left">
                                    <div className="text-white font-bold text-sm">Leave Session</div>
                                    <div className="text-[9px] text-jam-500">Remove me & unplayed songs</div>
                                </div>
                            </button>
                        )}
                        <button onClick={endSession} className="w-full flex items-center gap-3 p-4 bg-red-500/10 rounded-xl text-red-300 font-medium border border-red-500/20">
                            <Power size={20} /> 
                            <div className="text-left">
                                <div className="text-red-400 font-bold text-sm">End Session</div>
                                <div className="text-[9px] text-red-300/50">Close jam for everyone</div>
                            </div>
                        </button>
                    </div>
                )}
            </div>
       </Modal>

      <Modal isOpen={!!editingParticipant} onClose={() => setEditingParticipant(null)} title="Edit Arrival Time">
          <div className="space-y-4">
             <div className="text-center text-white font-bold text-base mb-2">{editingParticipant?.name}</div>
             <div>
                <label className="block text-[10px] font-bold text-jam-400 mb-1 uppercase">Arrival Time</label>
                <input type="time" step="1" value={editArrivalTimeValue} onChange={(e) => setEditArrivalTimeValue(e.target.value)} className="w-full bg-jam-900 border border-jam-700 rounded-lg p-3 text-white focus:border-orange-500 outline-none text-center text-xl" />
             </div>
             <div className="text-[10px] text-yellow-500 bg-yellow-500/10 p-2.5 rounded-lg border border-yellow-500/20">
                Warning: Reshuffles the fair queue order immediately.
             </div>
             <Button className="w-full text-xs" onClick={saveParticipantEdit}>Update</Button>
          </div>
      </Modal>

      {viewingImage && (
        <div className="fixed inset-0 z-[60] bg-black/95 flex items-center justify-center p-4" onClick={() => setViewingImage(null)}>
           <button onClick={() => setViewingImage(null)} className="absolute top-4 right-4 text-white hover:text-orange-500 transition-colors">
              <X size={32} />
           </button>
           <img src={viewingImage} alt="Chords" className="max-w-full max-h-full object-contain rounded-lg shadow-2xl" />
        </div>
      )}
    </div>
  );
}
