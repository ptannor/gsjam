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
  Trophy, Heart, Activity, History, ChevronDown, CloudLightning, LogOut, Undo2, UserPlus, Star, Eye
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

// Extract domain for display
const getDomain = (url?: string, title?: string) => {
  if (!url) return '';
  try {
      const hostname = new URL(url).hostname;
      // Handle ugly Google/Vertex wrapper links
      if (hostname.includes('vertexaisearch') || hostname.includes('google')) {
          if (title) {
            const lowerTitle = title.toLowerCase();
            if (lowerTitle.includes('ultimate')) return 'ultimate-guitar.com';
            if (lowerTitle.includes('tab4u')) return 'tab4u.com';
            if (lowerTitle.includes('negina')) return 'negina.co.il';
            if (lowerTitle.includes('nagnu')) return 'nagnu.co.il';
            if (lowerTitle.includes('songsterr')) return 'songsterr.com';
            if (lowerTitle.includes('e-chords')) return 'e-chords.com';
          }
          return 'Search Result';
      }
      return hostname.replace('www.', '').replace('tabs.', '');
  } catch { return 'link'; }
};

// --- Utility Components ---

const Modal = ({ isOpen, onClose, children, title, size = 'md' }: { isOpen: boolean; onClose: () => void; children: React.ReactNode; title: string, size?: 'md' | 'lg' | 'xl' }) => {
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

// --- Sortable Item Component ---

function SortableSongItem({ 
  song, index, participant, onMarkPlaying, onMarkPlayed, onDelete, onRevive, onEdit, onUnsteal, isCurrent, onViewImage, onRate
}: { 
  song: SongChoice; index: number; participant?: JamParticipant; 
  onMarkPlaying?: () => void; onMarkPlayed?: () => void; onDelete?: () => void; onRevive?: () => void; onEdit?: () => void; onUnsteal?: () => void;
  isCurrent: boolean;
  onViewImage?: (url: string) => void;
  onRate?: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: song.id });
  
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const isPlayed = song.playStatus === 'played';

  return (
    <div ref={setNodeRef} style={style} className={`relative mb-3 group ${isPlayed ? 'opacity-80' : ''}`}>
      <div className={`
        flex items-center gap-4 p-4 rounded-xl border transition-all duration-300
        ${isCurrent ? 'bg-jam-800 border-orange-500/50 shadow-[0_0_25px_rgba(249,115,22,0.1)]' : 'bg-jam-800 border-jam-700 hover:border-jam-600 hover:bg-jam-700/50'}
        ${isPlayed ? 'bg-jam-900 border-jam-800 hover:bg-jam-800' : ''}
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
                 <ExternalLink size={10} /> Link to Chords
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

          {/* Rate Button for Played Songs (Retroactive) */}
          {isPlayed && onRate && (
             <button onClick={onRate} className="p-2 text-yellow-500 hover:text-yellow-400 hover:bg-yellow-500/10 rounded-full transition-all" title="Rate this song">
               <Star size={18} />
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

  // Edit Arrival Time State
  const [editingParticipant, setEditingParticipant] = useState<JamParticipant | null>(null);
  const [editArrivalTimeValue, setEditArrivalTimeValue] = useState<string>('');

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
    const timeString = now.toTimeString().split(' ')[0]; // HH:mm:ss
    setManualArrivalTime(timeString);
  };

  const confirmJoin = (timeMode: 'now' | 'manual') => {
    if (!session || !joiningUser) return;
    
    const userId = joiningUser.toLowerCase().replace(' ', '_');
    const user = { id: userId, name: joiningUser };
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

  // Select a result from search
  const selectSearchResult = (result: ChordSearchResult) => {
      setNewSong({ ...newSong, link: result.url });
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
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
  
  // NEW: Played Songs list for main view (sorted newest played LAST, essentially chronologically or reverse?)
  // Usually for a log you want newest played at top, or bottom? User requested "played songs list in order".
  // Let's do chronological (Song 1, Song 2...)
  const playedSongsList = songs
    .filter(s => s.playStatus === 'played')
    .sort((a, b) => (a.playedAt || 0) - (b.playedAt || 0));

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
              <button key={u} onClick={() => handleJoinSelection(u)} className="bg-jam-700/50 hover:bg-orange-600 hover:text-white p-3 rounded-lg text-sm font-medium transition-all text-left text-jam-200 border border-transparent hover:border-orange-500/50">
                {u}
              </button>
            ))}
          </div>
          <div className="text-center text-xs text-jam-500">
            Current Session: <span className="text-jam-300 font-mono">{session?.date || getLocalDate()}</span>
          </div>

          {/* Session Preview for unauthenticated users */}
          {session && (
            <div className="mt-8 pt-6 border-t border-jam-700 w-full">
                <h3 className="text-jam-400 text-xs font-bold uppercase mb-3 text-center">Current Session</h3>
                <div className="bg-jam-900/50 rounded-xl p-4 space-y-3">
                    <div className="flex justify-between items-center text-sm">
                        <span className="text-jam-300">Participants</span>
                        <span className="text-white font-bold">{participants.length}</span>
                    </div>
                     <div className="flex justify-between items-center text-sm">
                        <span className="text-jam-300">Songs in Queue</span>
                        <span className="text-white font-bold">{queueIds.length}</span>
                    </div>
                     <div className="flex justify-between items-center text-sm">
                        <span className="text-jam-300">Songs Played</span>
                        <span className="text-white font-bold">{songs.filter(s => s.playStatus === 'played').length}</span>
                    </div>
                    {/* Show last 3 played songs */}
                    {songs.filter(s => s.playStatus === 'played').length > 0 && (
                        <div className="mt-3 pt-3 border-t border-jam-700/50">
                            <p className="text-xs text-jam-500 mb-2">Recently Played:</p>
                            <div className="space-y-1">
                                {songs
                                    .filter(s => s.playStatus === 'played')
                                    .sort((a,b) => (b.playedAt || 0) - (a.playedAt || 0)) // Newest first for preview
                                    .slice(0, 3)
                                    .map(s => (
                                        <div key={s.id} className="text-xs text-jam-300 truncate">
                                            🎶 {s.title} <span className="text-jam-500">- {s.ownerName}</span>
                                        </div>
                                    ))
                                }
                            </div>
                        </div>
                    )}
                </div>
            </div>
          )}

        </div>
      </div>
    );
  }

  // --- Main View (Logged In) ---

  return (
    <div className="min-h-screen bg-jam-950 text-jam-100 flex">
      {/* Sidebar */}
      <aside className="w-64 bg-jam-900 border-r border-jam-800 flex flex-col fixed h-full z-20 hidden md:flex">
        <div className="p-6 border-b border-jam-800">
           <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2">
             <span className="text-orange-500">GS</span> Jam
           </h1>
           <div className="mt-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
                <span className="text-xs font-bold text-jam-300 uppercase tracking-wider">Live Session</span>
              </div>
              <div className="text-xs text-jam-500 font-mono">{session?.date}</div>
           </div>
        </div>
        
        <nav className="p-4 space-y-1">
          <button onClick={() => setView('jam')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all ${view === 'jam' ? 'bg-orange-600 text-white shadow-lg shadow-orange-900/20' : 'text-jam-400 hover:text-white hover:bg-jam-800'}`}>
            <Music size={18} /> Today's Jam
          </button>
          <button onClick={() => setView('stats')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all ${view === 'stats' ? 'bg-orange-600 text-white shadow-lg shadow-orange-900/20' : 'text-jam-400 hover:text-white hover:bg-jam-800'}`}>
            <BarChart2 size={18} /> Stats & History
          </button>
        </nav>

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
                {/* Edit Arrival Time Button */}
                <button onClick={() => openEditParticipantModal(p)} className="opacity-0 group-hover:opacity-100 text-jam-500 hover:text-white transition-opacity">
                    <Pencil size={12} />
                </button>
              </div>
            ))}
            {participants.length === 0 && <div className="text-xs text-jam-600 italic px-2">No one here yet...</div>}
          </div>
        </div>

        <div className="p-4 border-t border-jam-800 bg-jam-900/50">
           <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-jam-500">Logged in as</span>
              <button onClick={() => setCurrentUser(null)} className="text-jam-500 hover:text-red-400 transition-colors" title="Logout">
                  <LogOut size={14} />
              </button>
           </div>
           <div className="font-bold text-white truncate">{currentUser.name}</div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 md:ml-64 p-4 md:p-8 min-h-screen">
        
        {/* Mobile Header */}
        <div className="md:hidden flex items-center justify-between mb-6">
           <div className="font-bold text-xl text-white">GS <span className="text-orange-500">Jam</span></div>
           <div className="flex gap-2">
              <button onClick={() => setView('jam')} className={`p-2 rounded-lg ${view === 'jam' ? 'bg-orange-600 text-white' : 'bg-jam-800 text-jam-400'}`}><Music size={20}/></button>
              <button onClick={() => setView('stats')} className={`p-2 rounded-lg ${view === 'stats' ? 'bg-orange-600 text-white' : 'bg-jam-800 text-jam-400'}`}><BarChart2 size={20}/></button>
              <button onClick={() => setCurrentUser(null)} className="p-2 rounded-lg bg-jam-800 text-red-400"><LogOut size={20}/></button>
           </div>
        </div>

        {view === 'jam' && (
          <div className="max-w-3xl mx-auto space-y-6 pb-40">
             <div className="flex items-center justify-between">
               <div>
                  <h2 className="text-3xl font-bold text-white">Queue</h2>
                  <p className="text-jam-400 text-sm">Drag to reorder • Fair by default</p>
               </div>
               <Button onClick={openAddModal}>
                 <Plus size={18} /> Add Song
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
                        <Music size={48} className="mx-auto mb-3 opacity-20" />
                        <p>No songs in the queue yet.</p>
                        <button onClick={openAddModal} className="text-orange-500 font-bold hover:underline mt-2">Add the first one!</button>
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
                          onViewImage={setViewingImage}
                        />
                      ))
                   )}
                 </div>
               </SortableContext>
             </DndContext>

             {/* Played Songs Section - Always visible if songs exist */}
             {playedSongsList.length > 0 && (
                 <div className="mt-12 pt-8 border-t border-jam-800">
                    <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                        <History size={20} className="text-jam-500" />
                        Played Songs
                    </h3>
                    <div className="space-y-3 opacity-80">
                        {playedSongsList.map((song, index) => {
                           // Check if current user has rated this song
                           // If currentUser is not set (rare, but possible if viewing page without logging in), assume false
                           const hasRated = currentUser ? ratings.some(r => r.songChoiceId === song.id && r.userId === currentUser.id) : true;

                           return (
                               <SortableSongItem
                                  key={song.id}
                                  song={song}
                                  index={index}
                                  isCurrent={false}
                                  onRevive={() => reviveSong(song.id)}
                                  onViewImage={setViewingImage}
                                  // Show rate button if logged in and not rated
                                  onRate={(!hasRated && currentUser) ? () => setShowRatingModal(song) : undefined}
                               />
                           );
                        })}
                    </div>
                 </div>
             )}
          </div>
        )}

        {view === 'stats' && (
           <div className="max-w-4xl mx-auto pb-40">
              <div className="flex gap-4 mb-8 overflow-x-auto pb-2 scrollbar-hide">
                 {[
                   { id: 'today', label: 'Today', icon: Activity },
                   { id: 'history', label: 'History', icon: History },
                   { id: 'leaderboards', label: 'Leaderboards', icon: Trophy },
                   { id: 'taste', label: 'Taste Buds', icon: Heart },
                 ].map(tab => (
                    <button 
                      key={tab.id}
                      onClick={() => setStatsTab(tab.id as any)}
                      className={`flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-bold whitespace-nowrap transition-all ${statsTab === tab.id ? 'bg-orange-600 text-white' : 'bg-jam-800 text-jam-400 hover:bg-jam-700'}`}
                    >
                      <tab.icon size={16} /> {tab.label}
                    </button>
                 ))}
              </div>

              {statsTab === 'today' && (
                 <div className="animate-fade-in space-y-8">
                    {/* Top Rated Section */}
                    {leaderboard.length > 0 && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="bg-jam-800/50 border border-jam-700 rounded-2xl p-6">
                                <h3 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
                                    <Trophy className="text-yellow-400" size={20} /> Crowd Favorites
                                </h3>
                                <div className="space-y-5">
                                    {leaderboard.slice(0, 5).map((item, idx) => (
                                        <div key={item.song.id} className="relative">
                                            <div className="flex items-center gap-4">
                                                <div className="text-2xl font-bold text-jam-600 w-6">#{idx + 1}</div>
                                                <div className="flex-1">
                                                    <div className="font-bold text-white">{item.song.title}</div>
                                                    <div className="text-xs text-jam-400">{item.song.ownerName}</div>
                                                    
                                                    {/* Vote Breakdown Visuals */}
                                                    <div className="flex gap-1 mt-1.5">
                                                        {Array.from({length: item.breakdown.highlight}).map((_, i) => <div key={`h-${i}`} className="w-2 h-2 rounded-full bg-green-400"></div>)}
                                                        {Array.from({length: item.breakdown.sababa}).map((_, i) => <div key={`s-${i}`} className="w-2 h-2 rounded-full bg-yellow-400"></div>)}
                                                        {Array.from({length: item.breakdown.ok}).map((_, i) => <div key={`o-${i}`} className="w-2 h-2 rounded-full bg-gray-600"></div>)}
                                                    </div>
                                                </div>
                                                
                                                {/* Donut Chart */}
                                                <div className="relative w-12 h-12 rounded-full flex items-center justify-center bg-jam-800"
                                                    style={{
                                                        background: `conic-gradient(
                                                            #4ade80 0% ${(item.breakdown.highlight / item.totalVotes) * 100}%,
                                                            #facc15 ${(item.breakdown.highlight / item.totalVotes) * 100}% ${((item.breakdown.highlight + item.breakdown.sababa) / item.totalVotes) * 100}%,
                                                            #4b5563 ${((item.breakdown.highlight + item.breakdown.sababa) / item.totalVotes) * 100}% 100%
                                                        )`
                                                    }}
                                                >
                                                    <div className="absolute inset-2 bg-jam-800 rounded-full"></div>
                                                </div>
                                            </div>
                                            
                                            {/* Who voted what */}
                                            <div className="mt-2 text-[10px] text-jam-500 pl-10">
                                                {activeStatsRatings.filter(r => r.songChoiceId === item.song.id && (r.value === 'Highlight' || r.value === 'Sababa')).map(r => {
                                                    const voterName = participants.find(p => p.userId === r.userId)?.name.split(' ')[0];
                                                    return (
                                                        <span key={r.id} className={`inline-block mr-2 ${r.value === 'Highlight' ? 'text-green-400' : 'text-yellow-400'}`}>
                                                            {voterName}
                                                        </span>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                            
                            <div className="bg-jam-800/50 border border-jam-700 rounded-2xl p-6">
                                <h3 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
                                    <Clock className="text-blue-400" size={20} /> Session Log
                                </h3>
                                <div className="relative border-l-2 border-jam-700 ml-3 space-y-6">
                                    {arrivalTimeline.map((p, i) => (
                                        <div key={p.id} className="relative pl-6">
                                            <div className="absolute -left-[9px] top-1 w-4 h-4 rounded-full bg-jam-900 border-2 border-blue-500"></div>
                                            <div className="text-sm font-bold text-white">{p.name} arrived</div>
                                            <div className="text-xs text-jam-500">{new Date(p.arrivalTime).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Session Digest Table */}
                    <div className="bg-jam-800 border border-jam-700 rounded-2xl overflow-hidden">
                        <table className="w-full text-left text-sm">
                            <thead className="bg-jam-900 text-jam-400 uppercase text-xs font-bold tracking-wider">
                                <tr>
                                    <th className="p-4">Time</th>
                                    <th className="p-4">Song</th>
                                    <th className="p-4">Picked By</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-jam-700">
                                {sessionDigest.map((row) => (
                                    <tr key={row.id} className="hover:bg-jam-700/30 transition-colors">
                                        <td className="p-4 font-mono text-jam-500">
                                            {row.playedAt ? new Date(row.playedAt).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : '-'}
                                        </td>
                                        <td className="p-4">
                                            <div className="font-bold text-white">{row.title}</div>
                                            <div className="text-jam-400 text-xs">{row.artist}</div>
                                        </td>
                                        <td className="p-4">
                                            <div className="flex items-center gap-2">
                                                <div className="w-6 h-6 rounded-full bg-jam-700 flex items-center justify-center text-[10px] font-bold text-jam-300">
                                                    {row.ownerName.charAt(0)}
                                                </div>
                                                <span className="text-jam-300">{row.ownerName}</span>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                                {sessionDigest.length === 0 && (
                                    <tr><td colSpan={3} className="p-8 text-center text-jam-500 italic">No songs played yet.</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                 </div>
              )}

              {statsTab === 'history' && (
                  <div className="space-y-6 animate-fade-in">
                      <div className="flex items-center gap-4 bg-jam-800 p-4 rounded-xl border border-jam-700">
                          <label className="text-sm font-bold text-jam-300">Select Date:</label>
                          <div className="relative flex-1">
                              <select 
                                value={historyDate} 
                                onChange={(e) => setHistoryDate(e.target.value)}
                                className="w-full appearance-none bg-jam-900 border border-jam-600 rounded-lg px-4 py-2 text-white outline-none focus:border-orange-500 cursor-pointer"
                              >
                                  <option value="">-- Choose a session --</option>
                                  {Object.keys(archives).sort().reverse().map(date => (
                                      <option key={date} value={date}>{date}</option>
                                  ))}
                              </select>
                              <ChevronDown className="absolute right-3 top-3 text-jam-500 pointer-events-none" size={16} />
                          </div>
                          {historyDate && (
                              <button onClick={() => deleteHistorySession(historyDate)} className="p-2 text-jam-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg">
                                  <Trash2 size={18} />
                              </button>
                          )}
                      </div>

                      {historyDate && (
                          <div className="bg-jam-800 border border-jam-700 rounded-2xl overflow-hidden">
                              <table className="w-full text-left text-sm">
                                  <thead className="bg-jam-900 text-jam-400 uppercase text-xs font-bold tracking-wider">
                                      <tr>
                                          <th className="p-4">Time</th>
                                          <th className="p-4">Song</th>
                                          <th className="p-4">Picked By</th>
                                      </tr>
                                  </thead>
                                  <tbody className="divide-y divide-jam-700">
                                      {sessionDigest.map((row) => (
                                          <tr key={row.id} className="hover:bg-jam-700/30 transition-colors">
                                              <td className="p-4 font-mono text-jam-500">
                                                  {row.playedAt ? new Date(row.playedAt).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : '-'}
                                              </td>
                                              <td className="p-4">
                                                  <div className="font-bold text-white">{row.title}</div>
                                                  <div className="text-jam-400 text-xs">{row.artist}</div>
                                              </td>
                                              <td className="p-4">
                                                  <div className="flex items-center gap-2">
                                                      <div className="w-6 h-6 rounded-full bg-jam-700 flex items-center justify-center text-[10px] font-bold text-jam-300">
                                                          {row.ownerName.charAt(0)}
                                                      </div>
                                                      <span className="text-jam-300">{row.ownerName}</span>
                                                  </div>
                                              </td>
                                          </tr>
                                      ))}
                                  </tbody>
                              </table>
                          </div>
                      )}
                  </div>
              )}
           </div>
        )}
      </main>

      {/* --- Modals --- */}
      
      {/* Add Song Modal */}
      <Modal isOpen={showAddSong} onClose={() => setShowAddSong(false)} title={editingSongId ? "Edit Song" : "Add Song"}>
          <div className="space-y-4">
             <div>
               <label className="block text-xs font-bold text-jam-400 mb-1 uppercase">Title</label>
               <input 
                 className="w-full bg-jam-900 border border-jam-700 rounded-lg p-3 text-white focus:border-orange-500 outline-none" 
                 placeholder="e.g. Wonderwall"
                 value={newSong.title}
                 onChange={e => setNewSong({...newSong, title: e.target.value})}
               />
             </div>
             
             <div>
               <label className="block text-xs font-bold text-jam-400 mb-1 uppercase">Artist (Optional)</label>
               <input 
                 className="w-full bg-jam-900 border border-jam-700 rounded-lg p-3 text-white focus:border-orange-500 outline-none" 
                 placeholder="e.g. Oasis"
                 value={newSong.artist}
                 onChange={e => setNewSong({...newSong, artist: e.target.value})}
               />
             </div>
             
             <div>
               <label className="block text-xs font-bold text-jam-400 mb-1 uppercase">Who is this for?</label>
               <select 
                 className="w-full bg-jam-900 border border-jam-700 rounded-lg p-3 text-white focus:border-orange-500 outline-none"
                 value={newSong.ownerId}
                 onChange={e => setNewSong({...newSong, ownerId: e.target.value})}
               >
                 <option value="" disabled>Select Participant</option>
                 {participants.map(p => (
                   <option key={p.userId} value={p.userId}>{p.name}</option>
                 ))}
               </select>
             </div>

             <div className="border-t border-jam-700 pt-4">
                <label className="block text-xs font-bold text-jam-400 mb-2 uppercase">Chords Source</label>
                <div className="flex gap-2 mb-4">
                  <button onClick={() => setNewSong({...newSong, chordType: 'link'})} className={`flex-1 py-2 rounded-lg text-sm font-medium ${newSong.chordType === 'link' ? 'bg-orange-600 text-white' : 'bg-jam-700 text-jam-400'}`}>Link / Search</button>
                  <button onClick={() => setNewSong({...newSong, chordType: 'screenshot'})} className={`flex-1 py-2 rounded-lg text-sm font-medium ${newSong.chordType === 'screenshot' ? 'bg-orange-600 text-white' : 'bg-jam-700 text-jam-400'}`}>Screenshot</button>
                </div>

                {newSong.chordType === 'link' && (
                  <div className="space-y-3">
                    <div className="flex gap-2">
                       <input 
                          className="flex-1 bg-jam-900 border border-jam-700 rounded-lg p-3 text-white focus:border-orange-500 outline-none text-sm" 
                          placeholder="Paste URL or search..."
                          value={newSong.link}
                          onChange={e => setNewSong({...newSong, link: e.target.value})}
                       />
                       <Button variant="secondary" onClick={performSearch} disabled={isSearching || !newSong.title}>
                          {isSearching ? <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full"></div> : <Search size={18} />}
                       </Button>
                    </div>

                    {searchResults.length > 0 && (
                      <div className="space-y-2 mt-2">
                        {searchResults.map((result, idx) => (
                           <div key={idx} onClick={() => selectSearchResult(result)} className="p-3 rounded-lg bg-jam-900 border border-jam-700 hover:border-orange-500 cursor-pointer transition-colors group flex items-center gap-3">
                              <div className="flex-1">
                                  <div className="font-bold text-sm text-white group-hover:text-orange-400">{result.title}</div>
                                  <div className="text-[10px] text-jam-500 uppercase font-bold tracking-wider">{result.snippet}</div>
                              </div>
                              <button 
                                onClick={(e) => { 
                                    e.stopPropagation(); 
                                    window.open(result.url, '_blank');
                                }}
                                className="p-2 text-jam-400 hover:text-white hover:bg-jam-700 rounded-full transition-colors"
                                title="Open in New Tab"
                              >
                                  <Eye size={18} />
                              </button>
                           </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {newSong.chordType === 'screenshot' && (
                  <div className="h-64 border-2 border-dashed border-jam-600 rounded-xl flex flex-col items-center justify-center relative overflow-hidden bg-jam-900/50">
                    {newSong.screenshot ? (
                      <div className="relative w-full h-full p-2 flex items-center justify-center">
                         <img src={newSong.screenshot} alt="Preview" className="max-w-full max-h-full object-contain rounded-lg" />
                         <button onClick={() => setNewSong({...newSong, screenshot: ''})} className="absolute top-2 right-2 bg-red-500/80 hover:bg-red-500 text-white p-2 rounded-full shadow-lg transition-colors">
                           <Trash2 size={16} />
                         </button>
                      </div>
                    ) : (
                      <>
                        <Upload size={32} className="text-jam-500 mb-2" />
                        <span className="text-sm text-jam-400">Tap to upload image</span>
                        <input type="file" accept="image/*" onChange={handleImageUpload} className="absolute inset-0 opacity-0 cursor-pointer" />
                      </>
                    )}
                  </div>
                )}
             </div>

             <Button className="w-full py-3 mt-4" onClick={handleSaveSong} disabled={!isFormValid}>
                {editingSongId ? 'Save Changes' : 'Add to Queue'}
             </Button>
          </div>
      </Modal>

      {/* Rating Modal */}
      <Modal isOpen={!!showRatingModal} onClose={() => setShowRatingModal(null)} title="Rate this Performance">
        <div className="text-center">
           <h3 className="text-xl font-bold text-white mb-1">{showRatingModal?.title}</h3>
           <p className="text-jam-400 mb-6">by {showRatingModal?.ownerName}</p>
           
           <div className="grid grid-cols-1 gap-3">
             {RATING_OPTIONS.map(option => (
               <button 
                 key={option.value}
                 onClick={() => submitRating(option.value)}
                 className={`p-4 rounded-xl border border-jam-700 bg-jam-800 hover:bg-jam-700 transition-all flex items-center justify-center gap-3 group`}
               >
                 <span className={`text-lg font-bold ${option.color}`}>{option.label}</span>
               </button>
             ))}
           </div>
        </div>
      </Modal>

      {/* Add Participant Modal */}
      <Modal isOpen={showAddParticipantModal} onClose={() => setShowAddParticipantModal(false)} title="Add Participant">
          <div className="space-y-4">
             <div>
                <label className="block text-xs font-bold text-jam-400 mb-1 uppercase">Name</label>
                <select 
                    className="w-full bg-jam-900 border border-jam-700 rounded-lg p-3 text-white focus:border-orange-500 outline-none"
                    value={proxyUserToAdd}
                    onChange={(e) => setProxyUserToAdd(e.target.value)}
                >
                    <option value="" disabled>Select Name</option>
                    {ALL_USERS.map(u => (
                        <option key={u} value={u}>{u}</option>
                    ))}
                </select>
             </div>
             <div>
                <label className="block text-xs font-bold text-jam-400 mb-1 uppercase">Arrival Time</label>
                <input 
                    type="time" 
                    step="1" 
                    value={proxyArrivalTime} 
                    onChange={(e) => setProxyArrivalTime(e.target.value)} 
                    className="w-full bg-jam-900 border border-jam-700 rounded-lg p-3 text-white focus:border-orange-500 outline-none" 
                />
             </div>
             <Button className="w-full" onClick={confirmProxyParticipant} disabled={!proxyUserToAdd}>Add User</Button>
          </div>
      </Modal>

      {/* Edit Participant Arrival Time Modal */}
      <Modal isOpen={!!editingParticipant} onClose={() => setEditingParticipant(null)} title="Edit Arrival Time">
          <div className="space-y-4">
             <div className="text-center text-white font-bold text-lg mb-2">{editingParticipant?.name}</div>
             <div>
                <label className="block text-xs font-bold text-jam-400 mb-1 uppercase">Arrival Time</label>
                <input 
                    type="time" 
                    step="1" 
                    value={editArrivalTimeValue} 
                    onChange={(e) => setEditArrivalTimeValue(e.target.value)} 
                    className="w-full bg-jam-900 border border-jam-700 rounded-lg p-3 text-white focus:border-orange-500 outline-none text-center text-xl" 
                />
             </div>
             <div className="text-xs text-yellow-500 bg-yellow-500/10 p-3 rounded-lg border border-yellow-500/20">
                Warning: Changing arrival time will immediately reshuffle the fair queue order.
             </div>
             <Button className="w-full" onClick={saveParticipantEdit}>Update Time</Button>
          </div>
      </Modal>

      {/* Image Viewer Overlay */}
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