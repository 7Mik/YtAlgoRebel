import { scrapeTasteData } from './scraper.js';
import { generateEmbeddings } from './ai.js';
import { buildKeywordMap, scoreVideoKeywords, scoreVideoAI } from './reranker.js';
import { putItem, getItem } from '../utils/db.js';

chrome.runtime.onInstalled.addListener(() => {
  console.log("YtAlgoRebel installed");
});

// ────────────────────────────────────────────────
// My Activity Dislikes Scraper (opt-in)
// Opens myactivity.google.com in a background tab,
// injects a script to scrape disliked video titles,
// then closes the tab automatically.
// ────────────────────────────────────────────────

async function scrapeMyActivityDislikes() {
  return new Promise((resolve) => {
    const SCRAPE_URL = 'https://myactivity.google.com/page?page=youtube_likes';
    const TIMEOUT_MS = 45000; // 45 second timeout for scrolling and scraping

    let tabId = null;
    let timeoutHandle = null;
    let resolved = false;

    function done(results) {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeoutHandle);
      if (tabId) {
        chrome.tabs.remove(tabId).catch(() => {});
      }
      resolve(results);
    }

    // Timeout safety net
    timeoutHandle = setTimeout(() => {
      console.warn('YtAlgoRebel: My Activity scrape timed out');
      done([]);
    }, TIMEOUT_MS);

    // Open the page in a background tab
    chrome.tabs.create({ url: SCRAPE_URL, active: false }, (tab) => {
      tabId = tab.id;

      // Wait for the page to finish loading
      function onTabUpdated(updatedTabId, changeInfo) {
        if (updatedTabId !== tabId || changeInfo.status !== 'complete') return;
        chrome.tabs.onUpdated.removeListener(onTabUpdated);

        // Give the SPA a moment to render its content
        setTimeout(() => {
          chrome.scripting.executeScript({
            target: { tabId: tabId },
            func: scrapeAllFromMyActivity
          }).then((results) => {
            const entries = (results && results[0] && results[0].result) || [];
            console.log(`YtAlgoRebel: Scraped ${entries.length} total entries from My Activity`);
            done(entries);
          }).catch((err) => {
            console.error('YtAlgoRebel: Failed to execute scrape script', err);
            done([]);
          });
        }, 3000); // 3s delay for SPA render
      }

      chrome.tabs.onUpdated.addListener(onTabUpdated);
    });
  });
}

/**
 * This function runs INSIDE the myactivity.google.com tab.
 * Simply extracts ALL video titles + channels from the page.
 * 100% language-agnostic — no text parsing needed.
 *
 * The background script will then subtract the known liked videos
 * (from the LL playlist) — whatever remains = disliked.
 *
 * DOM structure (from real page analysis):
 *   <div class="QTGV3c" jsname="r4nke">
 *     <a class="l8sGWb" href="youtube.com/watch?v=...">
 *       <span class="hFYxqd">VIDEO TITLE</span>
 *     </a>
 *   </div>
 *   <div class="SiEggd">
 *     <a href="youtube.com/channel/...">CHANNEL NAME</a>
 *   </div>
 */
async function scrapeAllFromMyActivity() {
  const entries = [];
  const seenTitles = new Set();
  try {
    // Scroll down multiple times to load more content
    const scrollAttempts = 15;
    const delayMs = 1200;

    for (let i = 0; i < scrollAttempts; i++) {
      window.scrollTo(0, document.body.scrollHeight);
      await new Promise(r => setTimeout(r, delayMs));
      const currentCount = document.querySelectorAll('.QTGV3c, [jsname="r4nke"]').length;
      console.log(`YtAlgoRebel: Scrolling attempt ${i+1}/${scrollAttempts}, found ${currentCount} containers`);
    }

    // Find all activity item containers
    const actionDivs = document.querySelectorAll('.QTGV3c, [jsname="r4nke"]');
    
    actionDivs.forEach(div => {
      const link = div.querySelector('a.l8sGWb, a[href*="youtube.com/watch"]');
      if (!link) return;

      // Extract video title
      const titleSpan = link.querySelector('.hFYxqd');
      const title = titleSpan 
        ? titleSpan.textContent.trim()
        : (link.getAttribute('aria-label') || link.textContent || '').trim();
      if (!title || title.length < 3 || seenTitles.has(title)) return;
      seenTitles.add(title);

      // Extract channel name from sibling .SiEggd div
      let channel = '';
      const parentEntry = div.closest('.gWevEe') || div.parentElement;
      if (parentEntry) {
        const channelLink = parentEntry.querySelector('.SiEggd a[href*="youtube.com/channel"], .SiEggd a[href*="youtube.com/@"]');
        if (channelLink) channel = channelLink.textContent.trim();
      }

      entries.push({ title, channel });
    });

    console.log(`YtAlgoRebel: Scraped ${entries.length} total entries from My Activity`);
  } catch (e) {
    console.error('YtAlgoRebel: Error scraping My Activity page', e);
  }
  return entries;
}

