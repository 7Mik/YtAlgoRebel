# YtAlgoRebel · Technical Writeup

> *"What I cannot create, I do not understand."* · Richard Feynman, last blackboard at Caltech, February 15, 1988.

A developer-oriented walkthrough of the YtAlgoRebel codebase. The goal is that a contributor who has never read the project before can finish this document and confidently navigate the source, modify the scoring logic, or add a new scraping pipeline.

---

## Mental Model

**YtAlgoRebel** is a Chrome extension (Manifest V3) designed to help users break free from the outrage-driven, engagement-maximizing YouTube recommendation feed. It allows the user to re-rank YouTube feeds locally using their own "Taste Matrix" derived from their watch history, liked videos, watch later videos, and penalized by disliked videos and clickbait patterns.

The extension operates entirely locally:
1. **The Interceptor**: We hook into the page's main world context to sniff raw YouTube API payloads.
2. **The Scraper**: We fetch the user's history, likes, dislikes, and watch later list directly via YouTube's internal API (InnerTube) or page-scraping fallbacks.
3. **The Taste Matrix**: We build a vector or keyword profile representing the user's tastes, stored in `IndexedDB`.
4. **The Reranker**: We score feed videos against this profile using keyword token frequency or semantic vector embeddings (via local WASM `transformers.js`, local Ollama, or remote OpenAI).
5. **The Clickbait Penalty**: We apply heuristic filters to penalize OUTRAGEOUS clickbait patterns (ALL CAPS, multi-bangs `!!!`, clickbait regex phrases).
6. **The Injector**: We highlight matching videos directly in the YouTube DOM with clean glowing borders and matching scores.

```
YouTube feed load ──► inject.js (intercepts InnerTube JSON)
                             │
                             ▼
                    background.js ──► Read Taste Matrix from IndexedDB
                             │
                             ▼
                    reranker.js (Keyword similarity / Cosine similarity)
                             │        │
                             │        └─► Apply Clickbait Heuristics
                             ▼
                    content.js (DOM highlights + custom badge rendering)
```

There is no cloud database, no central analytics server, and no third-party tracking. All calculations are executed on the client machine.

---

## Code Map

The project is structured as a Chrome Browser Extension:

```
extension/
  manifest.json         Manifest V3 definition, host permissions, background worker
  src/
    background/         Service worker and background processing
      background.js     Main lifecycle worker, message Router, profile coordinator
      ai.js             AI embedding manager (WASM transformers.js / Ollama / OpenAI)
      reranker.js       Keyword / Semantic scoring models and Clickbait filter
      scraper.js        InnerTube feed crawler and Google MyActivity scraper
    content/            Page-level content scripts (isolated and main worlds)
      content.js        Isolated script: Scrapes DOM elements, applies styling highlights
      inject.js         Main-world hook: Overrides fetch/XHR to capture InnerTube JSON
    popup/              Dashboard popup interface
      popup.html        Modern dark UI dashboard page
      popup.css         Glassmorphism animations, sliders, and controls
      popup.js          Popup UI orchestrator, stats updater, settings binder
    utils/
      db.js             IndexedDB wrapper (stores history and taste profile)
webpack.config.js       Webpack builder for production packaging
package.json            Dependencies and NPM scripts
```

---

## The Scraping & Activity Logic

To construct a taste profile without making users manually input their preferences, YtAlgoRebel crawls their existing YouTube activity.

### 1. InnerTube Crawler (`scraper.js`)
Instead of requesting developer API keys with strict quotas, `scraper.js` mimics YouTube's internal SPA requests. It intercepts the client's session configuration (InnerTube API keys and Client Versions) and fires authenticated `fetch` requests with `credentials: 'include'`.
- Watch History: Crawled from `FEhistory`.
- Liked Videos: Crawled from `VLLL`.
- Watch Later: Crawled from `VLWL`.
- Disliked Videos: Crawled from `DL` (if public).

If the InnerTube API returns empty responses, the system falls back to fetching raw HTML (`https://www.youtube.com/feed/history`, etc.) and extracting the `ytInitialData` object from the document's scripts.

### 2. Google My Activity Dislikes Scraper
Because YouTube no longer exposes a clear list of disliked videos via InnerTube, we offer an opt-in dislikes scraper:
1. Opens `https://myactivity.google.com/page?page=youtube_likes` in an invisible background tab.
2. Inject a content script that scrolls the page 15 times to load historical logs.
3. Scrapes all YouTube titles and channel names.
4. **Safe Zone Anchor Overlap Logic**: To prevent marking videos as disliked due to parsing boundaries, we locate the intersection of liked videos with the scraped activity. The "Safe Zone" represents the timeline where we can reliably assume any video in the activity log that is *not* in the liked playlist is a disliked video.

