/**
 * scraper.js
 * Fetches YouTube History, Liked and Disliked Videos to extract titles + channels.
 * Returns them separately for weighted scoring:
 * - History = base signal (all watched videos, including liked ones)
 * - Likes = bonus signal (adds extra affinity on top of history)
 * - Dislikes = penalty signal (reduces affinity)
 */

async function fetchYtInitialData(url) {
    try {
        console.log(`YtAlgoRebel: Fetching ${url}`);
        const response = await fetch(url, { credentials: 'include' });
        const text = await response.text();
        
        const patterns = [
            /var ytInitialData\s*=\s*(\{.*?\});<\/script>/,
            /window\["ytInitialData"\]\s*=\s*(\{.*?\});/
        ];
        
        for (let regex of patterns) {
            const match = text.match(regex);
            if (match && match[1]) {
                console.log(`YtAlgoRebel: Successfully parsed ytInitialData from ${url}`);
                return JSON.parse(match[1]);
            }
        }
        console.warn(`YtAlgoRebel: Could not find ytInitialData in ${url}`);
    } catch (e) {
        console.error(`YtAlgoRebel: Failed to fetch data from ${url}`, e);
    }
    return null;
}

/**
 * Extract video entries with both title and channel name from ytInitialData JSON.
 * Returns an array of { title, channel } objects.
 */
function extractVideoEntries(data) {
    const entries = [];
    const seenTitles = new Set();

    function recurse(obj) {
        if (!obj || typeof obj !== 'object') return;

        if (Array.isArray(obj)) {
            for (let i = 0; i < obj.length; i++) {
                recurse(obj[i]);
            }
            return;
        }

        // 1. Match old videoRenderer schema (e.g. Shorts, older UI)
        if (obj.videoId && obj.title) {
            let title = '';
            if (typeof obj.title === 'string') {
                title = obj.title;
            } else if (obj.title.runs && obj.title.runs[0] && obj.title.runs[0].text) {
                title = obj.title.runs[0].text;
            } else if (obj.title.simpleText) {
                title = obj.title.simpleText;
            }

            title = title.trim();

            if (title && title.length > 2 && title !== "Skip navigation") {
                if (!seenTitles.has(title)) {
                    seenTitles.add(title);

                    // Extract channel
                    let channel = '';
                    const byline = obj.longBylineText || obj.shortBylineText || obj.ownerText;
                    if (byline) {
                        if (typeof byline === 'string') {
                            channel = byline;
                        } else if (byline.runs && byline.runs[0] && byline.runs[0].text) {
                            channel = byline.runs[0].text;
                        } else if (byline.simpleText) {
                            channel = byline.simpleText;
                        }
                    }

                    entries.push({
                        title: title,
                        channel: channel.split('\n')[0].replace(/•/g, '').trim()
                    });
                }
            }
            return;
        }
        
        // 2. Match new lockupViewModel schema (regular videos)
        if (obj.lockupViewModel && obj.lockupViewModel.contentId && obj.lockupViewModel.contentType === "LOCKUP_CONTENT_TYPE_VIDEO") {
            const model = obj.lockupViewModel;
            const meta = model.metadata?.lockupMetadataViewModel;
            if (meta && meta.title && meta.title.content) {
                const title = meta.title.content.trim();
                if (title && !seenTitles.has(title)) {
                    seenTitles.add(title);
                    
                    let channel = '';
                    const rows = meta.metadata?.contentMetadataViewModel?.metadataRows;
                    if (rows && rows[0] && rows[0].metadataParts && rows[0].metadataParts[0] && rows[0].metadataParts[0].text) {
                        channel = rows[0].metadataParts[0].text.content || '';
                    }
                    
                    entries.push({
                        title: title,
                        channel: channel.split('\n')[0].replace(/•/g, '').trim()
                    });
                }
            }
            return;
        }

        // Recurse into all keys
        for (const key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                recurse(obj[key]);
            }
        }
    }

    try {
        recurse(data);
    } catch (e) {
        console.warn("YtAlgoRebel: Error extracting video entries recursively", e);
    }

    return entries;
}

function getFallbackClientVersion() {
    const d = new Date();
    d.setDate(d.getDate() - 2);
    const yyyymmdd = d.toISOString().split('T')[0].replace(/-/g, '');
    return `2.${yyyymmdd}.00.00`;
}

let cachedApiKey = null;
let cachedClientVersion = null;