/**
 * Read scoring weights from chrome.storage.local.
 */
function getWeights() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['historyWeight', 'likedBonus', 'wlWeight'], (result) => {
      resolve({
        historyWeight: result.historyWeight !== undefined ? result.historyWeight : 0.5,
        likedBonus: result.likedBonus !== undefined ? result.likedBonus : 0.5,
        wlWeight: result.wlWeight !== undefined ? result.wlWeight : 0.5
      });
    });
  });
}

/**
 * Build the taste profile from history, likes, and dislikes.
 * Always builds keyword maps (instant). Optionally builds AI embeddings.
 */
async function buildTasteProfile(useAI, scanDislikes, progressCallback) {
  const { historyEntries, likesEntries, dislikesEntries: playlistDislikes, wlEntries } = await scrapeTasteData();
  
  const normalizeTitle = (str) => {
    if (!str) return '';
    return str.toLowerCase()
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#32;/g, ' ')
      .replace(/[^a-z0-9]/g, '')
      .trim();
  };

  // Build set of known liked normalized titles (from LL playlist)
  const likedNormalizedSet = new Set(likesEntries.map(e => normalizeTitle(e.title)));
  
  // Get dislikes: start with playlist DL (if available)
  let dislikesEntries = [...playlistDislikes];
  
  // If opted in, scrape My Activity page for more signal
  if (scanDislikes) {
    chrome.runtime.sendMessage({ type: 'SYNC_STATUS_MSG', msg: 'Scanning My Activity for dislikes...' }).catch(() => {});
    const myActivityEntries = await scrapeMyActivityDislikes();
    
    const existingDislikesNormalized = new Set(dislikesEntries.map(e => normalizeTitle(e.title)));
    
    // Safety & Safe Zone Alignment Logic
    let safeZoneLimitIndex = -1;
    
    if (likesEntries.length < 100) {
      safeZoneLimitIndex = myActivityEntries.length - 1;
      console.log("YtAlgoRebel: Liked playlist is complete (less than 100 items). Entire My Activity is within the safe zone.");
    } else {
      for (let i = likesEntries.length - 1; i >= 0; i--) {
        const likedNorm = normalizeTitle(likesEntries[i].title);
        const idx = myActivityEntries.findIndex(e => normalizeTitle(e.title) === likedNorm);
        if (idx !== -1) {
          safeZoneLimitIndex = idx;
          console.log(`YtAlgoRebel: Safe zone anchor found at My Activity index ${idx} ("${myActivityEntries[idx].title}") matching liked video index ${i} ("${likesEntries[i].title}")`);
          break;
        }
      }
    }
    
    if (safeZoneLimitIndex !== -1) {
      let addedCount = 0;
      for (let k = 0; k <= safeZoneLimitIndex; k++) {
        const entry = myActivityEntries[k];
        const norm = normalizeTitle(entry.title);
        
        if (!likedNormalizedSet.has(norm) && !existingDislikesNormalized.has(norm)) {
          dislikesEntries.push(entry);
          existingDislikesNormalized.add(norm);
          addedCount++;
        }
      }
      console.log(`YtAlgoRebel: Evaluated ${safeZoneLimitIndex + 1} My Activity entries in safe zone. Added ${addedCount} new dislikes.`);
    } else {
      console.warn("YtAlgoRebel: No overlap found between Liked Playlist and My Activity, and liked list is incomplete. Safe zone is empty. Skipping My Activity entries to prevent false positives.");
    }
  }
  
  if (historyEntries.length === 0 && likesEntries.length === 0) return false;
  
  // ── Keyword maps (always built, instant) ──
  const historyKeywordMap = buildKeywordMap(historyEntries);
  const likesKeywordMap = buildKeywordMap(likesEntries);
  const dislikesKeywordMap = buildKeywordMap(dislikesEntries);
  const wlKeywordMap = buildKeywordMap(wlEntries);
  
  // Save raw history titles for "already watched" filtering
  const historyTitles = historyEntries.map(e => e.title.toLowerCase().trim());
  
  const profile = {
    id: 'master',
    historyKeywordMap,
    likesKeywordMap,
    dislikesKeywordMap,
    wlKeywordMap,
    historyTitles,
    historyEmbeddings: [],
    likesEmbeddings: [],
    dislikesEmbeddings: [],
    wlEmbeddings: [],
    historyCount: historyEntries.length,
    likesCount: likesEntries.length,
    dislikesCount: dislikesEntries.length,
    wlCount: wlEntries.length,
    lastSync: Date.now()
  };
  
  // ── AI embeddings (opt-in) ──
  if (useAI) {
    const allEntries = [...historyEntries, ...likesEntries, ...dislikesEntries, ...wlEntries];
    let processed = 0;
    const total = allEntries.length;
    
    const onDownloadProgress = (data) => {
      if (data.status === 'progress' || data.status === 'downloading') {
        chrome.runtime.sendMessage({
          type: 'MODEL_DOWNLOAD_PROGRESS',
          progress: data.progress || 0,
          loaded: data.loaded || 0,
          total: data.total || 0
        }).catch(() => {});
      }
    };
    
    // History embeddings
    for (const entry of historyEntries) {
      try {
        const emb = await generateEmbeddings(entry.title, onDownloadProgress);
        if (emb) profile.historyEmbeddings.push(emb);
      } catch (e) { console.warn("Failed embedding for", entry.title); }
      processed++;
      if (progressCallback) progressCallback(processed, total);
    }
    
    // Likes embeddings
    for (const entry of likesEntries) {
      try {
        const emb = await generateEmbeddings(entry.title, onDownloadProgress);
        if (emb) profile.likesEmbeddings.push(emb);
      } catch (e) { console.warn("Failed embedding for", entry.title); }
      processed++;
      if (progressCallback) progressCallback(processed, total);
    }
    
    // Dislikes embeddings
    for (const entry of dislikesEntries) {
      try {
        const emb = await generateEmbeddings(entry.title, onDownloadProgress);
        if (emb) profile.dislikesEmbeddings.push(emb);
      } catch (e) { console.warn("Failed embedding for", entry.title); }
      processed++;
      if (progressCallback) progressCallback(processed, total);
    }

    // Watch Later embeddings
    for (const entry of wlEntries) {
      try {
        const emb = await generateEmbeddings(entry.title, onDownloadProgress);
        if (emb) profile.wlEmbeddings.push(emb);
      } catch (e) { console.warn("Failed embedding for", entry.title); }
      processed++;
      if (progressCallback) progressCallback(processed, total);
    }
  } else {
    const total = historyEntries.length + likesEntries.length + dislikesEntries.length + wlEntries.length;
    if (progressCallback) progressCallback(total, total);
  }
  
  await putItem('tasteMatrix', profile);
  return true;
}

