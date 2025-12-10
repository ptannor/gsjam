
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

// Check if a URL belongs to the target domain AND is likely a content page (not homepage/login)
const isValidResultForDomain = (url: string, targetDomain: string): boolean => {
    const lower = url.toLowerCase();
    
    // Domain Check
    let domainMatch = false;
    if (targetDomain === 'Ultimate Guitar') domainMatch = lower.includes('ultimate-guitar.com');
    else if (targetDomain === 'Tab4u') domainMatch = lower.includes('tab4u.com');
    else if (targetDomain === 'Negina/Nagnu') domainMatch = lower.includes('negina.co.il') || lower.includes('nagnu.co.il');
    else if (targetDomain === 'SyncTheBand') domainMatch = lower.includes('synctheband.com');
    else domainMatch = true; // Fallback for catch-all

    if (!domainMatch) return false;

    // Content Check (Filter out junk)
    if (lower.includes('login') || lower.includes('signup') || lower.includes('account') || lower.includes('reset')) {
        return false;
    }

    return true;
};

const performSingleDomainSearch = async (
    songTitle: string, 
    artist: string, 
    siteQuery: string, 
    domainName: string
): Promise<ChordSearchResult[]> => {
    try {
        // Query construction
        // We pass the raw query directly to force the tool to function correctly
        const prompt = `Find the specific guitar chords page for "${songTitle}" by "${artist}". Query: ${siteQuery}`;
        
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: prompt,
            config: {
                tools: [{ googleSearch: {} }],
            },
        });

        const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
        const textOutput = response.text || "";
        
        const foundResults: ChordSearchResult[] = [];
        const seenUrls = new Set<string>();

        // 1. Extract from Grounding Metadata (Verified Links)
        for (const chunk of chunks) {
            if (chunk.web?.uri && chunk.web?.title) {
                const url = chunk.web.uri;
                if (isValidResultForDomain(url, domainName) && !seenUrls.has(url)) {
                    foundResults.push({
                        title: chunk.web.title,
                        url: url,
                        snippet: domainName // Clean source name
                    });
                    seenUrls.add(url);
                }
            }
        }

        // 2. Extract from Text (Fallback for when Metadata is empty)
        // Regex to find http/https links OR Markdown links [Text](url)
        const urlRegex = /(https?:\/\/[^\s)\]]+)/g;
        const textMatches = textOutput.match(urlRegex);

        if (textMatches) {
            for (const url of textMatches) {
                // Clean trailing punctuation
                let cleanUrl = url.replace(/[.,;)]$/, '');
                
                if (isValidResultForDomain(cleanUrl, domainName) && !seenUrls.has(cleanUrl)) {
                    foundResults.push({
                        title: `${songTitle} - ${domainName}`, // Generic title for text matches
                        url: cleanUrl,
                        snippet: domainName
                    });
                    seenUrls.add(cleanUrl);
                }
            }
        }

        return foundResults;
    } catch (e) {
        console.warn(`Search failed for ${domainName}`, e);
        return [];
    }
};

export const searchChords = async (songTitle: string, artist: string): Promise<ChordSearchResult[]> => {
  if (!API_KEY) {
    console.warn("No API Key provided for chord search.");
    return [];
  }

  // Execute distinct searches in parallel
  const searchPromises = [
      // 1. Ultimate Guitar
      performSingleDomainSearch(songTitle, artist, `"${songTitle}" "${artist}" site:ultimate-guitar.com chords`, "Ultimate Guitar"),
      
      // 2. Tab4u (Hebrew added for better hit rate)
      performSingleDomainSearch(songTitle, artist, `"${songTitle}" "${artist}" site:tab4u.com אקורדים`, "Tab4u"),
      
      // 3. Negina/Nagnu (Hebrew)
      performSingleDomainSearch(songTitle, artist, `"${songTitle}" "${artist}" (site:negina.co.il OR site:nagnu.co.il) אקורדים`, "Negina/Nagnu"),
      
      // 4. SyncTheBand
      performSingleDomainSearch(songTitle, artist, `"${songTitle}" site:synctheband.com`, "SyncTheBand"),

      // 5. Catch-All Broad Search (To ensure we get *something* if the specific ones fail)
      performSingleDomainSearch(songTitle, artist, `"${songTitle}" "${artist}" guitar chords tabs`, "Other Sources")
  ];

  const resultsArrays = await Promise.all(searchPromises);
  
  // Flatten
  const flatResults = resultsArrays.flat();

  // Deduplicate and Sort
  // FIX: Rank by URL content, not by which search found it. 
  // This ensures that if "Other Sources" finds a Tab4u link, it still goes to the top.
  const uniqueUrls = new Set<string>();
  const allResults: ChordSearchResult[] = [];

  // Sort Logic: High priority for specific domains
  flatResults.sort((a, b) => {
      const getScore = (r: ChordSearchResult) => {
          const u = r.url.toLowerCase();
          if (u.includes('tab4u.com')) return 10;
          if (u.includes('negina.co.il') || u.includes('nagnu.co.il')) return 9;
          if (u.includes('ultimate-guitar.com')) return 8;
          if (u.includes('synctheband.com')) return 7;
          return 1;
      };
      return getScore(b) - getScore(a);
  });

  for (const res of flatResults) {
      if (!uniqueUrls.has(res.url)) {
          // Fix snippet display if it came from "Other Sources" but is actually a preferred site
          const u = res.url.toLowerCase();
          if (res.snippet === 'Other Sources') {
             if (u.includes('tab4u')) res.snippet = 'Tab4u';
             else if (u.includes('ultimate-guitar')) res.snippet = 'Ultimate Guitar';
             else if (u.includes('negina') || u.includes('nagnu')) res.snippet = 'Negina/Nagnu';
             else if (u.includes('synctheband')) res.snippet = 'SyncTheBand';
             else res.snippet = getDomainFromUrl(res.url); // Extract real domain
          }

          allResults.push(res);
          uniqueUrls.add(res.url);
      }
  }

  // Limit to reasonable amount but ensure diversity
  return allResults.slice(0, 15);
};

// Helper for clean display
function getDomainFromUrl(url: string) {
    try {
        return new URL(url).hostname.replace('www.', '');
    } catch {
        return 'Web Result';
    }
}
