
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
import { JamSession, JamParticipant, SongChoice, User, Rating, UserName, ChordSearchResult, RatingValue, SongCacheItem, ChordSourceType, PlayStatus } from './types';
import { searchChords } from './services/geminiService';
import { rebalanceQueue } from './components/QueueLogic';
import { calculateSongScore, getLeaderboard, calculateTasteSimilarity, getCrowdPleasers, getSessionSummary, getBiggestThieves, getUserRatingHistory, getUserLanguageStats, getLanguagePreferences, SessionSummary, ScoredSong, UserLanguagePreference, UserSimilarity } from './components/StatsLogic';
import { initFirebase, isFirebaseReady, getDb, ref, set, onValue, update, get, child, remove } from './services/firebase';

// --- Utility Functions ---

const safeParse = (json: string | null, fallback: any) => {
  if (!json || json === "undefined" || json === "null") return fallback;
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

// --- Components ---

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  children?: React.ReactNode;
  title: string;
  size?: 'md' | 'lg' | 'xl';
}

const Modal = ({ isOpen, onClose, children, title, size = 'md' }: ModalProps) => {
  if (!isOpen) return null;
  const sizeClasses = { md: 'max-w-lg', lg: 'max-w-3xl', xl: 'max-w-5xl h-[90vh]' };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 transition-all">
      <div className={`bg-jam-800 border border-jam-700 rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] w-full ${sizeClasses[size]} max-h-[90vh] overflow-y-auto ring-1 ring-white/10 animate-fade-in scrollbar-thin scrollbar-thumb-jam-600 flex flex-col`}>
        <div className="flex justify-between items-center p-5 border-b border-jam-700 bg-jam-800/50 sticky top-0 backdrop-blur-sm z-10 shrink-0">
          <h2 className="text-xl font-bold text-white tracking-tight truncate pr-4">{title}</h2>
          <button onClick={onClose} className="text-jam-400 hover:text-white transition-colors bg-jam-700/50 hover:bg-jam-700 rounded-full p-1"><X size={20}/></button>
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

// --- Stats Sub-components ---

const StatCard = ({ label, value, colorClass = "text-white", icon: Icon }: any) => (
  <div className="bg-jam-800/50 border border-jam-700 p-4 rounded-2xl relative overflow-hidden group">
    {Icon && <Icon className="absolute -right-2 -bottom-2 text-jam-700 opacity-20 group-hover:scale-110 transition-transform" size={48} />}
    <div className="text-jam-400 text-[10px] uppercase font-bold mb-1 tracking-wider">{label}</div>
    <div className={`text-2xl font-black ${colorClass}`}>{value}</div>
  </div>
);

const LanguageBalanceCard = ({ languages }: { languages: SessionSummary['languages'] }) => (
    <div className="bg-gradient-to-br from-jam-800 to-jam-900 border border-jam-700 rounded-2xl p-4 md:p-5 relative overflow-hidden group">
        <div className="absolute right-0 top-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity"><Languages size={64} className="text-purple-500"/></div>
        <div className="text-jam-400 text-[10px] md:text-xs font-bold uppercase tracking-wider mb-1">Language Balance</div>
        <div className="flex items-center gap-4 mt-1">
            <div>
                <div className="text-lg font-bold text-white">{languages.hebrew}</div>
                <div className="text-[9px] text-jam-500 uppercase">Hebrew</div>
            </div>
            <div className="h-8 w-px bg-jam-700"></div>
            <div>
                <div className="text-lg font-bold text-white">{languages.english}</div>
                <div className="text-[9px] text-jam-500 uppercase">Global</div>
            </div>
        </div>
        <div className="w-full bg-jam-900 h-1.5 rounded-full mt-3 overflow-hidden flex">
            <div className="h-full bg-purple-500 transition-all" style={{width: `${languages.hebrewPct}%`}}></div>
            <div className="h-full bg-blue-500 transition-all" style={{width: `${languages.englishPct}%`}}></div>
        </div>
    </div>
);

const LanguageLoversSection = ({ preferences }: { preferences: { hebrewLovers: UserLanguagePreference[], englishLovers: UserLanguagePreference[] } }) => (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-purple-900/10 border border-purple-500/20 rounded-2xl p-4">
            <h3 className="text-sm font-bold text-purple-300 mb-4 flex items-center gap-2"><Languages size={16}/> Hebrew Lovers</h3>
            <div className="space-y-2">
                {preferences.hebrewLovers.map(user => (
                    <div key={user.userId} className="flex justify-between items-center bg-jam-900/50 p-2 rounded-lg border border-purple-500/10">
                        <div className="font-bold text-xs">{user.userName}</div>
                        <div className="text-[10px] font-mono text-purple-400">{(user.hebrewRatio * 100).toFixed(0)}%</div>
                    </div>
                ))}
            </div>
        </div>
        <div className="bg-blue-900/10 border border-blue-500/20 rounded-2xl p-4">
            <h3 className="text-sm font-bold text-blue-300 mb-4 flex items-center gap-2"><Globe size={16}/> Global Lovers</h3>
            <div className="space-y-2">
                {preferences.englishLovers.map(user => (
                    <div key={user.userId} className="flex justify-between items-center bg-jam-900/50 p-2 rounded-lg border border-blue-500/10">
                        <div className="font-bold text-xs">{user.userName}</div>
                        <div className="text-[10px] font-mono text-blue-400">{((1 - user.hebrewRatio) * 100).toFixed(0)}%</div>
                    </div>
                ))}
            </div>
        </div>
    </div>
);

const SimilarityGrid = ({ soulmates, opposites }: { soulmates: UserSimilarity[], opposites: UserSimilarity[] }) => (
  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
    <div className="bg-orange-950/20 border border-orange-500/20 rounded-2xl p-4">
      <h3 className="text-sm font-bold text-orange-400 mb-4 flex items-center gap-2"><Heart size={16}/> Music Soulmates</h3>
      <div className="space-y-3">
        {soulmates.slice(0, 3).map((pair, idx) => (
          <div key={idx} className="bg-jam-900/50 p-3 rounded-xl flex items-center justify-between border border-orange-500/10">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-white">{pair.userA}</span>
              <span className="text-jam-600 text-[10px]">&</span>
              <span className="text-xs font-bold text-white">{pair.userB}</span>
            </div>
            <div className="text-orange-400 font-black text-sm">{pair.score}%</div>
          </div>
        ))}
      </div>
    </div>
    <div className="bg-jam-800/30 border border-jam-700 rounded-2xl p-4">
      <h3 className="text-sm font-bold text-jam-400 mb-4 flex items-center gap-2"><Flame size={16}/> Taste Rivals</h3>
      <div className="space-y-3">
        {opposites.slice(0, 3).map((pair, idx) => (
          <div key={idx} className="bg-jam-900/50 p-3 rounded-xl flex items-center justify-between border border-jam-700/50">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-white">{pair.userA}</span>
              <span className="text-jam-600 text-[10px]">&</span>
              <span className="text-xs font-bold text-white">{pair.userB}</span>
            </div>
            <div className="text-jam-500 font-black text-sm">{pair.score}%</div>
          </div>
        ))}
      </div>
    </div>
  </div>
);

// --- Song Item Component ---

interface SortableSongItemProps {
  song: SongChoice;
  index: number;
  onMarkPlaying?: () => void;
  onMarkPlayed?: () => void;
  onDelete?: () => void;
  onRevive?: () => void;
  onEdit?: () => void;
  onUnsteal?: () => void;
  onStash?: () => void;
  isCurrent: boolean;
  onViewImage?: (url: string) => void;
  onRate?: () => void;
  existingRatingValue?: RatingValue;
}

const SortableSongItem: React.FC<SortableSongItemProps> = ({ 
  song, onMarkPlaying, onMarkPlayed, onDelete, onRevive, onEdit, onUnsteal, onStash, isCurrent, onViewImage, onRate, existingRatingValue
}) => {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: song.id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  const isPlayed = song.playStatus === 'played';
  const getRatingDetails = (val: RatingValue) => RATING_OPTIONS.find(o => o.value === val);

  return (
    <div ref={setNodeRef} style={style} className={`relative mb-3 group ${isPlayed ? 'opacity-80' : ''}`}>
      <div className={`flex items-center gap-3 p-3 md:p-4 rounded-xl border transition-all duration-300 select-none ${isCurrent ? 'bg-jam-800 border-orange-500 shadow-[0_0_20px_rgba(249,115,22,0.15)] animate-pulse-glow' : 'bg-jam-800 border-jam-700 hover:border-jam-600'} ${isPlayed ? 'bg-jam-900 grayscale-[0.3]' : ''} ${song.isStolen ? 'border-l-4 border-l-red-500' : ''}`}>
        {!isPlayed && <div {...attributes} {...listeners} className="cursor-grab text-jam-600 hover:text-jam-400 p-1.5 -ml-1 touch-none"><GripVertical size={20} /></div>}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
             <h4 className={`font-bold truncate text-sm md:text-base ${isCurrent ? 'text-orange-400' : 'text-white'}`}>{song.title}</h4>
             {song.isStolen && <span className="text-[8px] bg-red-500/20 text-red-300 px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">Stolen</span>}
          </div>
          <p className="text-[11px] md:text-sm text-jam-400 truncate flex items-center gap-1.5">
            <span className="font-medium text-jam-300">{song.artist}</span> 
            <span className="w-1 h-1 rounded-full bg-jam-600"></span>
            <span className="text-jam-400">{song.ownerName}</span>
          </p>
          <div className="flex gap-2 mt-2">
             {song.chordLink && <a href={song.chordLink} target="_blank" rel="noreferrer" className="px-1.5 py-0.5 rounded bg-jam-700/50 border border-jam-600/50 text-[9px] md:text-xs text-orange-400 hover:bg-jam-700 transition-colors" onPointerDown={(e) => e.stopPropagation()}><ExternalLink size={10} /> Chords</a>}
             {song.chordScreenshotUrl && <button onClick={(e) => { e.stopPropagation(); if (onViewImage) onViewImage(song.chordScreenshotUrl!); }} className="px-1.5 py-0.5 rounded bg-jam-700/50 border border-jam-600/50 text-[9px] md:text-xs text-blue-400 hover:bg-jam-700 transition-colors" onPointerDown={(e) => e.stopPropagation()}><ImageIcon size={10} /> Image</button>}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {song.playStatus === 'not_played' && <button onClick={onMarkPlaying} className="p-2 text-jam-400 hover:text-orange-400 rounded-full transition-all"><Play size={18} fill="currentColor" /></button>}
          {song.playStatus === 'playing' && <button onClick={onMarkPlayed} className="p-2 text-green-400 bg-green-500/10 border border-green-500/30 rounded-full animate-pulse"><CheckCircle size={18} /></button>}
          {isPlayed && (
             existingRatingValue ? (
                <button onClick={onRate} className={`px-2 py-1 rounded-lg text-[10px] md:text-xs font-bold border ${getRatingDetails(existingRatingValue)?.color} border-current bg-jam-900/50`}>{getRatingDetails(existingRatingValue)?.label.split(' ')[1]}</button>
             ) : onRate ? (
                <button onClick={onRate} className="p-2 text-yellow-500 hover:bg-yellow-500/10 rounded-full"><Star size={16} /></button>
             ) : <div className="p-2 text-jam-700 cursor-not-allowed"><Clock size={16} /></div>
          )}
          {!isPlayed && onStash && <button onClick={onStash} className="p-1.5 text-jam-500 hover:text-orange-400 rounded-full" title="Save to Stash"><Bookmark size={14}/></button>}
          {onEdit && <button onClick={onEdit} className="p-1.5 text-jam-500 hover:text-jam-200 rounded-full"><Pencil size={14}/></button>}
          {song.isStolen && onUnsteal && <button onClick={onUnsteal} className="p-1.5 text-red-400 hover:bg-red-500/10 rounded-full" title="Undo Steal"><Undo2 size={14}/></button>}
          {isPlayed && onRevive && <button onClick={onRevive} className="p-1.5 text-jam-500 hover:text-white rounded-full"><RotateCcw size={16}/></button>}
          {!isPlayed && onDelete && <button onClick={onDelete} className="p-2 text-jam-600 hover:text-red-400 rounded-full"><Trash2 size={16}/></button>}
        </div>
      </div>
    </div>
  );
};

// --- Main App ---

export default function App() {
  // --- Basic State ---
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [session, setSession] = useState<JamSession | null>(null);
  const [participants, setParticipants] = useState<JamParticipant[]>([]);
  const [songs, setSongs] = useState<SongChoice[]>([]);
  const [ratings, setRatings] = useState<Rating[]>([]);
  const [queueIds, setQueueIds] = useState<string[]>([]); 
  const [myStash, setMyStash] = useState<SongCacheItem[]>([]);
  const [archives, setArchives] = useState<Record<string, any>>({});
  
  // UI State
  const [view, setView] = useState<'jam' | 'stats' | 'personal_stash'>('jam');
  const [statsTab, setStatsTab] = useState<'today' | 'history' | 'leaderboards' | 'taste'>('today');
  const [historyDate, setHistoryDate] = useState<string>('');
  const [showAddSong, setShowAddSong] = useState(false);
  const [editingSongId, setEditingSongId] = useState<string | null>(null); 
  const [showRatingModal, setShowRatingModal] = useState<SongChoice | null>(null);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [isFirebaseConnected, setIsFirebaseConnected] = useState(false);

  // Search/Add State
  const [newSong, setNewSong] = useState({ title: '', artist: '', ownerId: '', chordType: 'auto_search' as ChordSourceType, link: '', screenshot: '', searchTerm: '' });
  const [searchResults, setSearchResults] = useState<ChordSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // --- Persistence ---

  useEffect(() => {
    if (initFirebase(FIREBASE_CONFIG)) setIsFirebaseConnected(true);
  }, []);

  useEffect(() => {
    if (isFirebaseConnected && isFirebaseReady()) {
       const db = getDb();
       onValue(ref(db, 'session'), (snap) => setSession(snap.val() || { id: generateId(), date: getLocalDate(), status: 'active' }));
       onValue(ref(db, 'participants'), (snap) => setParticipants(snap.val() ? Object.values(snap.val()) : []));
       onValue(ref(db, 'songs'), (snap) => setSongs(snap.val() ? Object.values(snap.val()) : []));
       onValue(ref(db, 'ratings'), (snap) => setRatings(snap.val() ? Object.values(snap.val()) : []));
       onValue(ref(db, 'queueIds'), (snap) => setQueueIds(snap.val() || []));
       onValue(ref(db, 'archives'), (snap) => setArchives(snap.val() || {}));
    } else {
       setArchives(safeParse(localStorage.getItem('gs_jam_archive'), {}));
       setSession(safeParse(localStorage.getItem('gs_jam_session'), { id: generateId(), date: getLocalDate(), status: 'active' }));
       setParticipants(safeParse(localStorage.getItem('gs_jam_participants'), []));
       setSongs(safeParse(localStorage.getItem('gs_jam_songs'), []));
       setRatings(safeParse(localStorage.getItem('gs_jam_ratings'), []));
       setQueueIds(safeParse(localStorage.getItem('gs_jam_queue_ids'), []));
    }
  }, [isFirebaseConnected]);

  useEffect(() => {
      if (!currentUser) return;
      if (isFirebaseConnected && isFirebaseReady()) {
          onValue(ref(getDb(), `user_caches/${currentUser.id}`), (snap) => setMyStash(snap.val() ? Object.values(snap.val()) : []));
      } else {
          const all = safeParse(localStorage.getItem('gs_jam_user_caches'), {});
          setMyStash(all[currentUser.id] || []);
      }
  }, [currentUser, isFirebaseConnected]);

  // --- Logic Actions ---

  const updateData = (key: string, value: any) => {
    if (isFirebaseConnected && isFirebaseReady()) {
      const db = getDb();
      if (['participants', 'songs', 'ratings'].includes(key)) {
         const map: any = {};
         if (Array.isArray(value)) value.forEach((v: any) => map[v.id] = v);
         set(ref(db, key), sanitizeForFirebase(map));
      } else {
         set(ref(db, key), sanitizeForFirebase(value));
      }
    } else {
      localStorage.setItem(`gs_jam_${key === 'archives' ? 'archive' : key === 'queueIds' ? 'queue_ids' : key}`, JSON.stringify(value));
    }
  };

  const handleJoin = (userName: UserName) => {
    const userId = userName.toLowerCase().replace(' ', '_');
    setCurrentUser({ id: userId, name: userName });
    if (!participants.some(p => p.userId === userId)) {
        const p: JamParticipant = { id: generateId(), sessionId: session?.id || 'default', userId, name: userName, arrivalTime: Date.now() };
        const updated = [...participants, p];
        setParticipants(updated);
        updateData('participants', updated);
        const newQ = rebalanceQueue(songs, updated, queueIds);
        setQueueIds(newQ);
        updateData('queueIds', newQ);
    }
  };

  const handleSaveSong = (stashItem?: SongCacheItem) => {
    if (!currentUser) return;
    const ownerId = newSong.ownerId || currentUser.id;
    const owner = participants.find(p => p.userId === ownerId) || { name: currentUser.name, userId: currentUser.id };
    
    let updatedSongs = [...songs];
    if (editingSongId) {
      updatedSongs = songs.map(s => s.id === editingSongId ? { 
          ...s, ownerUserId: ownerId, ownerName: owner.name as UserName, title: newSong.title, artist: newSong.artist, 
          chordSourceType: newSong.chordType, chordLink: newSong.link, chordScreenshotUrl: newSong.screenshot 
      } : s);
    } else {
      const song: SongChoice = {
        id: generateId(), sessionId: session?.id || 'default', chooserUserId: currentUser.id, ownerUserId: ownerId, ownerName: owner.name as UserName, 
        title: stashItem?.title || newSong.title, artist: stashItem?.artist || newSong.artist, 
        chordSourceType: (stashItem?.chordSourceType || newSong.chordType), 
        chordLink: stashItem?.chordLink || newSong.link, chordScreenshotUrl: stashItem?.chordScreenshotUrl || newSong.screenshot, 
        submissionTime: Date.now(), playStatus: 'not_played', isStolen: false
      };
      updatedSongs.push(song);
    }

    const newQueue = rebalanceQueue(updatedSongs, participants, queueIds);
    setSongs(updatedSongs);
    setQueueIds(newQueue);
    updateData('songs', updatedSongs);
    updateData('queueIds', newQueue);
    setShowAddSong(false);
  };

  const updateStatus = (id: string, status: 'playing' | 'played') => {
    const updatedSongs = songs.map(s => {
      if (s.id === id) {
        if (status === 'playing') return { ...s, playStatus: 'playing' as PlayStatus };
        if (status === 'played') return { ...s, playStatus: 'played' as PlayStatus, playedAt: Date.now() };
      }
      if (status === 'playing' && s.playStatus === 'playing') return { ...s, playStatus: 'not_played' as PlayStatus }; 
      return s;
    });
    setSongs(updatedSongs);
    updateData('songs', updatedSongs);
    if (status === 'played') {
        setShowRatingModal(updatedSongs.find(s => s.id === id)!);
        const newQ = queueIds.filter(qid => qid !== id);
        setQueueIds(newQ);
        updateData('queueIds', newQ);
    }
  };

  const deleteSong = (id: string) => {
    const updated = songs.filter(s => s.id !== id);
    const newQ = queueIds.filter(qid => qid !== id);
    setSongs(updated);
    setQueueIds(newQ);
    updateData('songs', updated);
    updateData('queueIds', newQ);
    if (isFirebaseConnected) remove(ref(getDb(), `songs/${id}`));
  };

  const stashSong = (song: SongChoice) => {
    if (!currentUser) return;
    const item: SongCacheItem = { id: generateId(), userId: currentUser.id, title: song.title, artist: song.artist, chordSourceType: song.chordSourceType, chordLink: song.chordLink, chordScreenshotUrl: song.chordScreenshotUrl, createdAt: Date.now() };
    const updated = [...myStash, item];
    setMyStash(updated);
    if (isFirebaseConnected) set(ref(getDb(), `user_caches/${currentUser.id}/${item.id}`), item);
    else {
        const all = safeParse(localStorage.getItem('gs_jam_user_caches'), {});
        all[currentUser.id] = updated;
        localStorage.setItem('gs_jam_user_caches', JSON.stringify(all));
    }
  };

  const removeFromStash = (id: string) => {
    if (!currentUser) return;
    const updated = myStash.filter(s => s.id !== id);
    setMyStash(updated);
    if (isFirebaseConnected) remove(ref(getDb(), `user_caches/${currentUser.id}/${id}`));
    else {
        const all = safeParse(localStorage.getItem('gs_jam_user_caches'), {});
        all[currentUser.id] = updated;
        localStorage.setItem('gs_jam_user_caches', JSON.stringify(all));
    }
  };

  // --- DND Logic ---
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
        let newSongs = songs.map(s => s.id === active.id ? { ...s, isStolen: true } : s);
        const newQ = arrayMove(queueIds, oldIndex, newIndex);
        setSongs(newSongs);
        setQueueIds(newQ);
        updateData('songs', newSongs);
        updateData('queueIds', newQ);
    }
  };

  // --- Render Helpers ---

  const activeDataset = useMemo(() => (statsTab === 'history' && archives[historyDate]) ? archives[historyDate] : { participants, songs, ratings }, [statsTab, historyDate, archives, participants, songs, ratings]);
  const summary = useMemo(() => getSessionSummary(activeDataset.songs || [], activeDataset.ratings || []), [activeDataset]);
  const crowdPleasers = useMemo(() => getCrowdPleasers(activeDataset.songs || [], activeDataset.ratings || []), [activeDataset]);
  const taste = useMemo(() => calculateTasteSimilarity(activeDataset.ratings || [], activeDataset.participants || []), [activeDataset]);
  const langPrefs = useMemo(() => getLanguagePreferences(activeDataset.songs || [], activeDataset.ratings || []), [activeDataset]);
  const userLangStats = useMemo(() => getUserLanguageStats(activeDataset.songs || []), [activeDataset]);
  
  const timeline = useMemo(() => {
    const events = [
        ...(activeDataset.participants || []).map(p => ({ type: 'arrival', time: p.arrivalTime, name: p.name })),
        ...(activeDataset.songs || []).filter(s => s.playStatus === 'played').map(s => ({ type: 'song', time: s.playedAt || 0, title: s.title, owner: s.ownerName }))
    ].sort((a,b) => a.time - b.time);
    return events;
  }, [activeDataset]);

  const renderStatsDashboard = () => (
    <div className="space-y-8 animate-fade-in overflow-x-hidden">
        {/* Metric Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="Played" value={summary.totalSongs} icon={Music} />
            <StatCard label="Duration" value={`${summary.totalDurationMin}m`} icon={Clock} />
            <StatCard label="Vibe" value={`${summary.vibeScore}%`} colorClass="text-orange-400" icon={Activity} />
            <LanguageBalanceCard languages={summary.languages} />
        </div>

        {/* Timeline Visualizer */}
        <div className="bg-jam-800/30 border border-jam-700 rounded-2xl p-6">
            <h3 className="text-sm font-bold text-jam-400 uppercase mb-6 flex items-center gap-2 tracking-widest"><Activity size={16}/> Session Timeline</h3>
            <div className="relative border-l-2 border-jam-700 ml-3 space-y-6 pb-2">
                {timeline.map((ev, idx) => (
                    <div key={idx} className="relative pl-6">
                        <div className={`absolute -left-[9px] top-1 w-4 h-4 rounded-full ${ev.type === 'arrival' ? 'bg-blue-500' : 'bg-green-500'} ring-4 ring-jam-950`}></div>
                        <div className="flex flex-col gap-1">
                            <span className="text-[10px] font-mono text-jam-500">{new Date(ev.time).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                            <div className={`text-xs p-3 rounded-xl border ${ev.type === 'arrival' ? 'text-blue-200 border-blue-500/20 bg-blue-500/5' : 'text-white border-jam-700 bg-jam-800/50'}`}>
                                {ev.type === 'arrival' ? <span><strong>{ev.name}</strong> joined the jam</span> : <span><strong>{ev.owner}</strong> played <strong>{ev.title}</strong></span>}
                            </div>
                        </div>
                    </div>
                ))}
                {timeline.length === 0 && <div className="text-xs text-jam-600 italic pl-6">Waiting for the first riff...</div>}
            </div>
        </div>

        {/* Crowd Pleasers */}
        <div className="bg-jam-800/30 border border-jam-700 rounded-2xl p-6">
            <h3 className="text-sm font-bold text-jam-400 uppercase mb-6 flex items-center gap-2 tracking-widest"><Trophy size={16} className="text-yellow-500"/> Crowd Pleasers</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {crowdPleasers.slice(0, 6).map((cp, idx) => (
                    <div key={idx} className="bg-jam-900/50 p-4 rounded-2xl border border-jam-700 flex items-center justify-between group hover:border-orange-500/50 transition-colors">
                        <div>
                            <div className="text-xs font-bold text-white mb-1">{participants.find(p => p.userId === cp.userId)?.name || cp.userId}</div>
                            <div className="text-[10px] text-jam-500">{cp.songCount} songs played</div>
                        </div>
                        <div className="text-right">
                            <div className="text-lg font-black text-orange-400">{cp.avgScore}%</div>
                            <div className="text-[8px] text-jam-600 uppercase font-black">Avg Rating</div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    </div>
  );

  const renderLeaderboards = () => (
    <div className="space-y-8 animate-fade-in">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-jam-800/50 border border-jam-700 p-6 rounded-2xl">
                <h3 className="text-sm font-bold text-orange-400 uppercase mb-4 flex items-center gap-2"><Star size={16}/> Top Rated Tracks</h3>
                <div className="space-y-3">
                    {getLeaderboard(activeDataset.songs || [], activeDataset.ratings || []).slice(0, 10).map((s, i) => (
                        <div key={s.song.id} className="flex items-center justify-between p-3 bg-jam-900/50 rounded-xl border border-jam-700 hover:border-jam-600">
                            <div className="truncate pr-4">
                                <span className="text-jam-500 font-mono mr-3 text-xs">{(i+1).toString().padStart(2, '0')}</span>
                                <span className="font-bold text-sm text-white">{s.song.title}</span>
                                <div className="text-[10px] text-jam-500 ml-8">{s.song.ownerName}</div>
                            </div>
                            <div className="text-sm font-black text-orange-400">{s.score}</div>
                        </div>
                    ))}
                </div>
            </div>
            <div className="bg-jam-800/50 border border-jam-700 p-6 rounded-2xl">
                <h3 className="text-sm font-bold text-red-400 uppercase mb-4 flex items-center gap-2"><Flame size={16}/> Biggest Thieves</h3>
                <div className="space-y-3">
                    {getBiggestThieves(activeDataset.songs || []).slice(0, 10).map((t, i) => (
                        <div key={i} className="flex items-center justify-between p-3 bg-jam-900/50 rounded-xl border border-red-500/10 hover:border-red-500/20">
                            <div className="font-bold text-jam-100 text-sm">{t.name}</div>
                            <div className="flex items-center gap-2">
                                <span className="text-[10px] text-jam-500">Stole</span>
                                <span className="text-sm font-black text-red-400">{t.count}</span>
                                <span className="text-[10px] text-jam-500">spots</span>
                            </div>
                        </div>
                    ))}
                    {getBiggestThieves(activeDataset.songs || []).length === 0 && <div className="text-xs text-jam-600 italic text-center py-10">Pure session. No one has stolen a spot.</div>}
                </div>
            </div>
        </div>
    </div>
  );

  const renderTasteAnalysis = () => (
    <div className="space-y-8 animate-fade-in">
        <SimilarityGrid soulmates={taste.soulmates} opposites={taste.opposites} />
        <LanguageLoversSection preferences={langPrefs} />
        
        {/* Language Table */}
        <div className="bg-jam-800/30 border border-jam-700 rounded-2xl p-6 overflow-hidden">
            <h3 className="text-sm font-bold text-jam-400 uppercase mb-6 flex items-center gap-2 tracking-widest"><Languages size={16}/> User Language Stats</h3>
            <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                    <thead>
                        <tr className="text-jam-500 border-b border-jam-700">
                            <th className="pb-3 font-bold uppercase tracking-wider">Musician</th>
                            <th className="pb-3 font-bold uppercase tracking-wider">Total</th>
                            <th className="pb-3 font-bold uppercase tracking-wider">🇮🇱 Hebrew</th>
                            <th className="pb-3 font-bold uppercase tracking-wider">🌎 Global</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-jam-800">
                        {userLangStats.map((stat, i) => (
                            <tr key={i} className="hover:bg-jam-800/50">
                                <td className="py-3 font-bold text-white">{stat.name}</td>
                                <td className="py-3">{stat.total}</td>
                                <td className="py-3 text-purple-400">{stat.hebrew} <span className="text-[10px] opacity-50">({stat.hebrewPct}%)</span></td>
                                <td className="py-3 text-blue-400">{stat.english} <span className="text-[10px] opacity-50">({stat.englishPct}%)</span></td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    </div>
  );

  const renderStatsTabs = () => (
    <div className="space-y-6">
        <div className="flex gap-2 mb-6 overflow-x-auto pb-2 no-scrollbar">
            {['today', 'history', 'leaderboards', 'taste'].map(tab => (
                <button key={tab} onClick={() => setStatsTab(tab as any)} className={`px-5 py-2.5 rounded-full text-xs font-bold border whitespace-nowrap transition-all ${statsTab === tab ? 'bg-orange-600 border-orange-500 text-white shadow-lg shadow-orange-900/20' : 'bg-jam-800 border-jam-700 text-jam-400 hover:text-white'}`}>
                    {tab.charAt(0).toUpperCase() + tab.slice(1)}
                </button>
            ))}
        </div>

        {statsTab === 'today' && renderStatsDashboard()}
        
        {statsTab === 'history' && (
            <div className="space-y-6">
                <div className="relative group">
                    <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 text-jam-500 group-hover:text-orange-500 transition-colors" size={18}/>
                    <select value={historyDate} onChange={(e) => setHistoryDate(e.target.value)} className="w-full bg-jam-900 border border-jam-700 p-4 pl-12 rounded-2xl outline-none focus:border-orange-500 appearance-none text-sm font-bold">
                        <option value="">-- Choose Past Session --</option>
                        {Object.keys(archives).sort().reverse().map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                    <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 text-jam-500 pointer-events-none" size={18}/>
                </div>
                {historyDate ? renderStatsDashboard() : <div className="text-center py-20 bg-jam-900/20 border border-dashed border-jam-800 rounded-3xl text-jam-500 italic">Select a date above to browse the archives.</div>}
            </div>
        )}

        {statsTab === 'leaderboards' && renderLeaderboards()}
        {statsTab === 'taste' && renderTasteAnalysis()}
    </div>
  );

  if (!currentUser) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-jam-950 p-6">
        <div className="bg-jam-800 p-8 rounded-2xl border border-jam-700 shadow-2xl w-full max-w-md animate-fade-in text-center">
          <div className="bg-orange-500/10 p-5 rounded-full w-20 h-20 mx-auto mb-6 flex items-center justify-center border border-orange-500/20">
             <Guitar size={48} className="text-orange-500" />
          </div>
          <h1 className="text-3xl font-black mb-2 tracking-tight">GS JAM</h1>
          <p className="text-jam-400 text-sm mb-8">Musician Session Manager</p>
          <div className="grid grid-cols-2 gap-2 max-h-64 overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-jam-600">
            {ALL_USERS.map(u => (
              <button key={u} onClick={() => handleJoin(u)} className="bg-jam-700/50 hover:bg-orange-600 p-3 rounded-xl text-xs font-bold transition-all text-jam-200 hover:text-white border border-transparent hover:border-orange-500/50 truncate">
                {u}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-jam-950 text-jam-100 flex overflow-x-hidden">
      {/* Sidebar Desktop */}
      <aside className="w-64 bg-jam-900 border-r border-jam-800 hidden md:flex flex-col fixed h-full z-20">
        <div className="p-8 border-b border-jam-800"><h1 className="text-2xl font-black text-white tracking-tighter italic">GS <span className="text-orange-500">JAM</span></h1></div>
        <nav className="p-4 space-y-2 mt-4">
          <button onClick={() => setView('jam')} className={`w-full flex items-center gap-4 px-5 py-3.5 rounded-2xl text-sm font-bold transition-all ${view === 'jam' ? 'bg-orange-600 text-white shadow-lg shadow-orange-900/30' : 'text-jam-400 hover:text-white hover:bg-jam-800'}`}><Music size={20}/> Jam Queue</button>
          <button onClick={() => setView('stats')} className={`w-full flex items-center gap-4 px-5 py-3.5 rounded-2xl text-sm font-bold transition-all ${view === 'stats' ? 'bg-orange-600 text-white shadow-lg shadow-orange-900/30' : 'text-jam-400 hover:text-white hover:bg-jam-800'}`}><BarChart2 size={20}/> Insights</button>
          <button onClick={() => setView('personal_stash')} className={`w-full flex items-center gap-4 px-5 py-3.5 rounded-2xl text-sm font-bold transition-all ${view === 'personal_stash' ? 'bg-orange-600 text-white shadow-lg shadow-orange-900/30' : 'text-jam-400 hover:text-white hover:bg-jam-800'}`}><Bookmark size={20}/> Personal Stash</button>
        </nav>
        <div className="mt-auto p-4 border-t border-jam-800 bg-jam-950/50">
           <div className="flex items-center justify-between mb-2"><span className="text-[9px] text-jam-500 uppercase font-black tracking-widest">Active Member</span><button onClick={() => setCurrentUser(null)} className="p-1.5 hover:bg-red-500/10 hover:text-red-400 rounded-lg transition-colors"><LogOut size={16}/></button></div>
           <div className="font-bold text-white truncate px-1">{currentUser.name}</div>
        </div>
      </aside>

      {/* Main Container */}
      <main className="flex-1 md:ml-64 p-4 md:p-10 w-full overflow-x-hidden pb-40">
        {/* Mobile Header */}
        <div className="md:hidden flex items-center justify-between mb-8 bg-jam-800/80 p-4 rounded-2xl border border-jam-700 backdrop-blur-md sticky top-4 z-30 shadow-2xl">
             <h1 className="text-xl font-black italic tracking-tighter">GS <span className="text-orange-500">JAM</span></h1>
             <button onClick={() => setShowMobileMenu(true)} className="p-2.5 bg-jam-700 rounded-xl text-white active:scale-95 transition-transform"><MenuIcon size={24}/></button>
        </div>

        {view === 'jam' && (
           <div className="max-w-2xl mx-auto px-1 animate-fade-in">
             <div className="flex items-center justify-between mb-10">
                <h2 className="text-3xl font-black text-white tracking-tight">Queue</h2>
                <Button onClick={() => { setEditingSongId(null); setNewSong({title:'', artist:'', ownerId: currentUser.id, chordType:'auto_search', link:'', screenshot:'', searchTerm:''}); setShowAddSong(true); }} className="px-6 py-3"><Plus size={18}/> New Request</Button>
             </div>

             <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
               <SortableContext items={queueIds} strategy={verticalListSortingStrategy}>
                 <div className="space-y-4">
                   {queueIds.length === 0 && <div className="text-center py-24 bg-jam-900/20 border border-dashed border-jam-700 rounded-[32px] text-jam-500 italic font-medium">The stage is waiting. Add your first song to start!</div>}
                   {queueIds.map((id, index) => {
                     const song = songs.find(s => s.id === id);
                     if (!song) return null;
                     return (
                        <SortableSongItem 
                            key={id} song={song} index={index} isCurrent={song.playStatus === 'playing'}
                            onMarkPlaying={() => updateStatus(id, 'playing')}
                            onMarkPlayed={() => updateStatus(id, 'played')}
                            onDelete={() => { if(confirm("Remove song?")) deleteSong(id); }}
                            onEdit={() => { setEditingSongId(id); setNewSong({title: song.title, artist: song.artist, ownerId: song.ownerUserId, chordType: song.chordSourceType, link: song.chordLink || '', screenshot: song.chordScreenshotUrl || '', searchTerm: ''}); setShowAddSong(true); }}
                            onUnsteal={() => { 
                                const updated = songs.map(s => s.id === id ? { ...s, isStolen: false } : s);
                                setSongs(updated); updateData('songs', updated);
                                const newQ = rebalanceQueue(updated, participants, queueIds);
                                setQueueIds(newQ); updateData('queueIds', newQ);
                            }}
                            onStash={() => stashSong(song)}
                        />
                     );
                   })}
                 </div>
               </SortableContext>
             </DndContext>

             {songs.some(s => s.playStatus === 'played') && (
                 <div className="mt-20 pt-10 border-t border-jam-800">
                    <h3 className="text-xl font-black mb-6 flex items-center gap-3"><History size={24} className="text-jam-600"/> Recorded History</h3>
                    <div className="space-y-4 opacity-90">
                        {songs.filter(s => s.playStatus === 'played').sort((a,b) => (b.playedAt||0) - (a.playedAt||0)).map(song => (
                             <SortableSongItem key={song.id} song={song} index={0} isCurrent={false} onRevive={() => {
                                 const updated = songs.map(s => s.id === song.id ? { ...s, playStatus: 'not_played' as PlayStatus } : s);
                                 setSongs(updated); updateData('songs', updated);
                                 const newQ = [...queueIds, song.id];
                                 setQueueIds(newQ); updateData('queueIds', newQ);
                             }} onRate={() => setShowRatingModal(song)} existingRatingValue={ratings.find(r => r.songChoiceId === song.id && r.userId === currentUser.id)?.value} />
                        ))}
                    </div>
                 </div>
             )}
           </div>
        )}

        {view === 'stats' && <div className="max-w-4xl mx-auto px-1">{renderStatsTabs()}</div>}

        {view === 'personal_stash' && (
           <div className="max-w-2xl mx-auto px-1 animate-fade-in">
               <div className="flex items-center justify-between mb-10">
                    <h2 className="text-3xl font-black flex items-center gap-4 text-white">My Library <Bookmark size={32} className="text-orange-500"/></h2>
               </div>
               <div className="space-y-4">
                   {myStash.length === 0 ? <div className="text-center py-24 text-jam-500 font-medium bg-jam-900/20 rounded-[32px] border border-dashed border-jam-800">Your stash is empty. Save songs from the queue to keep them here!</div> : myStash.map(item => (
                       <div key={item.id} className="p-5 bg-jam-800 border border-jam-700 rounded-2xl flex items-center justify-between group hover:border-jam-600 transition-all shadow-lg hover:shadow-orange-900/5">
                           <div className="min-w-0 flex-1">
                               <div className="font-bold text-white truncate text-lg">{item.title}</div>
                               <div className="text-sm text-jam-500 truncate">{item.artist}</div>
                           </div>
                           <div className="flex items-center gap-2">
                               <button onClick={() => handleSaveSong(item)} className="p-3 bg-orange-600/10 text-orange-400 hover:bg-orange-600 hover:text-white rounded-xl transition-all" title="Add to session"><Plus size={20}/></button>
                               <button onClick={() => removeFromStash(item.id)} className="p-3 text-jam-600 hover:text-red-400 rounded-xl transition-colors"><Trash2 size={18}/></button>
                           </div>
                       </div>
                   ))}
               </div>
           </div>
        )}
      </main>

      {/* Modals */}
      <Modal isOpen={showAddSong} onClose={() => setShowAddSong(false)} title={editingSongId ? "Edit Song" : "Add Song to Session"}>
          <div className="space-y-5">
              <div className="space-y-2">
                <label className="text-[10px] uppercase font-bold text-jam-500 ml-1">Track Name</label>
                <input className="w-full bg-jam-900 border border-jam-700 p-4 rounded-xl text-white outline-none focus:border-orange-500 transition-colors font-medium" placeholder="e.g. Hotel California" value={newSong.title} onChange={e => setNewSong({...newSong, title: e.target.value})} />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] uppercase font-bold text-jam-500 ml-1">Artist</label>
                <input className="w-full bg-jam-900 border border-jam-700 p-4 rounded-xl text-white outline-none focus:border-orange-500 transition-colors font-medium" placeholder="e.g. Eagles" value={newSong.artist} onChange={e => setNewSong({...newSong, artist: e.target.value})} />
              </div>
              <div className="grid grid-cols-2 gap-3 pt-2">
                  <Button variant="secondary" onClick={async () => {
                      setIsSearching(true);
                      const res = await searchChords(newSong.title, newSong.artist);
                      if (res.success) setSearchResults(res.data);
                      setIsSearching(false);
                  }} disabled={isSearching} className="h-12">{isSearching ? <RefreshCw className="animate-spin" size={16}/> : <Search size={16}/>} Lookup</Button>
                  <Button onClick={() => handleSaveSong()} className="h-12">{editingSongId ? "Update" : "Add to Queue"}</Button>
              </div>
              {searchResults.length > 0 && (
                  <div className="mt-4 p-3 bg-jam-900/50 rounded-2xl max-h-56 overflow-y-auto scrollbar-thin border border-jam-700">
                      <div className="text-[10px] uppercase font-black text-jam-600 mb-3 ml-1">Select Source</div>
                      {searchResults.map((r, i) => (
                          <div key={i} onClick={() => setNewSong({...newSong, link: r.url})} className={`p-4 rounded-xl cursor-pointer border text-xs mb-2 transition-all ${newSong.link === r.url ? 'border-orange-500 bg-orange-600/10 shadow-lg' : 'border-jam-700 hover:bg-jam-800'}`}>
                              <div className="font-bold truncate text-jam-100 text-sm mb-1">{r.title}</div>
                              <div className="text-[10px] text-orange-500/80 truncate font-mono">{r.url}</div>
                          </div>
                      ))}
                  </div>
              )}
          </div>
      </Modal>

      <Modal isOpen={!!showRatingModal} onClose={() => setShowRatingModal(null)} title="Crowd Feedback">
          <div className="text-center px-2">
              <div className="mb-10">
                  <div className="font-black text-3xl mb-2 tracking-tight">{showRatingModal?.title}</div>
                  <div className="text-orange-500 font-black uppercase text-xs tracking-[0.2em]">{showRatingModal?.ownerName}</div>
              </div>
              <div className="grid grid-cols-1 gap-4">
                  {RATING_OPTIONS.map(opt => (
                      <button key={opt.value} onClick={() => {
                          const rating: Rating = { id: generateId(), songChoiceId: showRatingModal!.id, userId: currentUser.id, value: opt.value };
                          const updated = [...ratings, rating];
                          setRatings(updated); updateData('ratings', updated); setShowRatingModal(null);
                      }} className="p-6 bg-jam-900 border border-jam-700 rounded-[24px] hover:bg-jam-700 hover:border-orange-500 transition-all font-black text-xl flex items-center justify-center gap-4 group">
                          <span className="group-hover:scale-110 transition-transform">{opt.label}</span>
                      </button>
                  ))}
              </div>
          </div>
      </Modal>

      {/* Mobile Nav Drawer */}
      <Modal isOpen={showMobileMenu} onClose={() => setShowMobileMenu(false)} title="GS JAM NAVIGATION">
          <div className="space-y-4">
              <button onClick={() => { setView('jam'); setShowMobileMenu(false); }} className="w-full p-6 bg-jam-900 border border-jam-700 rounded-3xl font-black text-lg flex items-center gap-5 active:bg-orange-600 active:text-white transition-all shadow-xl"><Music size={24}/> SESSION QUEUE</button>
              <button onClick={() => { setView('stats'); setShowMobileMenu(false); }} className="w-full p-6 bg-jam-900 border border-jam-700 rounded-3xl font-black text-lg flex items-center gap-5 active:bg-orange-600 active:text-white transition-all shadow-xl"><BarChart2 size={24}/> SESSION INSIGHTS</button>
              <button onClick={() => { setView('personal_stash'); setShowMobileMenu(false); }} className="w-full p-6 bg-jam-900 border border-jam-700 rounded-3xl font-black text-lg flex items-center gap-5 active:bg-orange-600 active:text-white transition-all shadow-xl"><Bookmark size={24}/> PERSONAL LIBRARY</button>
              <div className="h-px bg-jam-700 my-8"></div>
              <button onClick={() => { setCurrentUser(null); setShowMobileMenu(false); }} className="w-full p-6 bg-red-500/10 text-red-400 border border-red-500/20 rounded-3xl font-black text-lg flex items-center gap-5"><LogOut size={24}/> LOG OUT</button>
          </div>
      </Modal>
    </div>
  );
}
