import { SongChoice, JamParticipant } from "../types";

/**
 * Re-calculates the queue order based on fairness rules and "stolen" locks.
 * 
 * Rules:
 * 1. Stolen songs stay at their current relative index if possible.
 * 2. Non-stolen songs are sorted by: Round -> Arrival Order -> Submission Time.
 */
export const rebalanceQueue = (
  allSongs: SongChoice[],
  participants: JamParticipant[],
  currentOrderIds: string[]
): string[] => {
  // 1. Filter relevant songs (not played, currently in the queue or new)
  const activeSongs = allSongs.filter(s => s.playStatus !== 'played');
  
  // Map for quick lookup
  const songMap = new Map(activeSongs.map(s => [s.id, s]));

  // FIX: Sort participants by arrivalTime to ensure rank is based on TIME, not array order.
  // This fixes the issue where adding a proxy user (who is appended to array) calculated the wrong rank.
  const sortedParticipants = [...participants].sort((a, b) => a.arrivalTime - b.arrivalTime);
  const participantArrivalMap = new Map(sortedParticipants.map((p, index) => [p.userId, index])); // 0 is first

  // 2. Identify Stolen Songs and their preferred indices based on currentOrderIds
  // If a stolen song isn't in currentOrderIds (e.g. state inconsistency), append it.
  const stolenSongs = activeSongs.filter(s => s.isStolen);
  const fairSongs = activeSongs.filter(s => !s.isStolen);

  // 3. Calculate "Fair Score" for non-stolen songs
  // We need to know which "Round" this song is for the owner.
  // Sort user's songs by submission time to determine round.
  const songsByUser = new Map<string, SongChoice[]>();
  
  // We must consider PLAYED songs to determine the round count correctly
  const playedSongs = allSongs.filter(s => s.playStatus === 'played');
  [...playedSongs, ...activeSongs].sort((a, b) => a.submissionTime - b.submissionTime).forEach(s => {
    if (!songsByUser.has(s.ownerUserId)) songsByUser.set(s.ownerUserId, []);
    songsByUser.get(s.ownerUserId)?.push(s);
  });

  const getFairScore = (song: SongChoice) => {
    const userSongs = songsByUser.get(song.ownerUserId) || [];
    // Index in user's history (0-based)
    const personalIndex = userSongs.findIndex(s => s.id === song.id); 
    const roundIndex = personalIndex === -1 ? 999 : personalIndex;
    
    const arrivalRank = participantArrivalMap.get(song.ownerUserId) ?? 999;

    // Score components:
    // Round: Huge weight (Primary sort)
    // Arrival: Medium weight (Secondary sort)
    // Submission: Tiny weight (Tie breaker)
    return (roundIndex * 100000) + (arrivalRank * 1000) + (song.submissionTime / 10000000000000);
  };

  const sortedFairSongs = [...fairSongs].sort((a, b) => getFairScore(a) - getFairScore(b));

  // 4. Construct the new order
  // We try to respect the visual position of stolen songs from 'currentOrderIds'.
  const newOrder: string[] = [];
  
  // Create a sparse array for stolen songs
  const stolenPositions: { [index: number]: string } = {};
  
  stolenSongs.forEach(song => {
    const currentIdx = currentOrderIds.indexOf(song.id);
    if (currentIdx !== -1) {
        stolenPositions[currentIdx] = song.id;
    } else {
        // If meant to be stolen but lost its place, treat as fair for a moment or append
        sortedFairSongs.push(song); 
    }
  });

  // Re-assemble
  // We iterate through slots. If a slot is reserved for a stolen song, use it.
  // Otherwise, pop the next fair song.
  // NOTE: This assumes the list size is constant or growing. 
  // If dragged to index 5, but we only have 3 songs total now, index 5 is invalid.
  // So we compress the stolen indices relative to the active count.
  
  // Simpler approach for React DnD stability:
  // 1. Create a list of "slots" based on current active songs count.
  // 2. Place stolen songs in their relative positions if possible.
  // 3. Fill gaps with fair songs.

  const totalSlots = activeSongs.length;
  const resultSlots: (string | null)[] = new Array(totalSlots).fill(null);

  // Place stolen songs
  stolenSongs.forEach(s => {
    let idx = currentOrderIds.indexOf(s.id);
    if (idx === -1) idx = totalSlots - 1; // Fallback
    if (idx >= totalSlots) idx = totalSlots - 1;
    
    // Find closest empty slot if occupied (shouldn't happen in valid DnD but safety first)
    while (resultSlots[idx] !== null && idx < totalSlots - 1) idx++;
    while (resultSlots[idx] !== null && idx > 0) idx--;
    
    resultSlots[idx] = s.id;
  });

  // Fill nulls with fair songs
  let fairIdx = 0;
  for (let i = 0; i < totalSlots; i++) {
    if (resultSlots[i] === null) {
        if (fairIdx < sortedFairSongs.length) {
            resultSlots[i] = sortedFairSongs[fairIdx].id;
            fairIdx++;
        }
    }
  }

  // If any fair songs remain (due to slot collision logic), append them
  while (fairIdx < sortedFairSongs.length) {
      resultSlots.push(sortedFairSongs[fairIdx].id);
      fairIdx++;
  }

  return resultSlots.filter(Boolean) as string[];
};