// Keep-alive port listener to prevent Service Worker shutdown during sync
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "keepalive") {
    console.log("YtAlgoRebel: Keep-alive port connected");
    port.onDisconnect.addListener(() => {
      console.log("YtAlgoRebel: Keep-alive port disconnected");
    });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // ── Sync Taste Profile ──
  if (message.type === 'SYNC_TASTE_MATRIX') {
    const useAI = message.useAI || false;
    const scanDislikes = message.scanDislikes || false;
    buildTasteProfile(useAI, scanDislikes, (current, total) => {
        chrome.runtime.sendMessage({ type: 'SYNC_PROGRESS', current, total }).catch(() => {});
    }).then(success => {
        chrome.runtime.sendMessage({ type: 'SYNC_COMPLETE', success }).catch(() => {});
    });
    return true;
  }
  
  // ── Find Top Videos from the current page ──
  if (message.type === 'FIND_TOP_VIDEOS') {
    const { videos, useAI } = message;
    findTopVideos(videos, useAI).then(res => {
      sendResponse({ success: true, videos: res.videos, aiFallback: res.aiFallback });
    }).catch(err => {
      console.error("YtAlgoRebel: Error finding top videos", err);
      sendResponse({ success: false, videos: [], error: err.message });
    });
    return true;
  }
  
  // ── Forward scored videos to content script for highlighting ──
  if (message.type === 'HIGHLIGHT_ON_PAGE') {
    const { videos, tabId } = message;
    if (tabId) {
      chrome.tabs.sendMessage(tabId, {
        type: 'HIGHLIGHT_VIDEOS',
        videos: videos
      }).catch(() => {});
    }
    return true;
  }
  
  // ── Reserved for inject.js API interception ──
  if (message.type === 'YOUTUBE_API_RESPONSE') {
    // Reserved for future use
  }
});

