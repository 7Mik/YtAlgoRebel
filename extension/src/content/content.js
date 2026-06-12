// content.js — Runs in isolated world on YouTube pages
// Responsibilities:
// 1. Inject the API hook script (inject.js) into the main world
// 2. Scrape ALL video elements from the DOM when requested
// 3. Highlight top-scored videos with a glowing border

// ── Inject the hook script ──
function injectScript(file_path, node) {
  const script = document.createElement('script');
  script.setAttribute('type', 'text/javascript');
  script.setAttribute('src', file_path);
  node.appendChild(script);
}

injectScript(chrome.runtime.getURL('inject.js'), document.documentElement);

// ── Forward intercepted API responses to background ──
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (event.data && event.data.type === 'YT_ALGO_REBEL_INTERCEPT') {
    chrome.runtime.sendMessage({
      type: 'YOUTUBE_API_RESPONSE',
      url: event.data.url,
      data: event.data.data
    });
  }
});

// ── Listen for messages from background/popup ──
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SCRAPE_PAGE_VIDEOS') {
    const videos = scrapeAllVideosFromDOM();
    sendResponse({ videos });
    return true;
  }
  
  if (message.type === 'HIGHLIGHT_VIDEOS') {
    highlightVideosOnPage(message.videos);
  }
});

/**
 * Scrape ALL video elements from the entire DOM (not just the viewport).
 * Finds every video renderer on the page and extracts id, title, channel, thumbnail.
 */
function scrapeAllVideosFromDOM() {
  const videos = [];
  const seen = new Set();
  
  // All possible YouTube video container selectors
  const selectors = [
    'ytd-rich-item-renderer',
    'ytd-grid-video-renderer',
    'ytd-video-renderer',
    'ytd-compact-video-renderer',
    'ytd-reel-item-renderer'
  ];
  
  for (const selector of selectors) {
    const elements = document.querySelectorAll(selector);
    elements.forEach(el => {
      try {
        // Skip ad slots
        if (el.querySelector('ytd-ad-slot-renderer')) return;
        
        // Extract video ID from the link href
        const link = el.querySelector('a#video-title, a#video-title-link, a.yt-simple-endpoint[href*="watch"], a.ytLockupMetadataViewModelTitle, a[href*="/watch?v="]');
        if (!link) return;
        
        const href = link.getAttribute('href') || '';
        const videoIdMatch = href.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
        if (!videoIdMatch) return;
        
        const id = videoIdMatch[1];
        if (seen.has(id)) return;
        seen.add(id);
        
        // Title
        const titleEl = el.querySelector('#video-title, .ytLockupMetadataViewModelTitle');
        const title = titleEl ? (titleEl.textContent || titleEl.getAttribute('title') || '').trim() : '';
        if (!title) return;
        
        // Channel name
        const channelEl = el.querySelector('#channel-name a, .ytd-channel-name a, #text.ytd-channel-name, ytd-channel-name #text, .ytLockupMetadataViewModelChannel a, [href*="/@"]');
        const channel = channelEl ? channelEl.textContent.trim() : '';
        
        // Thumbnail
        const thumbEl = el.querySelector('img.yt-core-image, ytd-thumbnail img, img');
        const thumbnail = thumbEl ? (thumbEl.getAttribute('src') || '') : '';
        
        videos.push({ id, title, channel, thumbnail });
      } catch (e) {
        // Skip malformed elements
      }
    });
  }
  
  console.log(`YtAlgoRebel: Scraped ${videos.length} videos from DOM`);
  return videos;
}

/**
 * Highlight top-scored videos on the page with a glowing colored border.
 * Green = high match, yellow = medium, removes highlights from low scores.
 */
function highlightVideosOnPage(scoredVideos) {
  // First remove any existing highlights
  document.querySelectorAll('.yt-algo-rebel-highlight').forEach(el => {
    el.classList.remove('yt-algo-rebel-highlight');
    el.style.removeProperty('--rebel-glow-color');
    el.style.removeProperty('box-shadow');
    el.style.removeProperty('border');
    el.style.removeProperty('border-radius');
    el.style.removeProperty('position');
  });
  
  // Remove existing badges
  document.querySelectorAll('.yt-algo-rebel-badge').forEach(el => el.remove());
  
  // Inject CSS if not already done
  if (!document.getElementById('yt-algo-rebel-styles')) {
    const style = document.createElement('style');
    style.id = 'yt-algo-rebel-styles';
    style.textContent = `
      .yt-algo-rebel-highlight {
        position: relative !important;
        transition: box-shadow 0.4s ease, border 0.4s ease !important;
      }
      .yt-algo-rebel-badge {
        position: absolute;
        top: 6px;
        left: 6px;
        padding: 3px 8px;
        font-size: 12px;
        font-family: 'Inter', 'Segoe UI', sans-serif;
        font-weight: 700;
        border-radius: 6px;
        z-index: 999;
        pointer-events: none;
        color: white;
        box-shadow: 0 2px 8px rgba(0,0,0,0.4);
        border: 1px solid rgba(255,255,255,0.2);
        backdrop-filter: blur(4px);
        -webkit-backdrop-filter: blur(4px);
      }
      @keyframes rebelPulse {
        0%, 100% { opacity: 0.85; }
        50% { opacity: 1; }
      }
    `;
    document.head.appendChild(style);
  }
  
  // Apply highlights to scored videos
  scoredVideos.forEach((vid, index) => {
    // Find the video element by ID in any link href
    const links = document.querySelectorAll(`a[href*="${vid.id}"]`);
    
    links.forEach(link => {
      const container = link.closest('ytd-rich-item-renderer')
                     || link.closest('ytd-grid-video-renderer')
                     || link.closest('ytd-video-renderer')
                     || link.closest('ytd-compact-video-renderer');
      
      if (!container) return;
      
      // Only highlight top videos (matchPercent > 55)
      if (vid.matchPercent <= 55) return;
      
      container.classList.add('yt-algo-rebel-highlight');
      
      // Color based on match quality
      let glowColor, badgeBg;
      if (vid.matchPercent > 80) {
        glowColor = 'rgba(34, 197, 94, 0.5)';  // green
        badgeBg = 'rgba(22, 163, 74, 0.9)';
      } else if (vid.matchPercent > 65) {
        glowColor = 'rgba(234, 179, 8, 0.4)';   // yellow
        badgeBg = 'rgba(180, 140, 8, 0.9)';
      } else {
        glowColor = 'rgba(96, 165, 250, 0.3)';  // blue
        badgeBg = 'rgba(59, 130, 246, 0.85)';
      }
      
      container.style.boxShadow = `0 0 0 2px ${glowColor}, 0 0 16px ${glowColor}`;
      container.style.borderRadius = '12px';
      
      // Add badge on the thumbnail
      const thumbWrap = container.querySelector('ytd-thumbnail');
      if (thumbWrap && !thumbWrap.querySelector('.yt-algo-rebel-badge')) {
        thumbWrap.style.position = 'relative';
        
        const badge = document.createElement('div');
        badge.className = 'yt-algo-rebel-badge';
        badge.style.background = badgeBg;
        badge.style.animation = 'rebelPulse 3s ease-in-out infinite';
        badge.textContent = `🤖 #${index + 1} · ${vid.matchPercent}%`;
        
        thumbWrap.appendChild(badge);
      }
    });
  });
}
