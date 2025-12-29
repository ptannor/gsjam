
import { GoogleGenAI } from "@google/genai";
import { ChordSearchResult } from "../types";

/**
 * Gemini Service for searching guitar chords using Google Search Grounding.
 * Adheres to @google/genai guidelines:
 * - Uses process.env.API_KEY exclusively.
 * - Uses gemini-3-flash-preview for search tasks.
 * - Extracts grounding metadata for source links.
 */

// Recommended model for basic text and search grounding tasks
const MODEL_NAME = 'gemini-3-flash-preview';

// Domains that usually don't provide chords or are distracting for this use case
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

/**
 * Searches for guitar chords using Gemini with Google Search grounding.
 * Extracts source URLs from grounding metadata to provide direct links.
 */
export const searchChords = async (songTitle: string, artist: string): Promise<SearchResponse> => {
  // Always use process.env.API_KEY directly as per guidelines
  const apiKey = process.env.API_KEY;
  
  if (!apiKey) {
    console.warn("[GS Jam Error] No API Key configured.");
    return { 
        success: false, 
        data: [], 
        error: "Configuration Error: API_KEY not found in environment." 
    };
  }

  const query = `${songTitle.trim()} ${artist.trim()} chords ultimate-guitar tab4u negina nagenu`;
  const manualSearchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;

  try {
    // Correct initialization: use named parameter for apiKey
    const ai = new GoogleGenAI({ apiKey });
    
    // Call generateContent with both model name and prompt in a single call
    const response = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: `Find high quality guitar chords or tabs for: ${songTitle} by ${artist}. Preferred sources: Ultimate Guitar, Tab4u, Negina.`,
        config: {
            tools: [{ googleSearch: {} }],
        },
    });

    // Extract grounding chunks to get website URLs as per search grounding requirements
    const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    
    const seenUrls = new Set<string>();
    const foundResults: ChordSearchResult[] = [];

    for (const chunk of chunks) {
        if (chunk.web?.uri && chunk.web?.title) {
            const url = chunk.web.uri;
            const title = chunk.web.title;
            const lower = url.toLowerCase();

            // Filter out non-chord sites and search engine internal URLs
            if (BLOCKED_DOMAINS.some(d => lower.includes(d))) continue;
            if (lower.includes('google.com/search') || lower.includes('google.com/url')) continue;
            if (!lower.startsWith('http')) continue;

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

    return { success: true, data: foundResults.slice(0, 5), manualSearchUrl };

  } catch (e: any) {
    console.error("[GS Jam Error] Search failed:", e);
    // Graceful error handling for API or network issues
    return { 
        success: false, 
        data: [], 
        error: "Search service temporarily unavailable. Use manual search.", 
        manualSearchUrl 
    };
  }
};
