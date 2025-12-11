
import { GoogleGenAI } from "@google/genai";
import { ChordSearchResult } from "../types";

// Initialize the client with the API key from process.env.API_KEY as per guidelines.
// Assume the environment variable is correctly configured and available.
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

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

export interface SearchResponse {
    success: boolean;
    data: ChordSearchResult[];
    error?: string;
}

export const searchChords = async (songTitle: string, artist: string): Promise<SearchResponse> => {
  // Guidelines: API key availability is a hard requirement.
  // We check process.env.API_KEY presence for safety, but initialization happens globally.
  if (!process.env.API_KEY) {
    console.warn("No API Key configured in process.env.API_KEY");
    return { 
        success: false, 
        data: [], 
        error: "Configuration Error: API_KEY is missing in environment variables." 
    };
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
    return { success: true, data: foundResults.slice(0, 5) };

  } catch (e: any) {
    console.warn("Search failed", e);
    
    let errorMessage = "Failed to search chords. Please try again.";
    const errStr = e.toString();

    if (errStr.includes('429')) {
        errorMessage = "Daily Search Quota Exceeded. The app is out of tokens for today.";
    } else if (errStr.includes('403') || errStr.includes('400')) {
        errorMessage = "API Key Invalid or API Not Enabled on Google Cloud.";
    } else if (errStr.includes('500') || errStr.includes('503')) {
        errorMessage = "Google AI Service is temporarily busy. Try again in a moment.";
    }

    return { success: false, data: [], error: errorMessage };
  }
};
