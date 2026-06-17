const assert = require('assert');

// 1. The Normalization Logic from background.js
function normalizeTitle(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#32;/g, ' ')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

// 2. The Safe Zone Alignment Logic from background.js
function runSafeZoneAlignment(likesEntries, myActivityEntries, playlistDislikes = []) {
  // Build set of known liked normalized titles (from LL playlist)
  const likedNormalizedSet = new Set(likesEntries.map((e) => normalizeTitle(e.title)));

  // Get dislikes: start with playlist DL (if available)
  let dislikesEntries = [...playlistDislikes];
  const existingDislikesNormalized = new Set(dislikesEntries.map((e) => normalizeTitle(e.title)));

  let safeZoneLimitIndex = -1;
  let warnLogged = false;

  // Custom warn logging spy
  const logWarn = (msg) => {
    warnLogged = true;
    console.log(`[SPY WARN]: ${msg}`);
  };

  if (likesEntries.length < 100) {
    // Complete Liked list: entire My Activity is safe to process
    safeZoneLimitIndex = myActivityEntries.length - 1;
  } else {
    // Incomplete Liked list: find the oldest liked video present in My Activity to anchor the safe zone.
    // Search backwards through likesEntries to find the oldest one that matches an entry in myActivityEntries.
    for (let i = likesEntries.length - 1; i >= 0; i--) {
      const likedNorm = normalizeTitle(likesEntries[i].title);
      const idx = myActivityEntries.findIndex((e) => normalizeTitle(e.title) === likedNorm);
      if (idx !== -1) {
        safeZoneLimitIndex = idx;
        break;
      }
    }
  }

  if (safeZoneLimitIndex !== -1) {
    // Process only entries in the Safe Zone
    for (let k = 0; k <= safeZoneLimitIndex; k++) {
      const entry = myActivityEntries[k];
      const norm = normalizeTitle(entry.title);

      if (!likedNormalizedSet.has(norm) && !existingDislikesNormalized.has(norm)) {
        dislikesEntries.push(entry);
        existingDislikesNormalized.add(norm);
      }
    }
  } else {
    logWarn(
      'YtAlgoRebel: No overlap found between Liked Playlist and My Activity, and liked list is incomplete. Safe zone is empty. Skipping My Activity entries to prevent false positives.'
    );
  }

  return {
    dislikesEntries,
    safeZoneLimitIndex,
    warnLogged,
  };
}

// 3. Tests definition
const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

// Scenario 1: likesEntries is complete (length < 100)
test('Scenario 1: Complete likes list processes entire My Activity and marks unliked items as dislikes', () => {
  const likesEntries = [{ title: 'Liked Video A' }, { title: 'Liked Video B' }];
  const myActivityEntries = [
    { title: 'Liked Video A', channel: 'Channel A' },
    { title: 'Disliked Video X', channel: 'Channel X' },
    { title: 'Liked Video B', channel: 'Channel B' },
    { title: 'Disliked Video Y', channel: 'Channel Y' },
  ];
  const playlistDislikes = [];

  const result = runSafeZoneAlignment(likesEntries, myActivityEntries, playlistDislikes);

  // Verification
  assert.strictEqual(
    result.safeZoneLimitIndex,
    myActivityEntries.length - 1,
    'Safe zone limit index should be the last index of myActivityEntries'
  );
  assert.strictEqual(result.warnLogged, false, 'No warnings should be logged');
  assert.strictEqual(result.dislikesEntries.length, 2, 'Should have exactly 2 dislikes added');
  assert.strictEqual(result.dislikesEntries[0].title, 'Disliked Video X');
  assert.strictEqual(result.dislikesEntries[1].title, 'Disliked Video Y');
});

// Scenario 2: likesEntries is incomplete (length >= 100) and has overlap with myActivityEntries
test('Scenario 2: Incomplete likes list with overlap finds safe zone anchor and ignores older entries', () => {
  // Create 100 likes
  const likesEntries = [];
  for (let i = 0; i < 98; i++) {
    likesEntries.push({ title: `Random Liked ${i}` });
  }
  // We add two specific ones at the end (oldest retrieved likes)
  likesEntries.push({ title: 'Second Oldest Liked' });
  likesEntries.push({ title: 'Oldest Liked' });

  // My activity entries:
  // Newest index 0 to oldest
  const myActivityEntries = [
    { title: 'New Disliked Video 1' },
    { title: 'Second Oldest Liked' }, // matches liked index 98
    { title: 'New Disliked Video 2' },
    { title: 'Oldest Liked' }, // matches liked index 99 (this is the oldest liked video, so it should anchor)
    { title: 'Old Disliked Video' }, // older than oldest liked, should be ignored
    { title: 'Another Old Disliked' }, // older than oldest liked, should be ignored
  ];

  const result = runSafeZoneAlignment(likesEntries, myActivityEntries, []);

  // Verification
  // The oldest liked video is 'Oldest Liked' (index 99 in likesEntries).
  // In myActivityEntries, 'Oldest Liked' is at index 3.
  assert.strictEqual(
    result.safeZoneLimitIndex,
    3,
    'Safe zone limit index should anchor at index 3'
  );
  assert.strictEqual(result.warnLogged, false, 'No warnings should be logged');

  // The processed items in the safe zone are indices 0, 1, 2, 3.
  // Index 0: New Disliked Video 1 -> Should be added
  // Index 1: Second Oldest Liked -> Liked, should not be added
  // Index 2: New Disliked Video 2 -> Should be added
  // Index 3: Oldest Liked -> Liked, should not be added
  // Index 4 and 5: Beyond safe zone limit index (3), so they should be ignored.
  assert.strictEqual(
    result.dislikesEntries.length,
    2,
    'Should only add the 2 dislikes within the safe zone'
  );
  assert.strictEqual(result.dislikesEntries[0].title, 'New Disliked Video 1');
  assert.strictEqual(result.dislikesEntries[1].title, 'New Disliked Video 2');
});

// Scenario 3: likesEntries is incomplete (length >= 100) and has no overlap with myActivityEntries
test('Scenario 3: Incomplete likes list without overlap warns and skips My Activity processing', () => {
  // Create 100 likes
  const likesEntries = [];
  for (let i = 0; i < 100; i++) {
    likesEntries.push({ title: `Liked Video ${i}` });
  }

  const myActivityEntries = [{ title: 'Disliked Video A' }, { title: 'Disliked Video B' }];

  const result = runSafeZoneAlignment(likesEntries, myActivityEntries, []);

  // Verification
  assert.strictEqual(result.safeZoneLimitIndex, -1, 'Safe zone limit index should be -1');
  assert.strictEqual(result.warnLogged, true, 'Warning should have been logged');
  assert.strictEqual(result.dislikesEntries.length, 0, 'No dislikes should be added');
});

// Scenario 4: Verify alphanumeric normalization matches titles with minor differences
test('Scenario 4: Alphanumeric normalization correctly matches titles with minor differences', () => {
  const variations = [
    'hello, world!',
    'Hello World',
    'hello\u00a0world', // non-breaking space
    'hello &amp; world', // html entity
    'hello world',
  ];

  const normalizedResults = variations.map(normalizeTitle);

  normalizedResults.forEach((val, idx) => {
    assert.strictEqual(
      val,
      'helloworld',
      `Variation "${variations[idx]}" should normalize to "helloworld"`
    );
  });

  // Let's test alignment matching using minor differences
  const likesEntries = [{ title: 'Hello, World!' }];
  const myActivityEntries = [
    { title: 'hello\u00a0world' }, // non-breaking space variation
  ];
  const result = runSafeZoneAlignment(likesEntries, myActivityEntries, []);

  assert.strictEqual(
    result.dislikesEntries.length,
    0,
    'Should match and filter out the liked video variation'
  );
});

// Run all tests
let failedCount = 0;
console.log('Running Safe Zone Timeline Alignment Tests...\n');
for (const t of tests) {
  try {
    t.fn();
    console.log(`\x1b[32m[PASS]\x1b[0m ${t.name}`);
  } catch (err) {
    console.error(`\x1b[31m[FAIL]\x1b[0m ${t.name}`);
    console.error(err);
    failedCount++;
  }
}

console.log(`\nTest Summary: ${tests.length - failedCount} passed, ${failedCount} failed.`);
if (failedCount > 0) {
  process.exit(1);
} else {
  console.log('All tests passed successfully!');
}