async function getInnerTubeConfig() {
    if (cachedApiKey && cachedClientVersion) {
        return { apiKey: cachedApiKey, clientVersion: cachedClientVersion };
    }

    try {
        console.log("YtAlgoRebel: Fetching YouTube homepage for config...");
        const response = await fetch('https://www.youtube.com', { credentials: 'include' });
        const html = await response.text();

        const apiKeyMatch = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/);
        const clientVersionMatch = html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/);

        if (apiKeyMatch && apiKeyMatch[1]) {
            cachedApiKey = apiKeyMatch[1];
        }
        if (clientVersionMatch && clientVersionMatch[1]) {
            cachedClientVersion = clientVersionMatch[1];
        }

        console.log(`YtAlgoRebel: Extracted API Key: ${cachedApiKey ? 'success' : 'failed'}, Client Version: ${cachedClientVersion ? 'success' : 'failed'} (${cachedClientVersion})`);
    } catch (e) {
        console.warn("YtAlgoRebel: Failed to extract InnerTube config from HTML", e);
    }

    if (!cachedClientVersion) {
        cachedClientVersion = getFallbackClientVersion();
        console.log(`YtAlgoRebel: Using fallback client version: ${cachedClientVersion}`);
    }

    return { apiKey: cachedApiKey, clientVersion: cachedClientVersion };
}

/**
 * Recursively search a JSON object for continuation tokens.
 */
function findContinuationToken(obj) {
    if (!obj || typeof obj !== 'object') return null;

    if (obj.continuationCommand && obj.continuationCommand.token) {
        return obj.continuationCommand.token;
    }

    for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
            const token = findContinuationToken(obj[key]);
            if (token) return token;
        }
    }
    return null;
}

/**
 * Fetch more entries from InnerTube using continuation tokens, up to a limit.
 */
async function fetchInnerTubeContinuation(apiKey, clientVersion, initialToken, limit) {
    const entries = [];
    let continuationToken = initialToken;

    try {
        while (continuationToken && entries.length < limit) {
            console.log(`YtAlgoRebel: Paginating InnerTube using continuation token, target remaining: ${limit - entries.length}`);
            const response = await fetch(`https://www.youtube.com/youtubei/v1/browse?key=${apiKey}&prettyPrint=false`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Youtube-Client-Name': '1',
                    'X-Youtube-Client-Version': clientVersion
                },
                credentials: 'include',
                body: JSON.stringify({
                    context: {
                        client: {
                            clientName: 'WEB',
                            clientVersion: clientVersion,
                            hl: 'en',
                            gl: 'US'
                        }
                    },
                    continuation: continuationToken
                })
            });

            if (!response.ok) {
                const errText = await response.text().catch(() => '');
                console.warn(`YtAlgoRebel: InnerTube pagination failed. Status: ${response.status} ${response.statusText}. Response: ${errText}`);
                break;
            }

            const data = await response.json();
            const pageEntries = extractVideoEntries(data);
            entries.push(...pageEntries);
            console.log(`YtAlgoRebel: InnerTube pagination page returned ${pageEntries.length} entries (Total: ${entries.length})`);

            continuationToken = findContinuationToken(data);
        }
    } catch (e) {
        console.error("YtAlgoRebel: Error in InnerTube pagination", e);
    }

    return entries;
}

/**
 * Fetch feed entries from the InnerTube API, paginating with continuation tokens.
 */
async function fetchInnerTubeFeed(apiKey, clientVersion, browseId, limit = 500) {
    const entries = [];
    try {
        console.log(`YtAlgoRebel: InnerTube fetch starting for ${browseId}`);
        const response = await fetch(`https://www.youtube.com/youtubei/v1/browse?key=${apiKey}&prettyPrint=false`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Youtube-Client-Name': '1',
                'X-Youtube-Client-Version': clientVersion
            },
            credentials: 'include',
            body: JSON.stringify({
                context: {
                    client: {
                        clientName: 'WEB',
                        clientVersion: clientVersion,
                        hl: 'en',
                        gl: 'US'
                    }
                },
                browseId: browseId
            })
        });

        if (!response.ok) {
            const errText = await response.text().catch(() => '');
            console.warn(`YtAlgoRebel: InnerTube initial request failed for ${browseId}. Status: ${response.status} ${response.statusText}. Response: ${errText}`);
            return [];
        }

        const data = await response.json();
        const pageEntries = extractVideoEntries(data);
        entries.push(...pageEntries);
        console.log(`YtAlgoRebel: InnerTube ${browseId} initial page returned ${pageEntries.length} entries`);

        if (entries.length < limit) {
            const continuationToken = findContinuationToken(data);
            if (continuationToken) {
                const more = await fetchInnerTubeContinuation(apiKey, clientVersion, continuationToken, limit - entries.length);
                entries.push(...more);
            }
        }
    } catch (e) {
        console.error(`YtAlgoRebel: InnerTube fetch error for ${browseId}`, e);
    }

    return entries;
}

