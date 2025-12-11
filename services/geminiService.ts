
import { GoogleGenAI } from "@google/genai";
import { ChordSearchResult } from "../types";

// --- Key Management & Rotation ---

const getAvailableApiKeys = () => {
    const keys: { value: string, label: string }[] = [];
    
    // Check standard key
    if (process.env.API_KEY) {
        keys.push({ value: process.env.API_KEY, label: 'Standard API_KEY' });
    }
    
    // Check numbered keys 1-10
    for (let i = 1; i <= 10; i++) {
        const keyVal = process.env[`API_KEY_${i}`];
        if (keyVal) {
            keys.push({ value: keyVal, label: `API_KEY_${i}` });
        }
    }

    // Dedup based on value, keeping the first label found
    const uniqueKeys: { value: string, label: string }[] = [];
    const seenValues = new Set<string>();

    for (const k of keys) {
        if (!seenValues.has(k.value)) {
            seenValues.add(k.value);
            uniqueKeys.push(k);
        }
    }

    return uniqueKeys;
};

// Shuffle array to load balance across keys
const shuffleArray = (array: any[]) => {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
};

// Used for display labels
const PREFERRED_DOMAINS = [
    'ultimate-guitar.com',
    'tab4u.com',
    'negina.co.il',
    'nagnu.co.il',
    'nagenu.co.il',
    'songsterr.com',
    'chordu.com'
];

// Block list for non-chord content
const BLOCKED_DOMAINS = [
    'youtube.com', 'youtu.be',
    'spotify.com', 'open.spotify.com',
    'apple.com', 'music.apple.com',
    'amazon.com',
    'facebook.com',
    'instagram.com',
    'wikipedia.org'
];

const getDomainDisplay = (url: string) => {
    try {
        const lower = url.toLowerCase();
        if (lower.includes('tab4u')) return 'Tab4u';
        if (lower.includes('ultimate-guitar')) return 'Ultimate Guitar';
        if (lower.includes('negina') || lower.includes('nagnu') || lower.includes('nagenu')) return 'Negina/Nagnu';
        if (lower.includes('songsterr')) return 'Songsterr';
        if (lower.includes('e-chords')) return 'E-Chords';
        if (lower.includes('azchords')) return 'AZChords';
        
        const hostname = new URL(url).hostname;
        return hostname.replace('www.', '').replace('tabs.', '').split('.')[0];
    } catch {
        return 'Link';
    }
};

export interface SearchResponse {
    success: boolean;
    data: ChordSearchResult[];
    error?: string;
    manualSearchUrl?: string; // Fallback URL
}

export const searchChords = async (songTitle: string, artist: string): Promise<SearchResponse> => {
  const allKeys = getAvailableApiKeys();
  
  if (allKeys.length === 0) {
    console.warn("[GS Jam Error] No API Keys configured.");
    return { 
        success: false, 
        data: [], 
        error: "Configuration Error: No VITE_API_KEYs found in environment variables." 
    };
  }

  // Rotation Strategy: Shuffle keys and try them one by one if we hit quota limits
  const shuffledKeys = shuffleArray([...allKeys]);
  
  const fixedSuffix = "chords ultimate-guitar tab4u negina nagenu";
  const query = `${songTitle.trim()} ${artist.trim()} ${fixedSuffix}`;
  const manualSearchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;

  console.log(`[GS Jam] Starting search with ${shuffledKeys.length} available keys.`);

  let lastError = "Unknown Error";

  for (const keyObj of shuffledKeys) {
    const apiKey = keyObj.value;
    const label = keyObj.label;

    try {
        // Instantiate for this specific request/key
        const ai = new GoogleGenAI({ apiKey });
        
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: `Search on Google for: ${query}`,
            config: {
                tools: [{ googleSearch: {} }],
            },
        });

        const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
        
        const seenUrls = new Set<string>();
        const foundResults: ChordSearchResult[] = [];

        for (const chunk of chunks) {
            if (chunk.web?.uri && chunk.web?.title) {
                let url = chunk.web.uri;
                const title = chunk.web.title;
                const lower = url.toLowerCase();

                if (BLOCKED_DOMAINS.some(d => lower.includes(d))) continue;
                if (lower.includes('google.com/search') || lower.includes('google.com/url')) continue;
                if (!lower.startsWith('http')) continue;
                if (lower.includes('search.php') || (lower.includes('/search/') && !lower.includes('vertex'))) continue;

                const cleanUrl = url.trim().replace(/\/$/, '');
                if (seenUrls.has(cleanUrl)) continue;

                foundResults.push({
                    title: title,
                    url: url,
                    snippet: getDomainDisplay(url)
                });
                seenUrls.add(cleanUrl);
            }
        }

        // Success! Return results
        return { success: true, data: foundResults.slice(0, 5), manualSearchUrl };

    } catch (e: any) {
        const errStr = e.toString();
        // Log which key failed to help debugging (e.g., "API_KEY_3 failed")
        console.warn(`[GS Jam] Key [${label}] failed:`, errStr);

        if (errStr.includes('429')) {
            lastError = "Daily Search Quota Exceeded (All Keys Exhausted)";
            // Continue to next key in loop
            continue;
        } else if (errStr.includes('403') || errStr.includes('400')) {
            lastError = `API Key Invalid (${label})`;
            // Continue to next key (maybe this specific key is bad)
            continue;
        } else {
            // Server error or other fatal error
            lastError = "Google AI Service is temporarily busy.";
            continue;
        }
    }
  }

  // If we exit the loop, all keys failed
  console.error("[GS Jam Error] All API keys failed.");
  return { success: false, data: [], error: lastError, manualSearchUrl };
};
