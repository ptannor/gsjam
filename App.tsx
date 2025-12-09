
import React, { useState, useEffect, useMemo } from 'react';
import { 
  DndContext, 
  closestCenter, 
  KeyboardSensor, 
  PointerSensor, 
  useSensor, 
  useSensors, 
  DragEndEvent 
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
  Trophy, Heart, Activity, History, ChevronDown, CloudLightning, LogOut, Undo2, UserPlus
} from 'lucide-react';

import { ALL_USERS, RATING_OPTIONS, FIREBASE_CONFIG } from './constants';
import { JamSession, JamParticipant, SongChoice, User, Rating, UserName, ChordSearchResult } from './types';
import { searchChords } from './services/geminiService';
import { rebalanceQueue } from './components/QueueLogic';
import { calculateSongScore, getLeaderboard, calculateTasteSimilarity, getCrowdPleasers, ScoredSong } from './components/StatsLogic';
import { initFirebase, isFirebaseReady, getDb, ref, set, onValue, push, remove } from './services/firebase';

// --- Utility Functions ---

// Safe JSON parse to prevent crashes on corrupted localStorage
const safeParse = (json: string | null, fallback: any) => {
  if (!json || json === "undefined") return fallback;
  try {
    return JSON.parse(json);
  } catch (e) {
    console.warn("Failed to parse JSON, using fallback", e);
    return fallback;
  }
};

// Robust ID generation
const generateId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
};

// Sanitize data for Firebase (removes undefined values which cause crashes)
const sanitizeForFirebase = (data: any) => {
  if (data === undefined) return null;
  return JSON.parse(JSON.stringify(data));
};

// Get Local Date String YYYY-MM-DD (Fixes the UTC/Israel bug)
const getLocalDate = () => {
  const d = new Date();
  const offset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - offset).toISOString().split('T')[0];
};

// --- Utility Components ---