/**
 * Scrape taste data — returns history, likes, dislikes, and watch later separately.
 * First attempts using InnerTube API for paginated data retrieval (up to 500 items),
 * falling back to single-request HTML scraping if needed.
 */
export async function scrapeTasteData() {
    let historyEntries = [];
    let likesEntries = [];
    let wlEntries = [];
    let dislikesEntries = [];
    const limit = 500;

    const config = await getInnerTubeConfig();
    const apiKey = config.apiKey;
    const clientVersion = config.clientVersion;

    if (apiKey) {
        // Fetch via InnerTube browse endpoints
        historyEntries = await fetchInnerTubeFeed(apiKey, clientVersion, 'FEhistory', limit);
        likesEntries = await fetchInnerTubeFeed(apiKey, clientVersion, 'VLLL', limit);
        wlEntries = await fetchInnerTubeFeed(apiKey, clientVersion, 'VLWL', limit);
    }

    // HTML Fallbacks if InnerTube fails or returns empty lists
    if (historyEntries.length === 0) {
        console.log("YtAlgoRebel: InnerTube History empty, falling back to HTML");
        const historyData = await fetchYtInitialData('https://www.youtube.com/feed/history');
        if (historyData) {
            historyEntries = extractVideoEntries(historyData);
            if (historyEntries.length < limit) {
                const token = findContinuationToken(historyData);
                if (token && apiKey) {
                    const more = await fetchInnerTubeContinuation(apiKey, clientVersion, token, limit - historyEntries.length);
                    historyEntries.push(...more);
                }
            }
        }
    }
    
    if (likesEntries.length === 0) {
        console.log("YtAlgoRebel: InnerTube Likes empty, falling back to HTML");
        const likesData = await fetchYtInitialData('https://www.youtube.com/playlist?list=LL');
        if (likesData) {
            likesEntries = extractVideoEntries(likesData);
            if (likesEntries.length < limit) {
                const token = findContinuationToken(likesData);
                if (token && apiKey) {
                    const more = await fetchInnerTubeContinuation(apiKey, clientVersion, token, limit - likesEntries.length);
                    likesEntries.push(...more);
                }
            }
        }
    }
    
    if (wlEntries.length === 0) {
        console.log("YtAlgoRebel: InnerTube Watch Later empty, falling back to HTML");
        const wlData = await fetchYtInitialData('https://www.youtube.com/playlist?list=WL');
        if (wlData) {
            wlEntries = extractVideoEntries(wlData);
            if (wlEntries.length < limit) {
                const token = findContinuationToken(wlData);
                if (token && apiKey) {
                    const more = await fetchInnerTubeContinuation(apiKey, clientVersion, token, limit - wlEntries.length);
                    wlEntries.push(...more);
                }
            }
        }
    }

    // Disliked videos playlist fallback
    const dislikesData = await fetchYtInitialData('https://www.youtube.com/playlist?list=DL');
    if (dislikesData) {
        dislikesEntries = extractVideoEntries(dislikesData);
        if (dislikesEntries.length < limit) {
            const token = findContinuationToken(dislikesData);
            if (token && apiKey) {
                const more = await fetchInnerTubeContinuation(apiKey, clientVersion, token, limit - dislikesEntries.length);
                dislikesEntries.push(...more);
            }
        }
    }

    // Ensure strict limits at limit items
    historyEntries = historyEntries.slice(0, limit);
    likesEntries = likesEntries.slice(0, limit);
    wlEntries = wlEntries.slice(0, limit);
    dislikesEntries = dislikesEntries.slice(0, limit);

    console.log(`YtAlgoRebel: Final synced counts — ${historyEntries.length} history, ${likesEntries.length} liked, ${wlEntries.length} watch later, ${dislikesEntries.length} disliked`);

    return { historyEntries, likesEntries, dislikesEntries, wlEntries };
}