/**
 * Score and rank videos from the page against the user's taste profile.
 * Filters out already-watched videos and returns top 10.
 */
async function findTopVideos(pageVideos, useAI = false) {
  const profile = await getItem('tasteMatrix', 'master');
  
  if (!profile) {
    console.warn("YtAlgoRebel: No taste profile found. Please sync first.");
    return { videos: [], aiFallback: false };
  }
  
  const weights = await getWeights();
  const { historyWeight, likedBonus, wlWeight } = weights;
  
  const {
    historyKeywordMap, likesKeywordMap, dislikesKeywordMap, wlKeywordMap,
    historyTitles,
    historyEmbeddings, likesEmbeddings, dislikesEmbeddings, wlEmbeddings
  } = profile;
  
  // Filter out already watched videos
  const unwatchedVideos = pageVideos.filter(v => {
    const normalizedTitle = v.title.toLowerCase().trim();
    return !historyTitles.includes(normalizedTitle);
  });
  
  const scoredVideos = [];
  let aiFallback = false;

  // Determine if AI embeddings are present
  const hasAI = likesEmbeddings && likesEmbeddings.length > 0;
  if (useAI && !hasAI) {
    aiFallback = true;
  }

  const runAI = useAI && hasAI;
  let idx = 0;
  const total = unwatchedVideos.length;
  
  for (const vid of unwatchedVideos) {
    try {
      let score;
      
      if (runAI) {
        const emb = await generateEmbeddings(vid.title, null);
        score = scoreVideoAI(
          emb, vid.title,
          historyEmbeddings, likesEmbeddings, dislikesEmbeddings, wlEmbeddings || [],
          historyWeight, likedBonus, wlWeight
        );
      } else {
        score = scoreVideoKeywords(
          vid.title, vid.channel || '',
          historyKeywordMap || {}, likesKeywordMap || {}, dislikesKeywordMap || {}, wlKeywordMap || {},
          historyWeight, likedBonus, wlWeight
        );
      }
      
      scoredVideos.push({
        id: vid.id,
        title: vid.title,
        channel: vid.channel || '',
        thumbnail: vid.thumbnail || '',
        score: score,
        matchPercent: Math.round(((score + 1) / 2) * 100)
      });
    } catch (e) {
      console.error("Error scoring video", vid.title, e);
    }

    idx++;
    // Report scoring progress to popup
    chrome.runtime.sendMessage({ type: 'SCORE_PROGRESS', current: idx, total: total }).catch(() => {});
  }
  
  // Sort descending, return top 10
  scoredVideos.sort((a, b) => b.score - a.score);
  return { videos: scoredVideos.slice(0, 10), aiFallback };
}