const Modal = ({ isOpen, onClose, children, title }: { isOpen: boolean; onClose: () => void; children: React.ReactNode; title: string }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 transition-all">
      <div className="bg-jam-800 border border-jam-700 rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] w-full max-w-lg max-h-[90vh] overflow-y-auto ring-1 ring-white/10 animate-fade-in scrollbar-thin scrollbar-thumb-jam-600">
        <div className="flex justify-between items-center p-5 border-b border-jam-700 bg-jam-800/50 sticky top-0 backdrop-blur-sm z-10">
          <h2 className="text-xl font-bold text-white tracking-tight">{title}</h2>
          <button onClick={onClose} className="text-jam-400 hover:text-white transition-colors bg-jam-700/50 hover:bg-jam-700 rounded-full p-1">&times;</button>
        </div>
        <div className="p-5">{children}</div>
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

// --- Sortable Item Component ---

function SortableSongItem({ 
  song, index, participant, onMarkPlaying, onMarkPlayed, onDelete, onRevive, onEdit, onUnsteal, isCurrent, onViewImage
}: { 
  song: SongChoice; index: number; participant?: JamParticipant; 
  onMarkPlaying?: () => void; onMarkPlayed?: () => void; onDelete?: () => void; onRevive?: () => void; onEdit?: () => void; onUnsteal?: () => void;
  isCurrent: boolean;
  onViewImage?: (url: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: song.id });
  
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const isPlayed = song.playStatus === 'played';

  return (
    <div ref={setNodeRef} style={style} className={`relative mb-3 group ${isPlayed ? 'opacity-60' : ''}`}>
      <div className={`
        flex items-center gap-4 p-4 rounded-xl border transition-all duration-300
        ${isCurrent ? 'bg-jam-800 border-orange-500/50 shadow-[0_0_25px_rgba(249,115,22,0.1)]' : 'bg-jam-800 border-jam-700 hover:border-jam-600 hover:bg-jam-700/50'}
        ${isPlayed ? 'bg-jam-900 border-jam-800' : ''}
        ${song.isStolen ? 'border-l-4 border-l-red-500/80 bg-red-900/5' : ''}
      `}>
        {!isPlayed && (
          <div {...attributes} {...listeners} className="cursor-grab text-jam-600 hover:text-jam-400 p-1">
            <GripVertical size={20} />
          </div>
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
             <h4 className={`font-bold truncate text-base ${isCurrent ? 'text-orange-400' : 'text-white'}`}>{song.title}</h4>
             {song.isStolen && <span className="text-[10px] bg-red-500/20 text-red-300 px-1.5 py-0.5 rounded uppercase font-bold tracking-wider border border-red-500/20">Stolen</span>}
          </div>
          <p className="text-sm text-jam-400 truncate flex items-center gap-2">
            <span className="font-medium text-jam-300">{song.artist}</span> 
            <span className="w-1 h-1 rounded-full bg-jam-600"></span>
            <span className="text-jam-400">{song.ownerName}</span>
          </p>
          
          <div className="flex gap-3 mt-2">
             {song.chordLink && (
               <a href={song.chordLink} target="_blank" rel="noreferrer" className="px-2 py-0.5 rounded bg-jam-700/50 border border-jam-600/50 text-xs flex items-center gap-1.5 text-orange-400 hover:text-orange-300 hover:bg-jam-700 transition-colors" onPointerDown={(e) => e.stopPropagation()}>
                 <ExternalLink size={10} /> Chords
               </a>
             )}
             {song.chordScreenshotUrl && (
               <button 
                 onClick={(e) => {
                   e.stopPropagation();
                   if (onViewImage) onViewImage(song.chordScreenshotUrl!);
                 }}
                 className="px-2 py-0.5 rounded bg-jam-700/50 border border-jam-600/50 text-xs flex items-center gap-1.5 text-blue-400 hover:text-blue-300 hover:bg-jam-700 transition-colors"
                 onPointerDown={(e) => e.stopPropagation()}
               >
                 <ImageIcon size={10} /> Image
               </button>
             )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {song.playStatus === 'not_played' && (
            <button onClick={onMarkPlaying} className="p-3 text-jam-400 hover:text-orange-400 hover:bg-jam-700/80 rounded-full transition-all" title="Start Playing">
              <Play size={20} fill="currentColor" className="opacity-80" />
            </button>
          )}
          
          {song.playStatus === 'playing' && (
            <button onClick={onMarkPlayed} className="p-3 text-green-400 hover:text-green-300 bg-green-500/10 border border-green-500/30 rounded-full animate-pulse transition-all" title="Mark as Played">
              <CheckCircle size={20} />
            </button>
          )}

          {/* Edit Button */}
          {onEdit && (
            <button onClick={onEdit} className="p-2 text-jam-500 hover:text-jam-200 hover:bg-jam-700 rounded-full transition-colors" title="Edit Song">
              <Pencil size={16} />
            </button>
          )}

          {/* Unsteal Button */}
          {song.isStolen && onUnsteal && (
            <button onClick={onUnsteal} className="p-2 text-red-400 hover:text-white hover:bg-red-500/20 rounded-full transition-colors" title="Return to Natural Order">
              <Undo2 size={16} />
            </button>
          )}

          {isPlayed && onRevive && (
             <button onClick={onRevive} className="p-2 text-jam-500 hover:text-white rounded-full transition-colors" title="Revive">
               <RotateCcw size={18} />
             </button>
          )}

          {!isPlayed && onDelete && (
            <button onClick={onDelete} className="p-3 text-jam-600 hover:text-red-400 hover:bg-red-500/10 rounded-full transition-all" title="Remove">
              <Trash2 size={18} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

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

  const [archives, setArchives] = useState<Record<string, ArchivedSessionData>>({});

  const [view, setView] = useState<'jam' | 'stats'>('jam');
  const [statsTab, setStatsTab] = useState<'today' | 'history' | 'leaderboards' | 'taste'>('today');
  const [historyDate, setHistoryDate] = useState<string>('');
  const [leaderboardPerspective, setLeaderboardPerspective] = useState<string>('all');

  const [showAddSong, setShowAddSong] = useState(false);
  const [editingSongId, setEditingSongId] = useState<string | null>(null); 
  const [showRatingModal, setShowRatingModal] = useState<SongChoice | null>(null);
  const [viewingImage, setViewingImage] = useState<string | null>(null); 
  
  // Firebase Connected State (Always true if config is valid in constants)
  const [isFirebaseConnected, setIsFirebaseConnected] = useState(false);

  // Add Participant State
  const [showAddParticipantModal, setShowAddParticipantModal] = useState(false);
  const [proxyUserToAdd, setProxyUserToAdd] = useState<string>('');
  const [proxyArrivalTime, setProxyArrivalTime] = useState<string>('');

  const [newSong, setNewSong] = useState({ 
    title: '', artist: '', ownerId: '', 
    chordType: 'link', link: '', screenshot: '', searchTerm: '' 
  });
  const [searchResults, setSearchResults] = useState<ChordSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // --- Initialization & Data Loading ---

  // 1. Initialize Firebase on Mount
  useEffect(() => {
    // Attempt to connect immediately using constants
    if (initFirebase(FIREBASE_CONFIG)) {
      setIsFirebaseConnected(true);
    } else {
      console.warn("Firebase configuration missing or invalid in constants.ts. Falling back to local storage.");
    }
  }, []);

  // 2. Data Synchronization (Hybrid: LocalStorage or Firebase)
  useEffect(() => {
    if (isFirebaseConnected && isFirebaseReady()) {
       // --- FIREBASE MODE ---
       const db = getDb();
       
       const unsubSession = onValue(ref(db, 'session'), (snap) => setSession(snap.val() || null));
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
           
           if (parsedSession && parsedSession.date !== today) {
             // Archive previous day
             const savedParticipants = safeParse(localStorage.getItem('gs_jam_participants'), []);
             if (savedParticipants.length > 0) {
                 savedArchives[parsedSession.date] = {
                     session: parsedSession,
                     participants: savedParticipants,
                     songs: safeParse(localStorage.getItem('gs_jam_songs'), []),
                     ratings: safeParse(localStorage.getItem('gs_jam_ratings'), [])
                 };
                 setArchives(savedArchives);
                 localStorage.setItem('gs_jam_archive', JSON.stringify(savedArchives));
             }
             // Reset
             const newSession = { id: generateId(), date: today };
             setSession(newSession);
             setParticipants([]); setSongs([]); setRatings([]); setQueueIds([]);
             localStorage.setItem('gs_jam_session', JSON.stringify(newSession));
             localStorage.setItem('gs_jam_participants', '[]');
             localStorage.setItem('gs_jam_songs', '[]');
             localStorage.setItem('gs_jam_ratings', '[]');
             localStorage.setItem('gs_jam_queue_ids', '[]');
           } else {
             // Resume
             setSession(parsedSession);
             setParticipants(safeParse(localStorage.getItem('gs_jam_participants'), []));
             setSongs(safeParse(localStorage.getItem('gs_jam_songs'), []));
             setRatings(safeParse(localStorage.getItem('gs_jam_ratings'), []));
             setQueueIds(safeParse(localStorage.getItem('gs_jam_queue_ids'), []));
           }
         } else {
             const newSession = { id: generateId(), date: today };
             setSession(newSession);
             localStorage.setItem('gs_jam_session', JSON.stringify(newSession));
         }
       } catch (err) {
         console.error("Local init error", err);
       }
    }
  }, [isFirebaseConnected]);

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

  useEffect(() => { if (!isFirebaseConnected && participants.length > 0) localStorage.setItem('gs_jam_participants', JSON.stringify(participants)); }, [participants, isFirebaseConnected]);
  useEffect(() => { if (!isFirebaseConnected && songs.length > 0) localStorage.setItem('gs_jam_songs', JSON.stringify(songs)); }, [songs, isFirebaseConnected]);
  useEffect(() => { if (!isFirebaseConnected && ratings.length > 0) localStorage.setItem('gs_jam_ratings', JSON.stringify(ratings)); }, [ratings, isFirebaseConnected]);
  useEffect(() => { if (!isFirebaseConnected && queueIds.length > 0) localStorage.setItem('gs_jam_queue_ids', JSON.stringify(queueIds)); }, [queueIds, isFirebaseConnected]);


  // --- Logic Helpers ---

  const handleJoinSelection = (userName: UserName) => {
    setJoiningUser(userName);
    const now = new Date();
    // Default to HH:MM:SS for precision
    setManualArrivalTime(now.toLocaleTimeString('en-GB', { hour12: false }));
  };

  const confirmJoin = (timeMode: 'now' | 'manual') => {
    if (!session || !joiningUser) return;
    
    const userId = joiningUser.toLowerCase().replace(' ', '_');
    const user = { id: userId, name: joiningUser };
    setCurrentUser(user);

    const existing = participants.find(p => p.userId === userId);
    if (!existing) {
      // FIX: Use session date string explicitly to construct local time
      const arrival = timeMode === 'now' 
        ? Date.now() 
        : new Date(`${session.date}T${manualArrivalTime}`).getTime();
      
      const p: JamParticipant = {
        id: generateId(),
        sessionId: session.id,
        userId,
        name: joiningUser,
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
  };

  const handleAddProxyParticipant = () => {
    setProxyUserToAdd('');
    const now = new Date();
    setProxyArrivalTime(now.toLocaleTimeString('en-GB', { hour12: false }));
    setShowAddParticipantModal(true);
  };

  const confirmProxyParticipant = () => {
    if (!session || !proxyUserToAdd) return;
    
    const userId = proxyUserToAdd.toLowerCase().replace(' ', '_');
    const existing = participants.find(p => p.userId === userId);
    
    if (!existing) {
        // FIX: Use session date explicitly
        const arrival = new Date(`${session.date}T${proxyArrivalTime}`).getTime();
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
    setNewSong({ 
      title: '', artist: '', ownerId: currentUser?.id || '', 
      chordType: 'link', link: '', screenshot: '', searchTerm: '' 
    });
    setSearchResults([]);
    setShowAddSong(true);
  };

  const openEditModal = (song: SongChoice) => {
    setEditingSongId(song.id);
    setNewSong({
      title: song.title,
      artist: song.artist,
      ownerId: song.ownerUserId,
      chordType: song.chordSourceType === 'auto_search' ? 'link' : song.chordSourceType,
      link: song.chordLink || '',
      screenshot: song.chordScreenshotUrl || '',
      searchTerm: ''
    });
    setSearchResults([]);
    setShowAddSong(true);
  };

  const handleSaveSong = () => {
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

    setShowAddSong(false);
  };

  const performSearch = async () => {
    setIsSearching(true);
    const results = await searchChords(newSong.title, newSong.artist);
    setSearchResults(results);
    setIsSearching(false);
  };

  const sensors = useSensors(
    useSensor(PointerSensor),
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
             // Mark as stolen
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
      // Logic changed: Revive removes previous ratings to start fresh for stats
      // We set playedAt to undefined, which sanitizeForFirebase will strip out, effectively deleting the key from Firebase
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

    // Immediate Rebalance to put it back in fair spot
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
    const rating: Rating = {
      id: generateId(),
      songChoiceId: showRatingModal.id,
      userId: currentUser.id,
      value: val
    };
    const newRatings = [...ratings, rating];
    setRatings(newRatings);
    updateData('ratings', newRatings);
    setShowRatingModal(null);
  };

  const deleteHistorySession = (date: string) => {
    if (confirm(`Are you sure you want to delete the records for ${date}?`)) {
        const newArchives = { ...archives };
        delete newArchives[date];
        setArchives(newArchives);
        updateData('archives', newArchives);
        if (historyDate === date) setHistoryDate('');
    }
  };

  // --- Derived Stats Data ---
  const statsDataset = useMemo(() => {
    if (statsTab === 'today') {
        return { participants, songs, ratings };
    }
    if (statsTab === 'history' && historyDate && archives[historyDate]) {
        return archives[historyDate];
    }
    return { participants: [], songs: [], ratings: [] };
  }, [statsTab, historyDate, archives, participants, songs, ratings]);

  const { participants: activeStatsParticipants, songs: activeStatsSongs, ratings: activeStatsRatings } = statsDataset;

  const arrivalTimeline = useMemo(() => {
    return [...activeStatsParticipants].sort((a,b) => a.arrivalTime - b.arrivalTime);
  }, [activeStatsParticipants]);

  // Changed Order: Chronological (Oldest played first -> Newest played last)
  // This reads like a setlist history
  const sessionDigest = useMemo(() => {
    const played = activeStatsSongs
      .filter(s => s.playStatus === 'played')
      .sort((a,b) => (a.playedAt || 0) - (b.playedAt || 0)); 
    
    return played.map(s => {
      const score = calculateSongScore(s.id, activeStatsRatings);
      return { ...s, score };
    });
  }, [activeStatsSongs, activeStatsRatings]);

  const leaderboard = useMemo(() => {
     return getLeaderboard(songs, ratings, leaderboardPerspective === 'all' ? undefined : leaderboardPerspective);
  }, [songs, ratings, leaderboardPerspective]);

  const crowdPleasers = useMemo(() => {
    return getCrowdPleasers(songs, ratings);
  }, [songs, ratings]);

  const tasteSimilarity = useMemo(() => {
    return calculateTasteSimilarity(ratings, participants);
  }, [ratings, participants]);

  const activeQueue = queueIds.map(id => songs.find(s => s.id === id)).filter(Boolean) as SongChoice[];
  const isFormValid = newSong.title && newSong.ownerId && (newSong.link || newSong.screenshot);

  // --- Render ---

  if (!currentUser) {
    if (joiningUser) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-jam-950 p-6">
          <div className="bg-jam-800 p-8 rounded-2xl border border-jam-700 shadow-2xl w-full max-w-md animate-fade-in">
             <button onClick={() => setJoiningUser(null)} className="flex items-center gap-2 text-jam-400 hover:text-white mb-6">
               <ArrowLeft size={16} /> Back
             </button>
             <h2 className="text-2xl font-bold mb-2 text-white">Hi, {joiningUser} 👋</h2>
             <p className="text-jam-400 mb-6">When did you arrive to the jam?</p>
             <div className="space-y-4">
                <Button variant="primary" className="w-full py-4 text-lg" onClick={() => confirmJoin('now')}>
                  <Clock size={24} /> I Arrived Just Now
                </Button>
                <div className="relative py-2">
                  <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-jam-700"></div></div>
                  <div className="relative flex justify-center text-xs uppercase"><span className="bg-jam-800 px-3 text-jam-500 font-medium">Or Select Time</span></div>
                </div>
                <div className="bg-jam-900 p-5 rounded-xl border border-jam-700">
                  <label className="block text-sm text-jam-300 mb-3 font-medium">Arrival Time:</label>
                  <input type="time" step="1" value={manualArrivalTime} onChange={(e) => setManualArrivalTime(e.target.value)} className="w-full bg-jam-800 border border-jam-600 rounded-lg p-3 text-white text-xl text-center focus:border-orange-500 outline-none" />
                  <Button variant="secondary" className="w-full mt-4" onClick={() => confirmJoin('manual')}>Confirm Time</Button>
                </div>
             </div>
          </div>
        </div>
      );
    }
    return (
      <div className="min-h-screen flex items-center justify-center bg-jam-950 p-6">
        <div className="bg-jam-800 p-8 rounded-2xl border border-jam-700 shadow-2xl w-full max-w-md relative overflow-hidden">
          {/* Status Indicator */}
          <div className="absolute top-4 right-4 flex items-center gap-2">
            {isFirebaseConnected && (
               <span className="flex items-center gap-1.5 text-green-400 text-[10px] font-bold uppercase tracking-wider bg-green-500/10 px-2 py-1 rounded-full border border-green-500/20">
                 <CloudLightning size={10} /> Online
               </span>
            )}
          </div>
          
          <div className="text-center mb-8">
            <div className="inline-block p-4 bg-orange-500/10 rounded-full mb-4 border border-orange-500/20"><Guitar size={48} className="text-orange-500" /></div>
            <h1 className="text-3xl font-bold text-white mb-1">GS Jam</h1>
            <p className="text-jam-400">Select your name to start</p>
          </div>
          <div className="grid grid-cols-2 gap-3 max-h-64 overflow-y-auto mb-6 pr-2 scrollbar-thin scrollbar-thumb-jam-600">
            {ALL_USERS.map(u => (
              <button key={u} onClick={() => handleJoinSelection(u)} className="bg-jam-700/50 hover:bg-orange-600 hover:text-white p-3 rounded-lg text-sm font-medium transition-all text-left text-jam-200 border border-transparent hover:border-orange-400">{u}</button>
            ))}
          </div>

        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col md:flex-row max-w-7xl mx-auto bg-jam-950 shadow-2xl shadow-black">
      {/* Sidebar / Topbar */}
      <div className="w-full md:w-72 bg-jam-800/80 p-5 flex flex-col gap-6 md:h-screen md:sticky md:top-0 z-20 border-b md:border-b-0 md:border-r border-jam-700 backdrop-blur-md">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-orange-600 rounded-lg"><Guitar size={20} className="text-white" /></div>
            <h1 className="text-2xl font-bold text-white tracking-tight">GS Jam</h1>
          </div>
          <p className="text-sm text-jam-400 flex items-center gap-2 mb-3"><Calendar size={14} /> {session?.date}</p>
          <div className="flex items-center justify-between bg-jam-700/50 px-3 py-2 rounded-full border border-jam-600/50">
             <div className="text-xs text-jam-200">
                <span className="text-jam-400 block text-[10px] uppercase">Logged in as</span>
                <span className="text-orange-400 font-bold">{currentUser.name}</span>
             </div>
             <button onClick={() => setCurrentUser(null)} className="text-jam-400 hover:text-white p-1 rounded-full hover:bg-jam-600 transition-colors" title="Log Out"><LogOut size={14} /></button>
          </div>
        </div>

        <nav className="flex md:flex-col gap-2">
          <Button variant={view === 'jam' ? 'primary' : 'ghost'} onClick={() => setView('jam')} className="justify-start w-full"><Music size={18} /> Jam Queue</Button>
          <Button variant={view === 'stats' ? 'primary' : 'ghost'} onClick={() => setView('stats')} className="justify-start w-full"><BarChart2 size={18} /> Stats</Button>
          {isFirebaseConnected && (
             <div className="md:mt-auto flex items-center gap-2 px-4 py-2 bg-green-500/10 border border-green-500/20 rounded-lg">
                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
                <span className="text-xs font-bold text-green-400 uppercase tracking-wider">Online</span>
             </div>
          )}
        </nav>

        <div className="hidden md:flex flex-1 flex-col overflow-hidden">
          <div className="flex items-center justify-between mb-4">
              <h3 className="text-xs font-bold uppercase text-jam-500 tracking-wider flex items-center gap-2"><Users size={14} /> Participants ({participants.length})</h3>
              <button onClick={handleAddProxyParticipant} className="text-jam-400 hover:text-white hover:bg-jam-700 p-1 rounded transition-colors" title="Add participant for them">
                 <UserPlus size={16} />
              </button>
          </div>
          <div className="flex-1 overflow-y-auto space-y-2 pr-2 scrollbar-thin scrollbar-thumb-jam-600">
            {participants.sort((a,b) => a.arrivalTime - b.arrivalTime).map(p => (
              <div key={p.id} className="flex justify-between items-center text-sm p-3 bg-jam-900/50 rounded-lg border border-jam-700/50 hover:border-jam-600 transition-colors">
                <span className="text-jam-200 font-medium">{p.name}</span>
                <span className="text-xs text-jam-500 font-mono bg-jam-800 px-1.5 py-0.5 rounded">{new Date(p.arrivalTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className="flex-1 p-4 md:p-8 overflow-y-auto bg-jam-950 pb-40">
        {view === 'jam' && (
          <div className="max-w-3xl mx-auto">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end mb-8 gap-4">
              <div>
                <h2 className="text-3xl font-bold text-white mb-2 tracking-tight">Queue</h2>
                <p className="text-jam-400 text-sm flex items-center gap-2"><ShieldAlert size={14} className="text-orange-500" />Fair round-robin active. Drag to steal a spot.</p>
              </div>
              <Button onClick={openAddModal} className="w-full sm:w-auto"><Plus size={18} /> Add Song</Button>
            </div>

            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={queueIds} strategy={verticalListSortingStrategy}>
                <div className="space-y-3 pb-8">
                  {activeQueue.length === 0 && (
                    <div className="text-center py-16 border-2 border-dashed border-jam-800 rounded-3xl bg-jam-900/30">
                      <div className="inline-block p-4 bg-jam-800 rounded-full mb-4"><Music size={40} className="text-jam-600" /></div>
                      <h3 className="text-jam-200 font-bold text-lg mb-1">The stage is empty</h3>
                      <p className="text-jam-500">Add a song to get the jam started!</p>
                    </div>
                  )}
                  {activeQueue.map((song, index) => (
                    <SortableSongItem 
                      key={song.id} 
                      song={song} 
                      index={index} 
                      participant={participants.find(p => p.userId === song.ownerUserId)}
                      onMarkPlaying={() => updateStatus(song.id, 'playing')}
                      onMarkPlayed={() => updateStatus(song.id, 'played')}
                      onDelete={() => deleteSong(song.id)}
                      onEdit={() => openEditModal(song)}
                      onUnsteal={() => unstealSong(song.id)}
                      onViewImage={setViewingImage}
                      isCurrent={song.playStatus === 'playing'}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
            
            {/* Minimal Recently Played (Newest First) */}
            {sessionDigest.length > 0 && (
              <div className="mt-12 pt-8 border-t border-jam-800">
                <h3 className="text-lg font-bold text-jam-300 mb-6 flex items-center gap-2 uppercase tracking-wider text-xs"><Clock size={16} /> Recently Played</h3>
                <div className="opacity-80 hover:opacity-100 transition-opacity space-y-2">
                   {sessionDigest.sort((a,b) => (b.playedAt||0) - (a.playedAt||0)).slice(0, 5).map((item, idx) => (
                     <SortableSongItem key={item.id} song={item} index={idx} isCurrent={false} onRevive={() => reviveSong(item.id)} onEdit={() => openEditModal(item)} onViewImage={setViewingImage} />
                   ))}
                </div>
              </div>
            )}
          </div>
        )}

        {view === 'stats' && (
          <div className="max-w-5xl mx-auto animate-fade-in pb-12">
            <header className="mb-8">
              <h2 className="text-3xl font-bold text-white mb-6">Stats & Insights</h2>
              <div className="flex flex-wrap gap-2 border-b border-jam-800 pb-1">
                <button onClick={() => setStatsTab('today')} className={`px-4 py-2 text-sm font-bold uppercase tracking-wider rounded-t-lg transition-colors ${statsTab === 'today' ? 'bg-jam-800 text-orange-400 border-b-2 border-orange-500' : 'text-jam-500 hover:text-white'}`}>Today's Jam</button>
                <button onClick={() => setStatsTab('history')} className={`px-4 py-2 text-sm font-bold uppercase tracking-wider rounded-t-lg transition-colors ${statsTab === 'history' ? 'bg-jam-800 text-orange-400 border-b-2 border-orange-500' : 'text-jam-500 hover:text-white'}`}>History</button>
                <button onClick={() => setStatsTab('leaderboards')} className={`px-4 py-2 text-sm font-bold uppercase tracking-wider rounded-t-lg transition-colors ${statsTab === 'leaderboards' ? 'bg-jam-800 text-orange-400 border-b-2 border-orange-500' : 'text-jam-500 hover:text-white'}`}>Leaderboards</button>
                <button onClick={() => setStatsTab('taste')} className={`px-4 py-2 text-sm font-bold uppercase tracking-wider rounded-t-lg transition-colors ${statsTab === 'taste' ? 'bg-jam-800 text-orange-400 border-b-2 border-orange-500' : 'text-jam-500 hover:text-white'}`}>Taste Buds</button>
              </div>
            </header>

            {(statsTab === 'today' || statsTab === 'history') && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                
                {/* Special Header for History Tab */}
                {statsTab === 'history' && (
                   <div className="lg:col-span-3 bg-jam-800 p-6 rounded-xl border border-jam-700 flex flex-col md:flex-row items-center gap-6 justify-between mb-2">
                     <div>
                       <h3 className="font-bold text-white text-lg">Time Machine</h3>
                       <p className="text-jam-400 text-sm">View details from previous jams.</p>
                     </div>
                     <div className="flex items-center gap-3">
                       <div className="relative">
                           <select 
                             value={historyDate} 
                             onChange={(e) => setHistoryDate(e.target.value)}
                             className="bg-jam-900 border border-jam-600 rounded-lg py-2 pl-3 pr-8 text-white outline-none focus:border-orange-500 appearance-none min-w-[200px]"
                           >
                             <option value="" disabled>Select a Date</option>
                             {Object.keys(archives).sort().reverse().map(date => (
                               <option key={date} value={date}>{date}</option>
                             ))}
                             {Object.keys(archives).length === 0 && <option value="" disabled>No past jams found</option>}
                           </select>
                           <ChevronDown size={14} className="absolute right-3 top-3 text-jam-400 pointer-events-none" />
                       </div>
                       {historyDate && (
                         <button onClick={() => deleteHistorySession(historyDate)} className="p-2.5 bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500 hover:text-white rounded-lg transition-all" title="Delete this record">
                           <Trash2 size={18} />
                         </button>
                       )}
                     </div>
                   </div>
                )}
                
                {statsTab === 'history' && !historyDate && (
                    <div className="lg:col-span-3 text-center py-20 bg-jam-900/50 rounded-xl border border-dashed border-jam-700">
                        <History size={48} className="mx-auto text-jam-600 mb-4" />
                        <p className="text-jam-400">Please select a date from the dropdown to view its history.</p>
                    </div>
                )}

                {/* Main Content for Today OR Selected History */}
                {(statsTab === 'today' || (statsTab === 'history' && historyDate)) && (
                  <>
                    {/* Column 1: Timeline */}
                    <div className="bg-jam-800 rounded-xl p-6 border border-jam-700 h-fit">
                       <h3 className="text-sm font-bold uppercase text-jam-400 mb-4 flex items-center gap-2"><Clock size={16}/> Arrivals</h3>
                       <div className="space-y-4 relative pl-4 border-l border-jam-700">
                         {arrivalTimeline.length === 0 && <div className="text-xs text-jam-500 italic">No participants recorded.</div>}
                         {arrivalTimeline.map((p, i) => (
                           <div key={p.id} className="relative">
                             <div className="absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full bg-jam-600 border border-jam-900"></div>
                             <div className="text-sm text-white font-bold">{p.name}</div>
                             <div className="text-xs text-jam-500">{new Date(p.arrivalTime).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</div>
                           </div>
                         ))}
                       </div>
                    </div>

                    {/* Column 2 & 3: Played Songs Table */}
                    <div className="lg:col-span-2 space-y-6">
                       {/* Top Rated Podium (Top 5 with Donuts) */}
                       {sessionDigest.length > 0 && (
                           <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 gap-4">
                             {sessionDigest.sort((a,b) => (b.score?.score||0) - (a.score?.score||0)).slice(0,5).map((s, i) => {
                               // Calculate Voters
                               const voters = activeStatsRatings.filter(r => r.songChoiceId === s.id);
                               const highlights = voters.filter(r => r.value === 'Highlight');
                               const sababas = voters.filter(r => r.value === 'Sababa');
                               const others = voters.length - highlights.length - sababas.length;

                               // Simple Gradient for donut: Highlight (Yellow) | Sababa (Green) | Others (Gray)
                               const total = voters.length || 1;
                               const degH = (highlights.length / total) * 360;
                               const degS = degH + (sababas.length / total) * 360;
                               
                               const gradient = `conic-gradient(#facc15 0deg ${degH}deg, #4ade80 ${degH}deg ${degS}deg, #3f3f46 ${degS}deg 360deg)`;

                               return (
                                 <div key={s.id} className="bg-jam-800 border border-jam-700 p-4 rounded-xl flex items-start gap-4 hover:border-orange-500/30 transition-all relative overflow-hidden group">
                                   {/* Rank Badge */}
                                   <div className="absolute -right-2 -top-2 w-12 h-12 bg-jam-900 rotate-12 flex items-end justify-start pl-3 pb-2 text-xl font-bold text-jam-700 group-hover:text-orange-500/20 transition-colors">#{i+1}</div>
                                   
                                   {/* Donut Chart */}
                                   <div className="relative w-16 h-16 shrink-0 rounded-full flex items-center justify-center bg-jam-900" style={{background: gradient}}>
                                      <div className="w-12 h-12 bg-jam-800 rounded-full flex items-center justify-center text-sm font-bold text-white z-10">
                                        {s.score?.score}
                                      </div>
                                   </div>

                                   <div className="flex-1 min-w-0 z-10">
                                     <div className="text-[10px] font-bold text-orange-500 uppercase tracking-wider mb-0.5">Top Rated</div>
                                     <div className="font-bold text-white truncate text-sm">{s.title}</div>
                                     <div className="text-xs text-jam-400 mb-2">{s.ownerName}</div>
                                     
                                     {/* Voter Names */}
                                     <div className="flex flex-wrap gap-1">
                                        {highlights.map(r => {
                                           const name = activeStatsParticipants.find(p => p.userId === r.userId)?.name.split(' ')[0] || r.userId;
                                           return <span key={r.id} className="px-1.5 py-0.5 rounded bg-yellow-400/10 text-yellow-400 border border-yellow-400/20 text-[9px] font-bold">{name}</span>
                                        })}
                                        {sababas.map(r => {
                                           const name = activeStatsParticipants.find(p => p.userId === r.userId)?.name.split(' ')[0] || r.userId;
                                           return <span key={r.id} className="px-1.5 py-0.5 rounded bg-green-400/10 text-green-400 border border-green-400/20 text-[9px] font-bold">{name}</span>
                                        })}
                                     </div>
                                   </div>
                                 </div>
                               );
                             })}
                           </div>
                       )}

                       <div className="bg-jam-800 rounded-xl border border-jam-700 overflow-hidden">
                          <div className="p-4 border-b border-jam-700 bg-jam-800/50 flex justify-between items-center">
                            <h3 className="font-bold text-white">Played Songs (Setlist)</h3>
                            <span className="text-xs text-jam-400">{sessionDigest.length} Songs</span>
                          </div>
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm text-left">
                              <thead className="bg-jam-900/50 text-jam-400 uppercase text-xs font-bold">
                                <tr>
                                  <th className="p-4">Time</th>
                                  <th className="p-4">Song</th>
                                  <th className="p-4">Picked By</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-jam-700/50">
                                {sessionDigest.length === 0 && (
                                    <tr><td colSpan={3} className="p-8 text-center text-jam-500">No songs played yet.</td></tr>
                                )}
                                {sessionDigest.sort((a,b) => (a.playedAt || 0) - (b.playedAt || 0)).map(s => (
                                  <tr key={s.id} className="hover:bg-jam-700/20 transition-colors">
                                    <td className="p-4 text-jam-500 font-mono text-xs w-24">
                                      {s.playedAt ? new Date(s.playedAt).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : '-'}
                                    </td>
                                    <td className="p-4 font-medium text-white">
                                      {s.title} <span className="block text-xs text-jam-500 font-normal">{s.artist}</span>
                                    </td>
                                    <td className="p-4 text-jam-300">{s.ownerName}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                       </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {statsTab === 'leaderboards' && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                 {/* Left: Song Rankings */}
                 <div className="bg-jam-800 rounded-xl border border-jam-700 overflow-hidden flex flex-col h-[600px]">
                    <div className="p-4 border-b border-jam-700 bg-jam-800/50 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                       <h3 className="font-bold text-white flex items-center gap-2"><Trophy size={16} className="text-yellow-400"/> Song Rankings</h3>
                       <div className="relative">
                         <select 
                           value={leaderboardPerspective}
                           onChange={(e) => setLeaderboardPerspective(e.target.value)}
                           className="bg-jam-900 border border-jam-600 text-xs text-white py-1.5 pl-3 pr-8 rounded-lg appearance-none outline-none focus:border-orange-500"
                         >
                           <option value="all">According to Everyone</option>
                           {participants.map(p => <option key={p.id} value={p.userId}>According to {p.name}</option>)}
                         </select>
                         <ChevronDown size={14} className="absolute right-2 top-2 text-jam-400 pointer-events-none" />
                       </div>
                    </div>
                    <div className="overflow-y-auto flex-1 p-2 space-y-2 scrollbar-thin scrollbar-thumb-jam-600">
                       {leaderboard.length === 0 && <div className="text-center p-8 text-jam-500 text-sm">No rated songs yet.</div>}
                       {leaderboard.map((item, i) => (
                         <div key={item.song.id} className="flex items-center gap-3 p-3 bg-jam-900/50 rounded-lg hover:bg-jam-700/50 transition-colors group">
                            <div className={`w-8 h-8 flex items-center justify-center rounded-lg font-bold text-sm ${i < 3 ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/20' : 'bg-jam-800 text-jam-500'}`}>
                              #{i+1}
                            </div>
                            <div className="flex-1 min-w-0">
                               <div className="font-bold text-white truncate text-sm">{item.song.title}</div>
                               <div className="text-xs text-jam-400 flex items-center gap-1">{item.song.ownerName} <span className="text-jam-600">•</span> {item.totalVotes} votes</div>
                            </div>
                            <div className="text-right">
                               <div className="text-lg font-bold text-white">{item.score}</div>
                               <div className="text-[10px] uppercase text-jam-500 font-bold tracking-wider">Score</div>
                            </div>
                         </div>
                       ))}
                    </div>
                 </div>

                 {/* Right: Crowd Pleasers */}
                 <div className="space-y-6">
                   <div className="bg-jam-800 rounded-xl border border-jam-700 p-6">
                      <h3 className="font-bold text-white mb-4 flex items-center gap-2"><Activity size={18} className="text-green-400"/> The Crowd Pleasers</h3>
                      <p className="text-xs text-jam-400 mb-4">Who picks the songs that get the highest average ratings?</p>
                      <div className="space-y-3">
                         {crowdPleasers.slice(0, 5).map((cp, i) => {
                           const participant = participants.find(p => p.userId === cp.userId);
                           return (
                             <div key={cp.userId} className="flex items-center justify-between p-3 rounded-lg bg-jam-900/30 border border-jam-700/50">
                                <div className="flex items-center gap-3">
                                   <div className="w-8 h-8 rounded-full bg-jam-700 flex items-center justify-center text-xs font-bold text-jam-300">
                                     {i+1}
                                   </div>
                                   <div>
                                      <div className="font-bold text-white text-sm">{participant?.name || cp.userId}</div>
                                      <div className="text-xs text-jam-500">{cp.songCount} songs played</div>
                                   </div>
                                </div>
                                <div className="text-right">
                                  <div className="text-green-400 font-bold">{cp.avgScore} pts</div>
                                  <div className="text-[10px] text-jam-500">Avg Score</div>
                                </div>
                             </div>
                           );
                         })}
                      </div>
                   </div>

                   <div className="bg-jam-800 rounded-xl border border-jam-700 p-6">
                      <h3 className="font-bold text-white mb-4">Attendance (Demo)</h3>
                      <div className="h-40 flex items-end justify-between gap-2">
                          {participants.slice(0, 7).map(p => (
                             <div key={p.id} className="flex flex-col items-center gap-2 flex-1 group">
                                <div className="w-full bg-jam-700 rounded-t-sm relative h-24 group-hover:bg-orange-500/50 transition-colors overflow-hidden">
                                   <div className="absolute bottom-0 w-full bg-orange-500" style={{height: `${Math.random() * 80 + 20}%`}}></div>
                                </div>
                                <span className="text-[10px] text-jam-400 truncate w-full text-center">{p.name}</span>
                             </div>
                          ))}
                      </div>
                   </div>
                 </div>
              </div>
            )}

            {statsTab === 'taste' && (
               <div className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Soulmates Card */}
                    <div className="bg-gradient-to-br from-indigo-900/20 to-jam-800 border border-indigo-500/30 p-6 rounded-2xl relative overflow-hidden">
                       <div className="absolute top-0 right-0 p-8 opacity-10"><Heart size={120} /></div>
                       <h3 className="text-indigo-300 font-bold uppercase tracking-widest text-xs mb-1">Musical Soulmates</h3>
                       <p className="text-jam-400 text-sm mb-6">Highest similarity score based on shared ratings.</p>
                       
                       {tasteSimilarity.length > 0 ? (
                         <div className="flex items-center gap-4 relative z-10">
                            <div className="text-center">
                              <div className="text-2xl font-bold text-white">{participants.find(p => p.userId === tasteSimilarity[0].userA)?.name}</div>
                            </div>
                            <div className="flex-1 border-t-2 border-dashed border-indigo-500/50 relative">
                               <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-jam-950 px-2 text-indigo-400 font-bold text-xl">
                                  {tasteSimilarity[0].score}%
                                </div>
                            </div>
                            <div className="text-center">
                              <div className="text-2xl font-bold text-white">{participants.find(p => p.userId === tasteSimilarity[0].userB)?.name}</div>
                            </div>
                         </div>
                       ) : (
                         <div className="text-jam-500 italic">Not enough shared ratings yet.</div>
                       )}
                    </div>

                    {/* Nemesis Card */}
                    <div className="bg-gradient-to-br from-red-900/20 to-jam-800 border border-red-500/30 p-6 rounded-2xl relative overflow-hidden">
                       <div className="absolute top-0 right-0 p-8 opacity-10"><Activity size={120} /></div>
                       <h3 className="text-red-300 font-bold uppercase tracking-widest text-xs mb-1">Musical Opposites</h3>
                       <p className="text-jam-400 text-sm mb-6">Lowest similarity score.</p>
                       
                       {tasteSimilarity.length > 0 ? (
                         <div className="flex items-center gap-4 relative z-10">
                            <div className="text-center">
                              <div className="text-2xl font-bold text-white">{participants.find(p => p.userId === tasteSimilarity[tasteSimilarity.length - 1].userA)?.name}</div>
                            </div>
                            <div className="flex-1 border-t-2 border-dashed border-red-500/50 relative">
                               <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-jam-950 px-2 text-red-400 font-bold text-xl">
                                  {tasteSimilarity[tasteSimilarity.length - 1].score}%
                                </div>
                            </div>
                            <div className="text-center">
                              <div className="text-2xl font-bold text-white">{participants.find(p => p.userId === tasteSimilarity[tasteSimilarity.length - 1].userB)?.name}</div>
                            </div>
                         </div>
                       ) : (
                         <div className="text-jam-500 italic">Not enough shared ratings yet.</div>
                       )}
                    </div>
                  </div>

                  {/* Matrix List */}
                  <div className="bg-jam-800 rounded-xl border border-jam-700 p-6">
                     <h3 className="font-bold text-white mb-4">All Compatibility Scores</h3>
                     <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                        {tasteSimilarity.map((pair, i) => {
                          const nameA = participants.find(p => p.userId === pair.userA)?.name || pair.userA;
                          const nameB = participants.find(p => p.userId === pair.userB)?.name || pair.userB;
                          return (
                            <div key={i} className="flex justify-between items-center p-3 bg-jam-900/50 rounded-lg text-sm border border-jam-700/50">
                               <span className="text-jam-200">{nameA} & {nameB}</span>
                               <span className={`font-mono font-bold ${pair.score > 70 ? 'text-green-400' : pair.score < 40 ? 'text-red-400' : 'text-yellow-400'}`}>
                                 {pair.score}%
                               </span>
                            </div>
                          )
                        })}
                     </div>
                  </div>
               </div>
            )}
          </div>
        )}
      </main>

      {/* --- Image Viewer Modal --- */}
      {viewingImage && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/95 backdrop-blur-sm animate-fade-in p-4" onClick={() => setViewingImage(null)}>
           <button 
             onClick={() => setViewingImage(null)} 
             className="absolute top-6 right-6 text-white/70 hover:text-white bg-white/10 hover:bg-white/20 p-2 rounded-full transition-all"
           >
             <X size={24} />
           </button>
           <img 
             src={viewingImage} 
             alt="Chord Screenshot" 
             className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl border border-white/10"
             onClick={(e) => e.stopPropagation()} 
           />
        </div>
      )}

      {/* --- Modals --- */}
      <Modal isOpen={showAddParticipantModal} onClose={() => setShowAddParticipantModal(false)} title="Mark Arrival">
         <div className="space-y-4">
             <div>
                <label className="block text-xs font-bold text-jam-400 uppercase tracking-wider mb-1.5">Who arrived?</label>
                <select 
                  className="w-full bg-jam-900 border border-jam-700 rounded-lg p-3 text-white outline-none focus:border-orange-500"
                  value={proxyUserToAdd}
                  onChange={(e) => setProxyUserToAdd(e.target.value)}
                >
                    <option value="" disabled>Select a user...</option>
                    {ALL_USERS.filter(u => !participants.find(p => p.userId === u.toLowerCase().replace(' ', '_'))).map(u => (
                        <option key={u} value={u}>{u}</option>
                    ))}
                </select>
             </div>
             <div>
                <label className="block text-xs font-bold text-jam-400 uppercase tracking-wider mb-1.5">When?</label>
                <input 
                  type="time"
                  step="1"
                  value={proxyArrivalTime} 
                  onChange={(e) => setProxyArrivalTime(e.target.value)} 
                  className="w-full bg-jam-900 border border-jam-700 rounded-lg p-3 text-white focus:border-orange-500 outline-none" 
                />
             </div>
             <Button onClick={confirmProxyParticipant} disabled={!proxyUserToAdd || !proxyArrivalTime} className="w-full mt-2">
               Add Participant
             </Button>
         </div>
      </Modal>

      <Modal isOpen={showAddSong} onClose={() => setShowAddSong(false)} title={editingSongId ? "Edit Song" : "Add Song"}>
        <div className="space-y-5">
          <div>
            <label className="block text-xs font-bold text-jam-400 uppercase tracking-wider mb-1.5">Song Title *</label>
            <input 
              className="w-full bg-jam-900 border border-jam-700 rounded-lg p-3 text-white focus:border-orange-500 focus:ring-1 focus:ring-orange-500 outline-none transition-all placeholder-jam-600" 
              value={newSong.title}
              onChange={e => setNewSong({...newSong, title: e.target.value})}
              placeholder="e.g. Wonderwall"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-jam-400 uppercase tracking-wider mb-1.5">Artist</label>
            <input 
              className="w-full bg-jam-900 border border-jam-700 rounded-lg p-3 text-white focus:border-orange-500 focus:ring-1 focus:ring-orange-500 outline-none transition-all placeholder-jam-600" 
              value={newSong.artist}
              onChange={e => setNewSong({...newSong, artist: e.target.value})}
              placeholder="e.g. Oasis"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-jam-400 uppercase tracking-wider mb-1.5">Who is this for? *</label>
            <select 
               className="w-full bg-jam-900 border border-jam-700 rounded-lg p-3 text-white outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500 transition-all appearance-none"
               value={newSong.ownerId}
               onChange={e => setNewSong({...newSong, ownerId: e.target.value})}
            >
              <option value="" className="text-jam-500">Select participant...</option>
              {participants.map(p => <option key={p.id} value={p.userId}>{p.name}</option>)}
            </select>
          </div>

          <div className="pt-4 border-t border-jam-700">
            <label className="block text-sm font-bold text-jam-200 mb-3">Chords Source (Required)</label>
            <div className="flex bg-jam-900 p-1 rounded-lg mb-4 border border-jam-700">
              <button onClick={() => setNewSong({...newSong, chordType: 'link'})} className={`flex-1 py-2 text-xs font-bold uppercase rounded-md transition-all ${newSong.chordType === 'link' ? 'bg-jam-700 text-white shadow' : 'text-jam-400 hover:text-white'}`}>Link</button>
              <button onClick={() => setNewSong({...newSong, chordType: 'auto_search'})} className={`flex-1 py-2 text-xs font-bold uppercase rounded-md transition-all ${newSong.chordType === 'auto_search' ? 'bg-jam-700 text-white shadow' : 'text-jam-400 hover:text-white'}`}>Search</button>
              <button onClick={() => setNewSong({...newSong, chordType: 'screenshot'})} className={`flex-1 py-2 text-xs font-bold uppercase rounded-md transition-all ${newSong.chordType === 'screenshot' ? 'bg-jam-700 text-white shadow' : 'text-jam-400 hover:text-white'}`}>Image</button>
            </div>

            {newSong.chordType === 'link' && (
              <input 
                className="w-full bg-jam-900 border border-jam-700 rounded-lg p-3 text-white text-sm focus:border-orange-500 outline-none placeholder-jam-600" 
                placeholder="Paste URL here..."
                value={newSong.link}
                onChange={e => setNewSong({...newSong, link: e.target.value})}
              />
            )}

            {newSong.chordType === 'screenshot' && (
              <div className="h-64 bg-jam-900 border-2 border-jam-700 border-dashed rounded-xl text-center hover:border-orange-500/50 hover:bg-jam-800 transition-all relative flex items-center justify-center overflow-hidden">
                 <input 
                    type="file" 
                    accept="image/*" 
                    className="hidden" 
                    id="chord-upload"
                    onChange={handleImageUpload}
                  />
                 <label htmlFor="chord-upload" className="cursor-pointer w-full h-full flex flex-col items-center justify-center gap-3 text-jam-400 hover:text-white transition-colors p-4">
                    {newSong.screenshot ? (
                       <div className="relative group w-full h-full flex items-center justify-center">
                         <img src={newSong.screenshot} alt="Preview" className="max-h-full max-w-full object-contain rounded-lg border border-jam-700 shadow-lg" />
                         <button 
                            onClick={(e) => {
                                e.preventDefault();
                                setNewSong({...newSong, screenshot: ''});
                            }}
                            className="absolute top-2 right-2 p-1.5 bg-red-500 text-white rounded-full shadow-lg hover:bg-red-600 transition-all opacity-0 group-hover:opacity-100 z-10"
                            title="Remove Image"
                         >
                            <Trash2 size={16} />
                         </button>
                       </div>
                    ) : (
                      <>
                        <div className="p-3 bg-jam-800 rounded-full">
                           <Upload size={24} className="text-jam-400" />
                        </div>
                        <span className="text-xs font-medium uppercase tracking-wide">Tap to upload chord screenshot</span>
                      </>
                    )}
                 </label>
              </div>
            )}

            {newSong.chordType === 'auto_search' && (
               <div className="space-y-3">
                 <div className="flex gap-2">
                   <Button variant="secondary" className="w-full text-xs py-3" onClick={performSearch} disabled={isSearching || !newSong.title}>
                      {isSearching ? 'Searching...' : 'Find Chords'} <Search size={14} />
                   </Button>
                 </div>
                 {searchResults.length > 0 && (
                   <div className="space-y-2 max-h-48 overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-jam-700">
                      {searchResults.map((res, i) => (
                        <div key={i} className="bg-jam-900 p-3 rounded-lg cursor-pointer hover:bg-jam-700 border border-jam-800 hover:border-orange-500/50 transition-all group" onClick={() => setNewSong({...newSong, link: res.url, chordType: 'link'})}>
                           <div className="flex items-start justify-between">
                              <div className="text-sm w-4/5">
                                <div className="font-bold text-jam-200 group-hover:text-orange-400 transition-colors">{res.title}</div>
                                <div className="text-xs text-orange-500/80 mb-1 mt-0.5 font-mono bg-orange-500/10 inline-block px-1 rounded">Starts: {res.snippet}</div>
                                <div className="text-[10px] text-jam-500 truncate">{res.url}</div>
                              </div>
                              <div className="p-1 rounded-full bg-jam-800 text-jam-500 group-hover:text-white group-hover:bg-orange-500 transition-all">
                                 <Plus size={14} />
                              </div>
                           </div>
                        </div>
                      ))}
                   </div>
                 )}
               </div>
            )}
          </div>

          <div className="flex justify-end pt-4">
             <Button onClick={handleSaveSong} disabled={!isFormValid} className="w-full sm:w-auto">
               {editingSongId ? 'Save Changes' : 'Add to Queue'}
             </Button>
          </div>
        </div>
      </Modal>

      {/* Rating Modal */}
      <Modal isOpen={!!showRatingModal} onClose={() => setShowRatingModal(null)} title="Rate Song">
         <div className="text-center">
            <h3 className="text-2xl font-bold mb-2 text-white">{showRatingModal?.title}</h3>
            <p className="text-jam-300 mb-8 text-sm uppercase tracking-widest">{showRatingModal?.artist} • {showRatingModal?.ownerName}</p>
            
            <div className="grid grid-cols-2 gap-4 mb-8">
              {RATING_OPTIONS.map(opt => (
                <button 
                  key={opt.value}
                  onClick={() => submitRating(opt.value)}
                  className={`p-5 rounded-2xl border border-jam-700 bg-jam-800/50 hover:bg-jam-700 hover:border-jam-500 hover:-translate-y-1 transition-all flex flex-col items-center gap-3 group ${opt.color}`}
                >
                  <span className="text-2xl group-hover:scale-110 transition-transform block">{opt.label.split(' ')[0]}</span>
                  <span className="font-bold text-sm">{opt.label.split(' ').slice(1).join(' ')}</span>
                </button>
              ))}
            </div>
            <button onClick={() => setShowRatingModal(null)} className="text-jam-500 text-sm hover:text-white hover:underline transition-colors">Skip Rating</button>
         </div>
      </Modal>

    </div>
  );
}