---

## The AI & Scoring Layer

The reranking engine is built as an additive model, supporting two execution pathways.

### 1. The Mathematical Model
For a given video with title and channel, the score is calculated as:

$$\text{score} = (H \cdot w_h) + (L \cdot w_l) + (W \cdot w_w) - (D \cdot |w_l|) + (C_{score} \cdot w_c) - P_c$$

Where:
- $H$: History Affinity (0 to 1)
- $L$: Likes Affinity (0 to 1)
- $W$: Watch Later Affinity (0 to 1)
- $D$: Dislikes Affinity (0 to 1)
- $C_{score}$: Channel Match Affinity (computed using exact channel names)
- $w_h, w_l, w_w, w_c$: Weights from user settings (sliders)
- $P_c$: Clickbait Penalty (0 to 1)

### 2. Scoring Pathways (`reranker.js`)
- **Keyword Mode (Default)**: Uses zero-latency token overlap. Words are tokenized, stopwords are stripped, and a frequency map is queried.
- **AI Mode (Opt-In)**: Converts video titles into dense vector embeddings. It computes the **Cosine Similarity** of the new video vector against the vectors in the user's Taste Matrix:
  $$\text{similarity} = \frac{\mathbf{A} \cdot \mathbf{B}}{\|\mathbf{A}\| \|\mathbf{B}\|}$$
  The affinity is defined as the maximum similarity between the new video and all vectors in that specific history/like/dislike pool. The AI model only encodes the title to keep semantic topics clean.
- **Creator Preference (Both Modes)**: Parallel to topic scoring, the system evaluates exact channel name matches against `historyChannelMap`, `likesChannelMap`, etc. This provides a flat baseline bonus (or penalty if disliked) dictated by the user's "Creator Preference" slider.

### 3. Embedding Pipeline (`ai.js`)
To generate embeddings, the engine attempts three strategies in order:
1. **Bring Your Own Key (BYOK)**: If enabled, calls a remote OpenAI-compatible API (`text-embedding-3-small` or similar).
2. **Local Ollama Server**: If running, offloads to Ollama's local API (`/api/embeddings` using `nomic-embed-text`).
3. **Local WebAssembly**: Falls back to running HuggingFace's `transformers.js` (`Xenova/all-MiniLM-L6-v2`) in-browser using WebAssembly. To support Chrome Service Workers, multi-threading is forced to `numThreads = 1` since Service Workers lack `URL.createObjectURL` support.

---

## The Clickbait Penalty Engine

Clickbait relies on psychological triggers that translate into predictable syntactic patterns. The `computeClickbaitPenalty` function identifies these patterns and penalizes them:

| Pattern | Detection Method | Penalty |
|---|---|---|
| **Excessive Uppercase** | Words with $\geq 3$ capitals (e.g. "SHOCKING", "LIES") | $+0.1$ per word |
| **All-Caps Ratio** | Over 50% of letters in the title are capitals | $+0.3$ |
| **Multi-Bangs** | Consecutive exclamation marks (e.g. `!!`, `!!!`) | $+0.2$ |
| **Bait Phrases** | Regular expressions matching bait terms (e.g., `you won't believe`, `shocking`, `gone wrong`, `insane`) | $+0.25$ per match |
| **Question Marks** | Multiple question marks (e.g., `??`) | $+0.1$ |

The cumulative penalty is capped at $1.0$.

---

## UI and Interceptor

### 1. Main World Injection (`inject.js` & `content.js`)
To bypass Chrome Extension content script isolation, `content.js` creates a `<script>` tag pointing to `inject.js` and appends it to `document.documentElement`. 
`inject.js` intercepts network requests:
- Overrides `window.fetch` to listen to `/youtubei/v1/browse` and `/youtubei/v1/next`.
- Overrides `XMLHttpRequest.prototype.send` for older legacy endpoints.
- Intercepted JSON is sent to the isolated world of `content.js` via `window.postMessage`, which then routes it to `background.js` using `chrome.runtime.sendMessage`.

### 2. DOM Highlights
When top-scored videos are identified, `content.js` finds matching elements (`ytd-rich-item-renderer`, `ytd-compact-video-renderer`, etc.) and modifies their styles:
- Adds a CSS class `yt-algo-rebel-highlight`.
- Applies a glowing border using `box-shadow` ($>80\%$ match gets green, $>65\%$ gets yellow, $>55\%$ gets blue).
- Injects a small absolute-positioned badge on top of the video thumbnail displaying the match percentage (e.g., `🤖 #1 · 89%`).
