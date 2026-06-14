/**
 * reranker.js
 * Scoring engine with additive model:
 *   score = historyAffinity * historyWeight
 *         + likesAffinity   * likedBonus      (slider: -1 to +1, default +0.5)
 *         + dislikesAffinity * -|likedBonus|   (always penalizes)
 *         - clickbaitPenalty
 *
 * Two modes:
 *   1. Keyword (default) — fast, zero-latency token overlap
 *   2. AI (opt-in) — semantic embedding similarity
 */

// ── Stopwords to ignore during keyword matching ──
const STOPWORDS = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'shall', 'can', 'to', 'of', 'in', 'for',
    'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
    'before', 'after', 'above', 'below', 'between', 'out', 'off', 'over',
    'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when',
    'where', 'why', 'how', 'all', 'both', 'each', 'few', 'more', 'most',
    'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same',
    'so', 'than', 'too', 'very', 'just', 'but', 'and', 'or', 'if', 'it',
    'its', 'this', 'that', 'these', 'those', 'i', 'me', 'my', 'we', 'our',
    'you', 'your', 'he', 'him', 'his', 'she', 'her', 'they', 'them', 'their',
    'what', 'which', 'who', 'whom', 'up', 'about', 'video', 'official',
    'new', 'best', 'top', 'vs', 'get', 'got', 'make', 'making', 'made',
    'one', 'two', 'first', '|', '-', '–', '—', '#', 'part', 'episode', 'ep'
]);

/**
 * Tokenize a string into meaningful keywords.
 */
