
import { SongChoice, Rating, JamParticipant, UserName } from "../types";
import { ALL_USERS } from "../constants";

// --- Types ---

export interface ScoredSong {
  song: SongChoice;
  score: number; // 0 to 100
  totalVotes: number;
  breakdown: {
    highlight: number;
    sababa: number;
    ok: number;
    bad: number;
  };
}

export interface UserSimilarity {
  userA: string;
  userB: string;
  score: number; // 0 to 100% similarity
  commonSongs: number;
}

export interface SessionSummary {
  totalSongs: number;
  totalDurationMin: number; // Estimate
  vibeScore: number; // Avg of all ratings
  topContributor: string;
}

// --- Helpers ---

const getRatingValue = (r: Rating['value']): number => {
  switch (r) {
    case 'Highlight': return 100;
    case 'Sababa': return 75; // Sababa is good!
    case 'No comment': return 50;
    case 'Needs work': return 0;
    default: return 50;
  }
};

// --- Core Logic ---

export const getSessionSummary = (songs: SongChoice[], ratings: Rating[]): SessionSummary => {
  const played = songs.filter(s => s.playStatus === 'played');
  if (played.length === 0) return { totalSongs: 0, totalDurationMin: 0, vibeScore: 0, topContributor: '-' };

  // Calculate Average Vibe
  let totalRatingVal = 0;
  let ratingCount = 0;
  
  // Only count ratings for songs in this session
  const sessionSongIds = new Set(played.map(s => s.id));
  const sessionRatings = ratings.filter(r => sessionSongIds.has(r.songChoiceId));

  sessionRatings.forEach(r => {
    totalRatingVal += getRatingValue(r.value);
    ratingCount++;
  });

  const vibeScore = ratingCount > 0 ? Math.round(totalRatingVal / ratingCount) : 0;

  // Find Top Contributor (Most songs played)
  const counts: Record<string, number> = {};
  played.forEach(s => {
    counts[s.ownerName] = (counts[s.ownerName] || 0) + 1;
  });
  
  let topContributor = '-';
  let maxCount = 0;
  Object.entries(counts).forEach(([name, count]) => {
    if (count > maxCount) {
      maxCount = count;
      topContributor = name;
    }
  });

  return {
    totalSongs: played.length,
    totalDurationMin: played.length * 4, // Approx 4 mins per song
    vibeScore,
    topContributor
  };
};

/**
 * Calculates a normalized score for a song based on all ratings provided.
 * If specificUserId is provided, returns that user's rating (or 0 if not rated).
 */
export const calculateSongScore = (
  songId: string, 
  allRatings: Rating[], 
  specificUserId?: string
): ScoredSong | null => {
  const songRatings = allRatings.filter(r => r.songChoiceId === songId);
  
  if (songRatings.length === 0) return null;

  // If we only care about one person's opinion
  if (specificUserId) {
    const userRating = songRatings.find(r => r.userId === specificUserId);
    if (!userRating) return null;
    return {
      song: {} as any, // valid caller will have song ref
      score: getRatingValue(userRating.value),
      totalVotes: 1,
      breakdown: { highlight: 0, sababa: 0, ok: 0, bad: 0 } // Not needed for individual view
    };
  }

  // Crowd Average
  let totalScore = 0;
  const breakdown = { highlight: 0, sababa: 0, ok: 0, bad: 0 };

  songRatings.forEach(r => {
    totalScore += getRatingValue(r.value);
    if (r.value === 'Highlight') breakdown.highlight++;
    else if (r.value === 'Sababa') breakdown.sababa++;
    else if (r.value === 'No comment') breakdown.ok++;
    else if (r.value === 'Needs work') breakdown.bad++;
  });

  return {
    song: {} as any,
    score: Math.round(totalScore / songRatings.length),
    totalVotes: songRatings.length,
    breakdown
  };
};

/**
 * Returns a list of all played songs sorted by score.
 * Can be filtered by "According to [User]"
 */
