import { GoogleGenAI } from "@google/genai";
import { ChordSearchResult } from "../types";

// Safety check for process.env or import.meta.env (Vite)
const getApiKey = () => {
  // Check Vite env (for Vercel deployment)
  // Casting to 'any' prevents TypeScript error TS2339 during build
  if (typeof import.meta !== 'undefined' && (import.meta as any).env && (import.meta as any).env.VITE_API_KEY) {
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

export const searchChords = async (songTitle: string, artist: string): Promise<ChordSearchResult[]> => {
  if (!API_KEY) {
    console.warn("No API Key provided for chord search.");
    return [];
  }

  try {
    // Using gemini-1.5-flash as it follows tool instructions better than 2.5 for this specific task
    const prompt = `
      Find guitar chords for "${songTitle}" by "${artist}".
      
      RULES:
      1. ONLY return links from: ultimate-guitar.com, tab4u.com, negina.co.il, nagnu.co.il, or synctheband.com.
      2. IGNORE general search results like Wikipedia or Spotify.
      3. For each result, extract a snippet showing the first line of chords (e.g. "Am G C") or the Key.
      4. If the result is from 'synctheband.com', the snippet can be "App Link".
      
      Format EXACTLY as:
      SOURCE_START
      Title: [Page Title]
      URL: [Full URL]
      Snippet: [Chord Preview]
      SOURCE_END
    `;
    
    const response = await ai.models.generateContent({
      model: "gemini-1.5-flash",
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
      },
    });

    const text = response.text || '';
    const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];

    const parsedResults: ChordSearchResult[] = [];
    const regex = /SOURCE_START\s*Title:\s*(.+?)\s*URL:\s*(.+?)\s*Snippet:\s*(.+?)\s*SOURCE_END/g;
    let match;
    
    while ((match = regex.exec(text)) !== null) {
      parsedResults.push({
        title: match[1].trim(),
        url: match[2].trim(),
        snippet: match[3].trim()
      });
    }

    // --- SMART VALIDATION & SWAPPING ---
    const validResults: ChordSearchResult[] = [];
    const usedUrls = new Set<string>();
    const allowedDomains = ['ultimate-guitar', 'tab4u', 'negina', 'nagnu', 'synctheband'];

    // If the AI didn't return good structured data, fallback to raw grounding chunks
    const candidates = parsedResults.length > 0 ? parsedResults : groundingChunks.map(c => ({
        title: c.web?.title || 'Result',
        url: c.web?.uri || '',
        snippet: 'Click to view'
    }));

    for (const res of candidates) {
        if (!res.url) continue;
        let finalUrl = '';
        const lowerUrl = res.url.toLowerCase();

        // 1. Domain Check
        const isAllowed = allowedDomains.some(d => lowerUrl.includes(d));
        if (!isAllowed) continue;
        
        const isSyncTheBand = lowerUrl.includes('synctheband');

        // 2. Grounding Verification (The "Real Link" Check)
        // Does this URL exist in the Google Search Metadata?
        const exactMatch = groundingChunks.find(c => c.web?.uri === res.url);
        
        if (exactMatch && exactMatch.web?.uri) {
            finalUrl = exactMatch.web.uri;
        } else {
            // If AI made up a URL, search grounding chunks for a matching DOMAIN
            try {
                const resDomain = new URL(res.url.startsWith('http') ? res.url : `https://${res.url}`).hostname.replace('www.', '');
                
                const bestSubstitute = groundingChunks.find(c => {
                    if (!c.web?.uri) return false;
                    return c.web.uri.includes(resDomain);
                });

                if (bestSubstitute && bestSubstitute.web?.uri) {
                    finalUrl = bestSubstitute.web.uri;
                    // Update title too if possible
                    res.title = bestSubstitute.web.title || res.title;
                } else if (isSyncTheBand) {
                    // SyncTheBand is an app/SPA, deep links might not appear in search metadata.
                    // We trust the AI constructed link if it looks plausible.
                    finalUrl = res.url;
                }
            } catch (e) {
                console.error("URL Parse error", e);
            }
        }

        if (finalUrl && !usedUrls.has(finalUrl)) {
            // 3. Snippet Quality Check
            // Don't show "Chords available" unless it's the App site
            if (!isSyncTheBand && res.snippet.length < 20 && (res.snippet.includes("available") || res.snippet.includes("tabs"))) {
                 // Try to find a better snippet from grounding content if available, otherwise skip
                 const chunk = groundingChunks.find(c => c.web?.uri === finalUrl);
                 if (chunk && chunk.web?.title) {
                     // We can't really get content text from grounding chunks easily in this version, 
                     // so we just mark it as "View Chords"
                     res.snippet = "View Chords";
                 }
            }
            
            usedUrls.add(finalUrl);
            validResults.push({
                title: res.title,
                url: finalUrl,
                snippet: res.snippet
            });
        }
    }

    return validResults.slice(0, 3);

  } catch (error) {
    console.error("Error searching chords:", error);
    return [];
  }
};
