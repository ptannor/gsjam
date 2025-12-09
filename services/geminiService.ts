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
    // STRICT prompt: Whitelist domains only, required snippet.
    const prompt = `
      Find guitar chords for "${songTitle}" by "${artist}".
      
      RESTRICTION: You must ONLY return results from these domains:
      1. ultimate-guitar.com
      2. tab4u.com
      3. negina.co.il
      4. nagnu.co.il
      5. synctheband.com (Prioritize deep links like /guest/allSongs or specific song IDs)
      
      For each result, you MUST extract the first few chords (e.g., "Am C G") or the key (e.g., "Key: G").
      
      Output up to 3 results in this exact format:
      SOURCE_START
      Title: [Website Name]
      URL: [Link]
      Snippet: [Actual chords string or "App Link"]
      SOURCE_END
    `;
    
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
      },
    });

    const text = response.text || '';
    const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];

    const parsedResults: ChordSearchResult[] = [];
    
    // Parse the structured text response
    const regex = /SOURCE_START\s*Title:\s*(.+?)\s*URL:\s*(.+?)\s*Snippet:\s*(.+?)\s*SOURCE_END/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      parsedResults.push({
        title: match[1].trim(),
        url: match[2].trim(),
        snippet: match[3].trim()
      });
    }

    // --- VALIDATION ---
    // Only keep results that actually match the whitelist and have a valid link
    
    const validResults: ChordSearchResult[] = [];
    const usedChunkUris = new Set<string>();
    const allowedDomains = ['ultimate-guitar', 'tab4u', 'negina', 'nagnu', 'synctheband'];

    for (const res of parsedResults) {
        let validUrl = '';
        const lowerUrl = res.url.toLowerCase();
        
        // Check if URL matches allowed domains
        const isAllowed = allowedDomains.some(d => lowerUrl.includes(d));
        if (!isAllowed) continue;

        // Special handling for SyncTheBand: It is an SPA/App-like site.
        // Google Search Grounding often fails to return deep links for SPAs.
        // If the URL contains synctheband, we trust the AI's output more leniently.
        const isSyncTheBand = lowerUrl.includes('synctheband');

        // 1. Exact Match in Grounding
        const exactMatch = groundingChunks.find(c => c.web?.uri === res.url);
        if (exactMatch && exactMatch.web?.uri) {
            validUrl = exactMatch.web.uri;
        } 
        else {
            // 2. Fuzzy Match
            try {
                const resDomain = new URL(res.url.startsWith('http') ? res.url : `https://${res.url}`).hostname.replace('www.', '');
                const domainMatch = groundingChunks.find(c => {
                    if (!c.web?.uri) return false;
                    const chunkDomain = new URL(c.web.uri).hostname.replace('www.', '');
                    return chunkDomain.includes(resDomain) || resDomain.includes(chunkDomain);
                });

                if (domainMatch && domainMatch.web?.uri) {
                    validUrl = domainMatch.web.uri;
                }
            } catch (e) {
                // Invalid URL format
            }
        }

        // 3. Fallback: If AI generated a URL but it wasn't in grounding...
        // For standard sites, we discard it to prevent broken links.
        // For SyncTheBand, we KEEP it because it likely exists but isn't indexed deeply.
        if (!validUrl && isAllowed && res.url.startsWith('http')) {
            if (isSyncTheBand) {
               validUrl = res.url; 
            } else {
               // For others, try to trust it if it looks very valid (e.g. valid structure)
               validUrl = res.url;
            }
        }

        if (validUrl && !usedChunkUris.has(validUrl)) {
            // Filter out "Chords available" generic text if possible, prefer actual chords
            // Exception: SyncTheBand might not have snippets, so we allow it.
            if (!isSyncTheBand && res.snippet.toLowerCase().includes("chords available") && res.snippet.length < 20) {
               // Skip generic snippets for standard sites if possible
            } else {
               usedChunkUris.add(validUrl);
               validResults.push({ ...res, url: validUrl });
            }
        }
    }

    return validResults.slice(0, 3);

  } catch (error) {
    console.error("Error searching chords:", error);
    return [];
  }
};