export function tokenize(text) {
    if (!text) return [];
    return text
        .toLowerCase()
        .replace(/[^\w\s'-]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length >= 2 && !STOPWORDS.has(w));
}

/**
 * Build a keyword frequency map from an array of {title, channel} entries.
 * Channel tokens get a 1.5x multiplier (stronger preference signal).
 */
export function buildKeywordMap(entries) {
    const freq = {};
    for (const entry of entries) {
        const titleTokens = tokenize(entry.title);
        const channelTokens = tokenize(entry.channel);

        for (const token of titleTokens) {
            freq[token] = (freq[token] || 0) + 1;
        }
        for (const token of channelTokens) {
            freq[token] = (freq[token] || 0) + 1.5;
        }
    }
    return freq;
}

/**
 * Build a channel frequency map from an array of {channel} entries.
 * Returns an object where keys are exact channel names and values are view counts.
 */
export function buildChannelMap(entries) {
    const freq = {};
    for (const entry of entries) {
        if (!entry.channel) continue;
        const channelName = entry.channel.trim();
        if (channelName) {
            freq[channelName] = (freq[channelName] || 0) + 1;
        }
    }
    return freq;
}

/**
 * Compute keyword affinity between a video and a keyword frequency map.
 * Returns a value between 0 and 1.
 */
function keywordAffinity(videoTitle, videoChannel, keywordMap) {
    const titleTokens = tokenize(videoTitle);
    const channelTokens = tokenize(videoChannel);

    if (titleTokens.length === 0 && channelTokens.length === 0) return 0;

    let score = 0;
    let totalTokens = titleTokens.length + channelTokens.length;

    for (const token of titleTokens) {
        if (keywordMap[token]) {
            score += Math.log2(1 + keywordMap[token]);
        }
    }

    for (const token of channelTokens) {
        if (keywordMap[token]) {
            score += Math.log2(1 + keywordMap[token]) * 2;
        }
    }

    const normalized = score / (score + totalTokens * 1.5);
    return Math.min(1, normalized);
}

/**
 * Score a video using keyword affinity (default mode).
 *
 * @param {string} videoTitle
 * @param {string} videoChannel
 * @param {Object} historyMap   - keyword map from watch history
 * @param {Object} likesMap     - keyword map from liked videos
 * @param {Object} dislikesMap  - keyword map from disliked videos
 * @param {number} historyWeight - fixed weight for history (default 0.5)
 * @param {number} likedBonus    - slider value for liked bonus (-1 to +1, default +0.5)
 * @returns {number} score between -1 and 1
 */
export function scoreVideoKeywords(videoTitle, videoChannel, historyMap, likesMap, dislikesMap, wlMap, historyWeight = 0.5, likedBonus = 0.5, wlWeight = 0.5, customPlaylistsData = [], customPlaylistsConfig = [], historyChannelMap = {}, likesChannelMap = {}, dislikesChannelMap = {}, wlChannelMap = {}, channelWeight = 0.5) {
    const histAffinity = keywordAffinity(videoTitle, videoChannel, historyMap);
    const likesAffinity = keywordAffinity(videoTitle, videoChannel, likesMap);
    const dislikesAffinity = keywordAffinity(videoTitle, videoChannel, dislikesMap);
    const wlAffinity = keywordAffinity(videoTitle, videoChannel, wlMap || {});

    // Additive model:
    // - History is the base signal (always positive)
    // - Likes add a bonus proportional to the slider value
    // - Watch Later adds a bonus proportional to the slider value (absolute weight)
    // - Dislikes always subtract (using the absolute slider value)
    let score = (histAffinity * historyWeight)
              + (likesAffinity * likedBonus)
              + (wlAffinity * wlWeight)
              - (dislikesAffinity * Math.abs(likedBonus));

    // Calculate Channel Score
    const histChannelMatch = channelAffinity(videoChannel, historyChannelMap);
    const likesChannelMatch = channelAffinity(videoChannel, likesChannelMap);
    const dislikesChannelMatch = channelAffinity(videoChannel, dislikesChannelMap);
    const wlChannelMatch = channelAffinity(videoChannel, wlChannelMap);

    let channelScore = (histChannelMatch * historyWeight)
                     + (likesChannelMatch * likedBonus)
                     + (wlChannelMatch * wlWeight)
                     - (dislikesChannelMatch * Math.abs(likedBonus));

    // Add baseline channel score
    score += channelScore * channelWeight;


    // Add custom playlists keyword score
    if (customPlaylistsData.length > 0 && customPlaylistsConfig.length > 0) {
        for (const plData of customPlaylistsData) {
            const configPl = customPlaylistsConfig.find(p => {
                if (!p.url) return false;
                const match = p.url.match(/[&?]list=([a-zA-Z0-9_-]+)/);
                const configId = match ? match[1] : p.url.trim();
                return configId === plData.playlistId;
            });
            if (configPl && configPl.weight !== undefined && plData.keywordMap && Object.keys(plData.keywordMap).length > 0) {
                const plAffinity = keywordAffinity(videoTitle, videoChannel, plData.keywordMap);
                score += plAffinity * parseFloat(configPl.weight);
            }
        }
    }

    score -= computeClickbaitPenalty(videoTitle);

    return Math.max(-1, Math.min(1, score));
}


// ── AI Embedding scoring (opt-in) ──

export function cosineSimilarity(vecA, vecB) {
    if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Max cosine similarity between a vector and an array of vectors.
 */
function maxSimilarity(vec, embeddings) {
    let max = 0;
    if (!vec || !embeddings) return max;
    for (const emb of embeddings) {
        const sim = cosineSimilarity(vec, emb);
        if (sim > max) max = sim;
    }
    return max;
}

/**
 * Score a video using AI embeddings (opt-in mode).
 * Same additive model as keyword scoring but with semantic similarity.
 *
 * @param {Array<number>} videoEmbedding
 * @param {string} videoTitle
 * @param {Array<Array<number>>} historyEmbeddings
 * @param {Array<Array<number>>} likesEmbeddings
 * @param {Array<Array<number>>} dislikesEmbeddings
 * @param {number} historyWeight
 * @param {number} likedBonus
 * @returns {number} score between -1 and 1
 */
export function scoreVideoAI(videoEmbedding, videoTitle, videoChannel, historyEmbeddings, likesEmbeddings, dislikesEmbeddings, wlEmbeddings, historyWeight = 0.5, likedBonus = 0.5, wlWeight = 0.5, customPlaylistsData = [], customPlaylistsConfig = [], historyChannelMap = {}, likesChannelMap = {}, dislikesChannelMap = {}, wlChannelMap = {}, channelWeight = 0.5) {
    if (!videoEmbedding) return 0;

    const histSim = maxSimilarity(videoEmbedding, historyEmbeddings);
    const likesSim = maxSimilarity(videoEmbedding, likesEmbeddings);
    const dislikesSim = maxSimilarity(videoEmbedding, dislikesEmbeddings);
    const wlSim = maxSimilarity(videoEmbedding, wlEmbeddings);

    let score = (histSim * historyWeight)
              + (likesSim * likedBonus)
              + (wlSim * wlWeight)
              - (dislikesSim * Math.abs(likedBonus));

    // Calculate Channel Score
    const histChannelMatch = channelAffinity(videoChannel, historyChannelMap);
    const likesChannelMatch = channelAffinity(videoChannel, likesChannelMap);
    const dislikesChannelMatch = channelAffinity(videoChannel, dislikesChannelMap);
    const wlChannelMatch = channelAffinity(videoChannel, wlChannelMap);

    let channelScore = (histChannelMatch * historyWeight)
                     + (likesChannelMatch * likedBonus)
                     + (wlChannelMatch * wlWeight)
                     - (dislikesChannelMatch * Math.abs(likedBonus));

    // Add baseline channel score
    score += channelScore * channelWeight;


    // Add custom playlists AI score
    if (customPlaylistsData.length > 0 && customPlaylistsConfig.length > 0) {
        for (const plData of customPlaylistsData) {
            const configPl = customPlaylistsConfig.find(p => {
                if (!p.url) return false;
                const match = p.url.match(/[&?]list=([a-zA-Z0-9_-]+)/);
                const configId = match ? match[1] : p.url.trim();
                return configId === plData.playlistId;
            });
            if (configPl && configPl.weight !== undefined && plData.embeddings && plData.embeddings.length > 0) {
                const plAffinity = maxSimilarity(videoEmbedding, plData.embeddings);
                score += plAffinity * parseFloat(configPl.weight);
            }
        }
    }

    score -= computeClickbaitPenalty(videoTitle);

    return Math.max(-1, Math.min(1, score));
}


// ── Channel scoring utility ──

function channelAffinity(channel, map) {
    if (!channel || !map || !map[channel.trim()]) return 0;
    const count = map[channel.trim()];
    return Math.min(1, count / 5); // 5 views from this channel = full score contribution
}

// ── Clickbait penalty (shared by both modes) ──

export function computeClickbaitPenalty(title) {
    let penalty = 0;
    if (!title) return penalty;

    const uppercaseWords = title.match(/\b[A-Z]{3,}\b/g) || [];
    if (uppercaseWords.length > 1) {
        penalty += 0.1 * uppercaseWords.length;
    }

    const exclamations = title.match(/!+/g) || [];
    if (exclamations.length > 0) {
        let maxBang = Math.max(...exclamations.map(e => e.length));
        if (maxBang > 1) {
            penalty += 0.2;
        } else if (exclamations.length > 1) {
            penalty += 0.1 * exclamations.length;
        }
    }

    const questionMarks = title.match(/\?+/g) || [];
    if (questionMarks.length > 1) {
        penalty += 0.1;
    }

    const clickbaitPhrases = [
        /you won['']?t believe/i,
        /shocking/i,
        /gone wrong/i,
        /insane/i,
        /wtf/i,
        /truth about/i,
        /watch till the end/i,
        /mind blowing/i,
        /secret to/i,
        /didn['']?t know/i,
        /\bthis is\b.*\bwhy\b/i,
        /exposing/i
    ];

    for (const regex of clickbaitPhrases) {
        if (regex.test(title)) {
            penalty += 0.25;
        }
    }

    const totalCaps = title.replace(/[^A-Z]/g, '').length;
    const totalLetters = title.replace(/[^a-zA-Z]/g, '').length;
    if (totalLetters > 10 && totalCaps / totalLetters > 0.5) {
        penalty += 0.3;
    }

    return Math.min(penalty, 1.0);
}
