
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
    if (targetDomain === 'International') {
        domainMatch = lower.includes('ultimate-guitar.com');
    }
    else if (targetDomain === 'Israeli') {
        domainMatch = lower.includes('tab4u.com') || lower.includes('negina.co.il') || lower.includes('nagnu.co.il');
    }
    else {
        domainMatch = true; 
    }

    if (!domainMatch) return false;

    // Content Check (Filter out junk)
    if (lower.includes('login') || lower.includes('signup') || lower.includes('account') || lower.includes('reset') || lower.includes('search')) {
        return false;
    }

    return true;
};

const performBatchSearch = async (
    songTitle: string, 
    artist: string, 
    query: string, 
    batchName: string
): Promise<ChordSearchResult[]> => {
    try {
        const prompt = `Find specific guitar chords for "${songTitle}" by "${artist}". Query: ${query}`;
        
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
                if (isValidResultForDomain(url, batchName) && !seenUrls.has(url)) {
                    foundResults.push({
                        title: chunk.web.title,
                        url: url,
                        snippet: getDomainFromUrl(url) // Clean source name
                    });
                    seenUrls.add(url);
                }
            }
        }

        // 2. Extract from Text (Fallback)
        const urlRegex = /(https?:\/\/[^\s)\]]+)/g;
        const textMatches = textOutput.match(urlRegex);

        if (textMatches) {
            for (const url of textMatches) {
                let cleanUrl = url.replace(/[.,;)]$/, '');
                if (isValidResultForDomain(cleanUrl, batchName) && !seenUrls.has(cleanUrl)) {
                    foundResults.push({
                        title: `${songTitle} - ${getDomainFromUrl(cleanUrl)}`,
                        url: cleanUrl,
                        snippet: getDomainFromUrl(cleanUrl)
                    });
                    seenUrls.add(cleanUrl);
                }
            }
        }

        return foundResults;
    } catch (e) {
        console.warn(`Search failed for ${batchName}`, e);
        return [];
    }
};

export const searchChords = async (songTitle: string, artist: string): Promise<ChordSearchResult[]> => {
  if (!API_KEY) {
    console.warn("No API Key provided for chord search.");
    return [];
  }

  // OPTIMIZATION: 2 Batches for the "Big 4" Sites
  // Batch 1: Ultimate Guitar
  // Batch 2: Israeli Sites (Tab4u, Negina, Nagnu)
  
  const searchPromises = [
      performBatchSearch(
          songTitle, 
          artist, 
          `"${songTitle}" "${artist}" chords site:ultimate-guitar.com`, 
          "International"
      ),
      performBatchSearch(
          songTitle, 
          artist, 
          `"${songTitle}" "${artist}" אקורדים (site:tab4u.com OR site:negina.co.il OR site:nagnu.co.il)`, 
          "Israeli"
      )
  ];

  const resultsArrays = await Promise.all(searchPromises);
  const flatResults = resultsArrays.flat();

  // Deduplicate and Sort
  const uniqueUrls = new Set<string>();
  const allResults: ChordSearchResult[] = [];

  // Sort Logic: Priority Order
  flatResults.sort((a, b) => {
      const getScore = (r: ChordSearchResult) => {
          const u = r.url.toLowerCase();
          if (u.includes('tab4u.com')) return 10;
          if (u.includes('negina.co.il') || u.includes('nagnu.co.il')) return 9;
          if (u.includes('ultimate-guitar.com')) return 8;
          return 1;
      };
      return getScore(b) - getScore(a);
  });

  for (const res of flatResults) {
      if (!uniqueUrls.has(res.url)) {
          // Improve snippet display
          const u = res.url.toLowerCase();
          if (u.includes('tab4u')) res.snippet = 'Tab4u';
          else if (u.includes('ultimate-guitar')) res.snippet = 'Ultimate Guitar';
          else if (u.includes('negina') || u.includes('nagnu')) res.snippet = 'Negina/Nagnu';
          else res.snippet = getDomainFromUrl(res.url);

          allResults.push(res);
          uniqueUrls.add(res.url);
      }
  }

  return allResults.slice(0, 10);
};

function getDomainFromUrl(url: string) {
    try {
        return new URL(url).hostname.replace('www.', '').replace('tabs.', '');
    } catch {
        return 'Web Result';
    }
}
