
import { GoogleGenAI } from "@google/genai";
import { ChordSearchResult } from "../types";

// Safety check for process.env or import.meta.env (Vite)
const getApiKey = () => {
  // Check Vite env (for Vercel deployment)
  if (typeof (import.meta as any) !== 'undefined' && (import.meta as any).env && (import.meta as any).env.VITE_API_KEY) {
    return (import.meta as any).env.VITE_API_KEY;
  }
  
  // Fallback for other environments
  try {
    if (typeof process !== 'undefined' && process.env && process.env.API_KEY) {
      return process.env.API_KEY;
    }
  } catch (e) {
    // Ignore error
  }
  return '';
};

const API_KEY = getApiKey();
const ai = new GoogleGenAI({ apiKey: API_KEY });

// Used for display labels
const PREFERRED_DOMAINS = [
    'ultimate-guitar.com',
    'tab4u.com',
    'negina.co.il',
    'nagnu.co.il',
    'nagenu.co.il', // Added user spelling variant
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
    'wikipedia.org',
    // 'google.com' - Explicitly allowing google to pass through logic to be filtered by parameter checks if needed, 
    // though usually google.com/search is not a direct chord result.
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

export const searchChords = async (songTitle: string, artist: string): Promise<ChordSearchResult[]> => {
  if (!API_KEY) {
    console.warn("No API Key provided for chord search.");
    return [];
  }

  try {
    // STRATEGY: Strict adherence to user template.
    // Template: [Song] [Artist] "chords ultimate-guitar tab4u negina nagenu"
    const fixedSuffix = "chords ultimate-guitar tab4u negina nagenu";
    const query = `${songTitle.trim()} ${artist.trim()} ${fixedSuffix}`;
    
    console.log("GS Jam Search Query:", query);

    const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: `Search on Google for: ${query}`, // Explicit instruction to search
        config: {
            tools: [{ googleSearch: {} }],
        },
    });

    const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    console.log("GS Jam Search Raw Results:", chunks.length);
    
    const seenUrls = new Set<string>();
    const foundResults: ChordSearchResult[] = [];

    // Extract verified links from Grounding Metadata
    for (const chunk of chunks) {
        if (chunk.web?.uri && chunk.web?.title) {
            let url = chunk.web.uri;
            const title = chunk.web.title;
            const lower = url.toLowerCase();

            // 1. Basic Junk Filter
            if (BLOCKED_DOMAINS.some(d => lower.includes(d))) continue;
            
            // 2. Google Internal Links Filter
            // We want real sites, not the Google redirector or search result page itself
            if (lower.includes('google.com/search') || lower.includes('google.com/url')) {
                 continue; 
            }
            if (!lower.startsWith('http')) continue;

            // 3. Loop Prevention
            // Block explicit internal search pages of the target sites if possible, 
            // but be careful not to block valid song pages with query params.
            if (lower.includes('search.php') || (lower.includes('/search/') && !lower.includes('vertex'))) {
                continue;
            }

            // 4. Deduplicate
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

    // Return the top 5 results directly from the search ranking.
    return foundResults.slice(0, 5);

  } catch (e) {
    console.warn("Search failed", e);
    return [];
  }
};