export const getLeaderboard = (
  songs: SongChoice[], 
  ratings: Rating[], 
  perspectiveUser?: string
): ScoredSong[] => {
  const played = songs.filter(s => s.playStatus === 'played');
  
  const results = played.map(s => {
    const stats = calculateSongScore(s.id, ratings, perspectiveUser);
    if (!stats) return null;
    return { ...stats, song: s };
  }).filter(Boolean) as ScoredSong[];

  return results.sort((a, b) => b.score - a.score);
};

/**
 * Returns similarity matrix for all users who have rated things.
 */
export const calculateTasteSimilarity = (
  allRatings: Rating[], 
  participants: JamParticipant[]
): { soulmates: UserSimilarity[], opposites: UserSimilarity[] } => {
  const activeUserIds = Array.from(new Set(allRatings.map(r => r.userId)));
  const pairs: UserSimilarity[] = [];

  for (let i = 0; i < activeUserIds.length; i++) {
    for (let j = i + 1; j < activeUserIds.length; j++) {
      const uA = activeUserIds[i];
      const uB = activeUserIds[j];

      // Find common songs
      const songsA = new Map(allRatings.filter(r => r.userId === uA).map(r => [r.songChoiceId, r]));
      const songsB = new Map(allRatings.filter(r => r.userId === uB).map(r => [r.songChoiceId, r]));

      let matchScoreSum = 0;
      let commonCount = 0;

      songsA.forEach((ratingA, songId) => {
        const ratingB = songsB.get(songId);
        if (ratingB) {
          commonCount++;
          const valA = getRatingValue(ratingA.value);
          const valB = getRatingValue(ratingB.value);
          
          // Difference: 0 (Same) to 100 (Highlight vs Needs work)
          const diff = Math.abs(valA - valB);
          
          // Similarity for this song: 100 (Perfect) to 0 (Opposite)
          matchScoreSum += (100 - diff);
        }
      });

      if (commonCount >= 2) { // Need at least 2 common songs to judge taste
        pairs.push({
          userA: uA,
          userB: uB,
          score: Math.round(matchScoreSum / commonCount),
          commonSongs: commonCount
        });
      }
    }
  }

  const soulmates = [...pairs].sort((a, b) => b.score - a.score);
  const opposites = [...pairs].sort((a, b) => a.score - b.score);

  return { soulmates, opposites };
};

export const getCrowdPleasers = (songs: SongChoice[], ratings: Rating[]) => {
    const ownerStats = new Map<string, { totalScore: number, songCount: number }>();

    songs.filter(s => s.playStatus === 'played').forEach(s => {
        const stats = calculateSongScore(s.id, ratings);
        if (stats) {
            const current = ownerStats.get(s.ownerUserId) || { totalScore: 0, songCount: 0 };
            current.totalScore += stats.score;
            current.songCount++;
            ownerStats.set(s.ownerUserId, current);
        }
    });

    return Array.from(ownerStats.entries())
        .map(([userId, data]) => ({
            userId,
            avgScore: Math.round(data.totalScore / data.songCount),
            songCount: data.songCount
        }))
        .sort((a, b) => b.avgScore - a.avgScore);
};

export const getBiggestThieves = (songs: SongChoice[]) => {
    const theftCounts: Record<string, number> = {};
    
    songs.forEach(s => {
        if (s.isStolen) {
            // Count theft against the song owner (they benefited from the steal)
            const name = s.ownerName;
            theftCounts[name] = (theftCounts[name] || 0) + 1;
        }
    });

    return Object.entries(theftCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => ({ name, count }));
};

export const getUserRatingHistory = (userId: string, ratings: Rating[], songs: SongChoice[]) => {
    // 1. Find all ratings by this user
    const userRatings = ratings.filter(r => r.userId === userId);
    
    // 2. Map to song details
    return userRatings.map(r => {
        const song = songs.find(s => s.id === r.songChoiceId);
        if (!song) return null;
        return {
            rating: r.value,
            songTitle: song.title,
            songArtist: song.artist,
            performer: song.ownerName,
            playedAt: song.playedAt
        };
    }).filter(Boolean).sort((a, b) => (b!.playedAt || 0) - (a!.playedAt || 0));
};
