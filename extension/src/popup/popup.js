import { getItem } from '../utils/db.js';

document.addEventListener('DOMContentLoaded', () => {
  let keepAlivePort = null;
  // ── Tab Switching ──
  const tabHome = document.getElementById('tab-home');
  const tabSettings = document.getElementById('tab-settings');
  const viewHome = document.getElementById('view-home');
  const viewSettings = document.getElementById('view-settings');

  function switchTab(activeTab, inactiveTab, activeView, inactiveView) {
    activeTab.classList.add('active');
    inactiveTab.classList.remove('active');
    activeView.classList.remove('hidden');
    inactiveView.classList.add('hidden');
  }

  tabHome.addEventListener('click', () => switchTab(tabHome, tabSettings, viewHome, viewSettings));
  tabSettings.addEventListener('click', () => {
    switchTab(tabSettings, tabHome, viewSettings, viewHome);
    updateDbStats(); // Load fresh stats when settings tab is opened
  });

  // ── Find Videos Button ──
  const findBtn = document.getElementById('find-videos-btn');
  const findText = findBtn.querySelector('.find-text');
  const videoList = document.getElementById('video-list');
  const emptyState = document.getElementById('empty-state');
  const resultsHeader = document.getElementById('results-header');
  const resultsBadge = document.getElementById('results-badge');
  const aiToggle = document.getElementById('ai-toggle');
  const modeLabel = document.getElementById('mode-label');

  // Load AI toggle state
  chrome.storage.local.get(['useAI'], (result) => {
    aiToggle.checked = result.useAI || false;
    updateModeLabel();
    getItem('tasteMatrix', 'master').then(profile => checkAiWarning(profile));
  });

  aiToggle.addEventListener('change', () => {
    chrome.storage.local.set({ useAI: aiToggle.checked });
    updateModeLabel();
    getItem('tasteMatrix', 'master').then(profile => checkAiWarning(profile));
  });

  function updateModeLabel() {
    modeLabel.textContent = aiToggle.checked ? '🧠 AI Mode' : '⚡ Keyword Mode';
  }

  findBtn.addEventListener('click', async () => {
    // Show loading state
    findBtn.disabled = true;
    findBtn.classList.add('loading');
    findText.textContent = 'Scanning page...';
    
    // Show skeleton loading in video list
    videoList.innerHTML = generateSkeletons(4);
    resultsHeader.classList.remove('hidden');
    resultsBadge.textContent = 'Scanning...';
    if (emptyState) emptyState.remove();

    // Show progress bar
    const scoreStatus = document.getElementById('score-status');
    const scoreProgressBar = document.getElementById('score-progress-bar');
    const scoreProgressText = document.getElementById('score-progress');
    const scoreTotalText = document.getElementById('score-total');
    
    if (scoreStatus) {
      scoreStatus.classList.remove('hidden');
      scoreProgressBar.style.width = '0%';
      scoreProgressText.textContent = '0';
      scoreTotalText.textContent = '0';
    }

    try {
      // 1. Ask content script to scrape ALL videos from the active tab's DOM
      let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.url || !tab.url.includes('youtube.com')) {
        const ytTabs = await chrome.tabs.query({ url: '*://*.youtube.com/*' });
        tab = ytTabs.find(t => t.active) || ytTabs[0];
      }
      
      if (!tab || !tab.url || !tab.url.includes('youtube.com')) {
        showError('Navigate to YouTube first, then click Find Videos.');
        resetFindBtn();
        if (scoreStatus) scoreStatus.classList.add('hidden');
        return;
      }

      const scrapeResponse = await chrome.tabs.sendMessage(tab.id, { type: 'SCRAPE_PAGE_VIDEOS' });
      const pageVideos = scrapeResponse.videos || [];

      if (pageVideos.length === 0) {
        showError('No videos found on this page. Try scrolling down to load more videos first.');
        resetFindBtn();
        if (scoreStatus) scoreStatus.classList.add('hidden');
        return;
      }

      findText.textContent = `Scoring ${pageVideos.length} videos...`;

      // 2. Send to background for scoring
      const useAI = aiToggle.checked;
      const result = await chrome.runtime.sendMessage({
        type: 'FIND_TOP_VIDEOS',
        videos: pageVideos,
        useAI: useAI
      });

      if (result && result.success && result.videos.length > 0) {
        renderResults(result.videos);
        resultsBadge.textContent = `Top ${result.videos.length}`;
        
        // 3. Also highlight them on the page
        chrome.runtime.sendMessage({
          type: 'HIGHLIGHT_ON_PAGE',
          videos: result.videos,
          tabId: tab.id
        });
      } else if (result && result.videos && result.videos.length === 0) {
        showError('No matching unwatched videos found. You may have seen them all! Try a different page.');
      } else {
        showError(result?.error || 'Scoring failed. Make sure you\'ve synced your Taste Profile in Settings.');
      }
    } catch (err) {
      console.error('Find Videos error:', err);
      showError('Could not connect to YouTube tab. Make sure you\'re on a YouTube page and refresh if needed.');
    }

    resetFindBtn();
    if (scoreStatus) {
      scoreStatus.classList.add('hidden');
    }
  });

  function resetFindBtn() {
    findBtn.disabled = false;
    findBtn.classList.remove('loading');
    findText.textContent = 'Find Videos';
  }

  function showError(msg) {
    resultsHeader.classList.add('hidden');
    videoList.innerHTML = `
      <div class="error-state">
        <div class="error-icon">⚠️</div>
        <p>${msg}</p>
      </div>`;
  }

  function generateSkeletons(count) {
    let html = '';
    for (let i = 0; i < count; i++) {
      html += `
        <div class="video-item skeleton">
          <div class="skel-thumb"></div>
          <div class="skel-info">
            <div class="skel-line title"></div>
            <div class="skel-line sub"></div>
          </div>
        </div>`;
    }
    return html;
  }

  function renderResults(videos) {
    videoList.innerHTML = '';
    videos.forEach((video, index) => {
      const el = document.createElement('a');
      el.className = 'video-item';
      el.href = `https://www.youtube.com/watch?v=${video.id}`;
      el.target = '_blank';
      el.rel = 'noopener';

      // Score color
      let scoreClass = 'score-low';
      if (video.matchPercent > 80) scoreClass = 'score-high';
      else if (video.matchPercent > 60) scoreClass = 'score-mid';

      // Thumbnail fallback
      const thumbSrc = video.thumbnail && video.thumbnail.startsWith('http')
        ? video.thumbnail
        : `https://i.ytimg.com/vi/${video.id}/mqdefault.jpg`;

      el.innerHTML = `
        <div class="video-rank">#${index + 1}</div>
        <img class="video-thumb" src="${thumbSrc}" alt="" loading="lazy" />
        <div class="video-info">
          <div class="video-title" title="${escapeHtml(video.title)}">${escapeHtml(video.title)}</div>
          <div class="video-channel">${escapeHtml(video.channel)}</div>
        </div>
        <div class="video-score ${scoreClass}">${video.matchPercent}%</div>
      `;
      videoList.appendChild(el);
    });
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ── Settings: Weight Sliders ──
  const historySlider = document.getElementById('history-weight');
  const historyValue = document.getElementById('history-weight-value');
  const wlSlider = document.getElementById('wl-weight');
  const wlValue = document.getElementById('wl-weight-value');
  const likedSlider = document.getElementById('liked-bonus');
  const likedValue = document.getElementById('liked-bonus-value');
  const likedDisplay = document.getElementById('liked-display');
  const dislikedDisplay = document.getElementById('disliked-display');
  const syncLimitSlider = document.getElementById('sync-limit');
  const syncLimitValue = document.getElementById('sync-limit-value');

  // Load saved weights and checkboxes
  const scanDislikesToggle = document.getElementById('scan-dislikes-toggle');
  const syncAIToggle = document.getElementById('sync-ai-toggle');
  const filterMusicToggle = document.getElementById('filter-music-toggle');
  
  // ── Settings: Custom Playlists ──
  const playlistsContainer = document.getElementById('custom-playlists-container');
  const addPlaylistBtn = document.getElementById('add-playlist-btn');
  let customPlaylists = [];

  function renderCustomPlaylists() {
    if (!playlistsContainer) return;
    playlistsContainer.innerHTML = '';
    if (customPlaylists.length === 0) {
      playlistsContainer.innerHTML = '<p style="color: var(--text-muted); font-size: 0.85rem; text-align: center;">No custom playlists added yet.</p>';
      return;
    }

    customPlaylists.forEach((playlist, index) => {
      const weightString = playlist.weight >= 0 ? '+' + parseFloat(playlist.weight).toFixed(2) : parseFloat(playlist.weight).toFixed(2);
      
      const row = document.createElement('div');
      row.className = 'custom-playlist-row';
      row.dataset.index = index;
      row.innerHTML = `
        <div class="playlist-row-header">
          <input type="text" class="glass-input playlist-url" placeholder="Playlist Link or ID" value="${escapeHtml(playlist.url || '')}" />
          <button class="btn-delete-playlist" title="Remove playlist">×</button>
        </div>
        <div class="form-group" style="margin-top: 0.5rem; margin-bottom: 0;">
          <div class="slider-header">
            <label style="font-size: 0.8rem; color: var(--text-muted);">Playlist Weight</label>
            <span class="slider-value playlist-weight-value" style="font-size: 0.8rem;">${weightString}</span>
          </div>
          <input type="range" class="glass-slider slider-bipolar playlist-weight" min="-1" max="1" step="0.05" value="${playlist.weight !== undefined ? playlist.weight : 0.5}" />
          <div class="slider-labels" style="border: none; padding-top: 0.2rem; margin-top: 0.2rem;">
            <span>Malus −1.0</span>
            <span>Neutral</span>
            <span>Bonus +1.0</span>
          </div>
        </div>
      `;

      // Event listeners
      const urlInput = row.querySelector('.playlist-url');
      urlInput.addEventListener('input', (e) => {
        customPlaylists[index].url = e.target.value.trim();
        debouncedSave();
      });

      const weightInput = row.querySelector('.playlist-weight');
      const weightVal = row.querySelector('.playlist-weight-value');
      weightInput.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        customPlaylists[index].weight = val;
        weightVal.textContent = val >= 0 ? '+' + val.toFixed(2) : val.toFixed(2);
        if (val > 0) weightVal.style.color = 'hsl(145, 63%, 52%)';
        else if (val < 0) weightVal.style.color = 'hsl(348, 83%, 57%)';
        else weightVal.style.color = 'var(--text-muted)';
      });
      weightInput.addEventListener('change', saveSettings);
      // Initial color
      weightInput.dispatchEvent(new Event('input'));

      const deleteBtn = row.querySelector('.btn-delete-playlist');
      deleteBtn.addEventListener('click', () => {
        customPlaylists.splice(index, 1);
        renderCustomPlaylists();
        saveSettings();
      });

      playlistsContainer.appendChild(row);
    });
  }

  if (addPlaylistBtn) {
    addPlaylistBtn.addEventListener('click', () => {
      customPlaylists.push({ url: '', weight: 0.5 });
      renderCustomPlaylists();
      saveSettings();
    });
  }

  // ── Auto-save Settings Function ──
  let settingsReady = false; // Guard against saving before all values are loaded
  let debounceTimer = null;

  function saveSettings() {
    if (!settingsReady) return; // Don't save until both storage.get callbacks have populated inputs

    const selectedBackendEl = document.querySelector('input[name="ai-backend"]:checked');
    const selectedBackend = selectedBackendEl ? selectedBackendEl.value : 'local';
    const scanDislikes = scanDislikesToggle ? scanDislikesToggle.checked : false;
    const syncAI = syncAIToggle ? syncAIToggle.checked : false;
    const filterMusic = filterMusicToggle ? filterMusicToggle.checked : false;
    const syncLimit = syncLimitSlider ? (parseInt(syncLimitSlider.value) || 500) : 500;
    
    // Clean up empty custom playlists on save (do not re-render immediately to prevent cursor jumping)
    const cleanedPlaylists = customPlaylists.filter(pl => pl.url && pl.url.trim() !== '');

    chrome.storage.local.set({
      historyWeight: parseFloat(historySlider.value),
      wlWeight: wlSlider ? parseFloat(wlSlider.value) : 0.5,
      likedBonus: parseFloat(likedSlider.value),
      aiBackend: selectedBackend,
      useOllama: selectedBackend === 'ollama',
      useOpenAI: selectedBackend === 'openai',
      ollamaUrl: document.getElementById('ollama-url')?.value || '',
      ollamaModel: document.getElementById('ollama-model')?.value || '',
      openAIKey: document.getElementById('openai-key')?.value || '',
      openAIUrl: document.getElementById('openai-url')?.value || '',
      openAIModel: document.getElementById('openai-model')?.value || '',
      scanDislikes: scanDislikes,
      syncAI: syncAI,
      filterMusicVideos: filterMusic,
      customPlaylists: cleanedPlaylists,
      syncLimit: syncLimit
    }, () => {
      // Update stats warning immediately
      getItem('tasteMatrix', 'master').then(profile => checkAiWarning(profile));
    });
  }

  // Debounced save for text inputs — fires 400ms after last keystroke,
  // or immediately on popup unload via visibilitychange
  function debouncedSave() {
    if (!settingsReady) return;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(saveSettings, 400);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && settingsReady) {
      clearTimeout(debounceTimer);
      saveSettings();
    }
  });

  // ── Settings: AI Backend Toggle (declarations needed by the settings loader below) ──
  const radioButtons = document.querySelectorAll('input[name="ai-backend"]');
  const ollamaSettings = document.getElementById('ollama-settings');
  const openaiSettings = document.getElementById('openai-settings');

  // Load ALL saved settings in a single call to avoid race conditions
  chrome.storage.local.get([
    'historyWeight', 'wlWeight', 'likedBonus', 'scanDislikes', 'syncAI',
    'filterMusicVideos', 'customPlaylists', 'syncLimit',
    'aiBackend', 'ollamaUrl', 'ollamaModel', 'openAIKey', 'openAIUrl', 'openAIModel'
  ], (result) => {
    // Weights and sliders
    if (result.historyWeight !== undefined) {
      historySlider.value = result.historyWeight;
      historyValue.textContent = parseFloat(result.historyWeight).toFixed(2);
    }
    if (result.wlWeight !== undefined && wlSlider) {
      wlSlider.value = result.wlWeight;
      wlValue.textContent = parseFloat(result.wlWeight).toFixed(2);
    }
    if (result.likedBonus !== undefined) {
      likedSlider.value = result.likedBonus;
      updateLikedDisplay(result.likedBonus);
    }
    if (result.scanDislikes !== undefined && scanDislikesToggle) {
      scanDislikesToggle.checked = result.scanDislikes;
    }
    if (result.syncAI !== undefined && syncAIToggle) {
      syncAIToggle.checked = result.syncAI;
    }
    if (result.filterMusicVideos !== undefined && filterMusicToggle) {
      filterMusicToggle.checked = result.filterMusicVideos;
    }
    if (result.customPlaylists !== undefined) {
      customPlaylists = result.customPlaylists;
    }
    if (result.syncLimit !== undefined && syncLimitSlider) {
      syncLimitSlider.value = result.syncLimit;
      if (syncLimitValue) syncLimitValue.textContent = result.syncLimit;
    }

    // AI backend text inputs (must be populated before radio change triggers)
    if (result.ollamaUrl) document.getElementById('ollama-url').value = result.ollamaUrl;
    if (result.ollamaModel) document.getElementById('ollama-model').value = result.ollamaModel;
    if (result.openAIKey) document.getElementById('openai-key').value = result.openAIKey;
    if (result.openAIUrl) document.getElementById('openai-url').value = result.openAIUrl;
    if (result.openAIModel) document.getElementById('openai-model').value = result.openAIModel;

    if (result.aiBackend) {
      const radio = document.querySelector(`input[name="ai-backend"][value="${result.aiBackend}"]`);
      if (radio) {
        radio.checked = true;
        ollamaSettings.style.display = result.aiBackend === 'ollama' ? 'block' : 'none';
        openaiSettings.style.display = result.aiBackend === 'openai' ? 'block' : 'none';
      }
    }

    renderCustomPlaylists();

    // All settings are now loaded — enable autosave
    settingsReady = true;
  });

  // Event listeners for inputs to trigger auto-saving
  if (filterMusicToggle) {
    filterMusicToggle.addEventListener('change', saveSettings);
  }
  if (scanDislikesToggle) {
    scanDislikesToggle.addEventListener('change', saveSettings);
  }
  if (syncAIToggle) {
    syncAIToggle.addEventListener('change', saveSettings);
  }

  historySlider.addEventListener('input', (e) => {
    historyValue.textContent = parseFloat(e.target.value).toFixed(2);
  });
  historySlider.addEventListener('change', saveSettings);

  if (wlSlider) {
    wlSlider.addEventListener('input', (e) => {
      wlValue.textContent = parseFloat(e.target.value).toFixed(2);
    });
    wlSlider.addEventListener('change', saveSettings);
  }

  likedSlider.addEventListener('input', (e) => {
    updateLikedDisplay(parseFloat(e.target.value));
  });
  likedSlider.addEventListener('change', saveSettings);

  if (syncLimitSlider) {
    syncLimitSlider.addEventListener('input', (e) => {
      if (syncLimitValue) syncLimitValue.textContent = e.target.value;
    });
    syncLimitSlider.addEventListener('change', saveSettings);
  }

  function updateLikedDisplay(val) {
    const v = parseFloat(val);
    likedValue.textContent = (v >= 0 ? '+' : '') + v.toFixed(2);
    likedDisplay.textContent = (v >= 0 ? '+' : '') + v.toFixed(2);
    dislikedDisplay.textContent = (v >= 0 ? '−' : '+') + Math.abs(v).toFixed(2);
    
    // Color the value display
    if (v > 0) {
      likedValue.style.color = 'hsl(145, 63%, 52%)';
    } else if (v < 0) {
      likedValue.style.color = 'hsl(348, 83%, 57%)';
    } else {
      likedValue.style.color = 'var(--text-muted)';
    }
  }

  radioButtons.forEach(radio => {
    radio.addEventListener('change', () => {
      ollamaSettings.style.display = radio.value === 'ollama' && radio.checked ? 'block' : 'none';
      openaiSettings.style.display = radio.value === 'openai' && radio.checked ? 'block' : 'none';
      saveSettings();
    });
  });

  // Add event listeners to text inputs — use debounced input to prevent data loss on popup close
  const autoSaveInputs = ['ollama-url', 'ollama-model', 'openai-url', 'openai-key', 'openai-model'];
  autoSaveInputs.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', debouncedSave);
    }
  });

  // ── Taste Profile Sync ──
  const syncBtn = document.getElementById('sync-btn');
  const syncStatus = document.getElementById('sync-status');
  const syncProgress = document.getElementById('sync-progress');
  const syncTotal = document.getElementById('sync-total');
  const syncProgressBar = document.getElementById('sync-progress-bar');
  const syncStatusMsg = document.getElementById('sync-status-msg');

  syncBtn.addEventListener('click', () => {
    // Connect keepalive port to prevent Service Worker shutdown
    keepAlivePort = chrome.runtime.connect({ name: "keepalive" });

    syncBtn.disabled = true;
    syncBtn.innerText = 'Syncing...';
    syncStatus.classList.remove('hidden');
    if (syncProgressBar) syncProgressBar.style.width = '0%';
    syncProgress.innerText = '0';
    syncTotal.innerText = '0';

    chrome.storage.local.get(['scanDislikes', 'syncAI', 'syncLimit'], (result) => {
      const scanDislikes = result.scanDislikes || false;
      const syncAI = result.syncAI || false;
      const syncLimit = result.syncLimit || 500;

      if (syncAI) {
        if (syncStatusMsg) syncStatusMsg.innerText = 'Syncing & Generating AI Embeddings (Slow)...';
      } else {
        if (syncStatusMsg) syncStatusMsg.innerText = 'Scraping YouTube data...';
      }

      chrome.runtime.sendMessage({ 
        type: 'SYNC_TASTE_MATRIX',
        useAI: syncAI,
        scanDislikes: scanDislikes,
        syncLimit: syncLimit
      });
    });
  });

  // ── DB Stats Grid Loading ──
  async function updateDbStats() {
    const statsEl = document.getElementById('db-stats');
    if (!statsEl) return;
    
    try {
      const profile = await getItem('tasteMatrix', 'master');
      if (profile) {
        const lastSyncStr = new Date(profile.lastSync).toLocaleString();
        let playlistsStatsHtml = '';
        if (profile.customPlaylistsData && profile.customPlaylistsData.length > 0) {
          playlistsStatsHtml = '<div class="custom-playlists-stats" style="margin-top: 0.8rem; border-top: 1px solid var(--surface-border); padding-top: 0.8rem; font-size: 0.8rem; color: var(--text-muted);">';
          playlistsStatsHtml += '<div style="font-weight: 600; margin-bottom: 0.4rem; color: var(--text-main);">Custom Playlists Synced:</div>';
          profile.customPlaylistsData.forEach(pl => {
            playlistsStatsHtml += `<div class="stats-item-custom" style="display:flex; justify-content:space-between; margin-bottom:0.2rem;">
              <span title="${escapeHtml(pl.playlistId)}" style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width: 60%;">ID: ${escapeHtml(pl.playlistId)}</span>
              <strong>${pl.count || 0} videos</strong>
            </div>`;
          });
          playlistsStatsHtml += '</div>';
        }

        statsEl.innerHTML = `
          <div class="stats-grid">
            <div class="stats-item"><strong>Watched:</strong> ${profile.historyCount || 0}</div>
            <div class="stats-item"><strong>Liked:</strong> ${profile.likesCount || 0}</div>
            <div class="stats-item"><strong>Watch Later:</strong> ${profile.wlCount || 0}</div>
            <div class="stats-item"><strong>Disliked:</strong> ${profile.dislikesCount || 0}</div>
          </div>
          ${playlistsStatsHtml}
          <div class="last-sync">Last Synced: ${lastSyncStr}</div>
        `;
        checkAiWarning(profile);
      } else {
        statsEl.innerHTML = `<div class="no-profile">No taste profile found. Please sync first.</div>`;
        checkAiWarning(null);
      }
    } catch (err) {
      console.error("YtAlgoRebel: Failed to load DB stats:", err);
      statsEl.innerHTML = `<div class="no-profile">Error loading stats.</div>`;
    }
  }

  function checkAiWarning(profile) {
    const warningCard = document.getElementById('ai-warning-card');
    if (!warningCard) return;
    
    if (aiToggle.checked) {
      const hasAI = profile && profile.likesEmbeddings && profile.likesEmbeddings.length > 0;
      if (!hasAI) {
        warningCard.classList.remove('hidden');
      } else {
        warningCard.classList.add('hidden');
      }
    } else {
      warningCard.classList.add('hidden');
    }
  }

  // Load initial stats
  updateDbStats();

  // ── Message Listeners ──
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'SYNC_PROGRESS') {
      if (syncStatusMsg) {
        chrome.storage.local.get(['syncAI'], (res) => {
          if (res.syncAI) {
            syncStatusMsg.innerText = 'Generating AI Embeddings...';
          } else {
            syncStatusMsg.innerText = 'Scraping YouTube data...';
          }
        });
      }
      if (syncProgress) syncProgress.innerText = message.current;
      if (syncTotal) syncTotal.innerText = message.total;
      const percent = Math.min(100, Math.round((message.current / message.total) * 100));
      if (syncProgressBar) syncProgressBar.style.width = `${percent}%`;
    } else if (message.type === 'MODEL_DOWNLOAD_PROGRESS') {
      if (syncStatusMsg) {
        syncStatusMsg.innerText = `Downloading AI Model (~90MB)...`;
      }
      if (syncProgressBar) {
        syncProgressBar.style.width = `${Math.round(message.progress)}%`;
      }
      if (syncProgress && syncTotal) {
        const loadedMB = (message.loaded / (1024 * 1024)).toFixed(1);
        const totalMB = (message.total / (1024 * 1024)).toFixed(1);
        syncProgress.innerText = `${loadedMB} MB`;
        syncTotal.innerText = `${totalMB} MB`;
      }
    } else if (message.type === 'SYNC_STATUS_MSG') {
      if (syncStatusMsg) syncStatusMsg.innerText = message.msg;
    } else if (message.type === 'SYNC_COMPLETE') {
      if (keepAlivePort) {
        keepAlivePort.disconnect();
        keepAlivePort = null;
      }

      syncBtn.innerText = message.success ? '✓ Sync Completed' : '✗ Sync Failed';
      if (message.success) syncBtn.style.background = 'hsl(145, 63%, 42%)';
      
      updateDbStats(); // Refresh stats immediately
      
      setTimeout(() => {
        syncBtn.disabled = false;
        syncBtn.innerText = 'Sync Taste Profile';
        syncBtn.style.background = '';
        syncStatus.classList.add('hidden');
      }, 3000);
    } else if (message.type === 'SCORE_PROGRESS') {
      const scoreProgressText = document.getElementById('score-progress');
      const scoreTotalText = document.getElementById('score-total');
      const scoreProgressBar = document.getElementById('score-progress-bar');
      
      if (scoreProgressText && scoreTotalText && scoreProgressBar) {
        scoreProgressText.textContent = message.current;
        scoreTotalText.textContent = message.total;
        const percent = Math.min(100, Math.round((message.current / message.total) * 100));
        scoreProgressBar.style.width = `${percent}%`;
      }
    }
  });
});
