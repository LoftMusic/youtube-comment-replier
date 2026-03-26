/**
 * Simple API Server for YouTube Comment Auto-Replier GUI
 * 
 * Run: node server.js
 * GUI: http://127.0.0.1:3000
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const http = require('http');

// OAuth2 Client (must be defined before routes that use it)
const oauth2Client = new google.auth.OAuth2(
  process.env.YOUTUBE_CLIENT_ID,
  process.env.YOUTUBE_CLIENT_SECRET,
  process.env.YOUTUBE_REDIRECT_URI || 'http://127.0.0.1:3000/callback'
);

const app = express();
app.use(express.json());

// OAuth callback handler (must be before static middleware)
app.get('/callback', async (req, res) => {
  const { code, state } = req.query;
  
  if (!code) {
    return res.send('<h1>OAuth Failed</h1><p>No authorization code received</p><script>window.close()</script>');
  }
  
  try {
    const { tokens } = await oauth2Client.getToken(code);
    
    // Get channel info using the tokens
    oauth2Client.setCredentials(tokens);
    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
    
    // Get ALL channels the user has access to (including brand accounts where user is editor)
    let channels = [];
    
    // Try different methods to get channels
    const methods = [
      { name: 'owned', params: { mine: true, part: 'snippet', maxResults: 50 }},
      { name: 'managed', params: { managedByMe: true, part: 'snippet', maxResults: 50 }},
      { name: 'mySubscribers', params: { mine: true, mySubscribers: true, part: 'snippet', maxResults: 50 }},
      { name: 'contentOwner', params: { mine: true, part: 'snippet', maxResults: 50, onBehalfOfContentOwnerChannel: true }}
    ];
    
    for (const method of methods) {
      try {
        const response = await youtube.channels.list(method.params);
        const items = response.data.items || [];
        const existingIds = new Set(channels.map(c => c.id));
        for (const ch of items) {
          if (!existingIds.has(ch.id)) {
            channels.push(ch);
          }
        }
        console.log('Method ' + method.name + ': ' + items.length + ' channels');
      } catch (e) {
        console.log('Method ' + method.name + ' error: ' + e.message);
      }
    }
    
    // Also try to get channel associations via search
    try {
      const searchResponse = await youtube.search.list({
        mine: true,
        part: 'snippet',
        type: 'channel',
        maxResults: 50
      });
      for (const item of searchResponse.data.items || []) {
        const existingIds = new Set(channels.map(c => c.id));
        if (!existingIds.has(item.id.channelId)) {
          // Need to get full channel details
          try {
            const chDetails = await youtube.channels.list({
              id: item.id.channelId,
              part: 'snippet'
            });
            if (chDetails.data.items?.[0]) {
              channels.push(chDetails.data.items[0]);
            }
          } catch (e) {}
        }
      }
    } catch (e) {
      console.log('Search method error: ' + e.message);
    }
    
    // Debug: show what we found
    console.log('Total channels found:', channels.length);
    
    if (channels.length === 0) {
      return res.send('<h1>❌ No Channels Found</h1><p>No YouTube channels found for this account</p><script>window.close()</script>');
    }
    
    if (channels.length === 1) {
      // Single channel - save directly
      const channel = channels[0];
      const channelName = channel.snippet.title;
      const channelId = channel.id;
      
      const safeName = channelName.replace(/[^a-zA-Z0-9]/g, '_');
      const tokenPath = path.join(__dirname, 'tokens', `${safeName}.json`);
      
      // Save token with channel info
      fs.writeFileSync(tokenPath, JSON.stringify({ ...tokens, channelName, channelId }, null, 2));
      
      res.send('<h1>✅ Success!</h1><p>Channel "' + channelName + '" authorized!</p><script>setTimeout(() => window.close(), 2000)</script>');
    } else {
      // Multiple channels - show selection page
      let html = `
<!DOCTYPE html>
<html>
<head>
  <title>Select Channel</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0a0a0a; color: #fff; padding: 40px; }
    h1 { margin-bottom: 20px; }
    .channel-list { display: flex; flex-direction: column; gap: 10px; }
    .channel-btn { background: #222; border: 1px solid #333; padding: 15px 20px; border-radius: 8px; cursor: pointer; text-align: left; transition: background 0.2s; }
    .channel-btn:hover { background: #333; }
    .channel-name { font-weight: bold; font-size: 16px; }
    .channel-id { font-size: 12px; color: #666; }
  </style>
</head>
<body>
  <h1>Select a Channel</h1>
  <p>Choose which channel to authorize:</p>
  <div class="channel-list">
`;
      for (const channel of channels) {
        const channelName = channel.snippet.title;
        const channelId = channel.id;
        const safeName = channelName.replace(/[^a-zA-Z0-9]/g, '_');
        html += `<button class="channel-btn" onclick="selectChannel('${safeName}', '${channelName.replace(/'/g, "\\'")}', '${channelId}')">
          <div class="channel-name">${channelName}</div>
          <div class="channel-id">${channelId}</div>
        </button>`;
      }
      html += `
  </div>
  <script>
    function selectChannel(safeName, channelName, channelId) {
      // Save token via API
      fetch('/api/channels/save', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ tokens: ${JSON.stringify(tokens)}, channelName, channelId, safeName })
      })
      .then(() => {
        document.body.innerHTML = '<h1>✅ Success!</h1><p>Channel "' + channelName + '" authorized!</p><script>setTimeout(() => window.close(), 2000)</script>';
      })
      .catch(err => {
        document.body.innerHTML = '<h1>❌ Error</h1><p>' + err.message + '</p>';
      });
    }
  </script>
</body>
</html>`;
      res.send(html);
    }
  } catch (e) {
    res.send('<h1>❌ Error</h1><p>' + e.message + '</p>');
  }
});

app.use(express.static(__dirname));

const CONFIG = {
  clientId: process.env.YOUTUBE_CLIENT_ID,
  clientSecret: process.env.YOUTUBE_CLIENT_SECRET,
  redirectUri: process.env.YOUTUBE_REDIRECT_URI || 'http://localhost',
  ollamaHost: process.env.OLLAMA_HOST || 'http://127.0.0.1:11434',
  emotionModel: 'minimax-m2.5:cloud',
  delayMs: 333,  // 3 replies per second
  maxRepliesPerRun: 50,
  dailyLimit: 100,
  variedReplies: ["Asculta Acum:", "Ascultă acum:", "Ascultă și tu:", "Listen now:", "🎵 Ascultă acum:", "🔥 Ascultă acum:"]
};

// OAuth2 Client (for callback route) - now defined at top of file

const REPLIED_FILE = path.join(__dirname, 'replied.json');
const BATCH_FILE = path.join(__dirname, 'last-batch.json');
const HISTORY_FILE = path.join(__dirname, 'history.json');

// Helpers
function loadFile(f) { return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim() : ''; }
function saveFile(f, c) { fs.writeFileSync(f, c); }

function loadReplied() { return fs.existsSync(REPLIED_FILE) ? JSON.parse(fs.readFileSync(REPLIED_FILE, 'utf8')) : {}; }
function saveReplied(d) { fs.writeFileSync(REPLIED_FILE, JSON.stringify(d, null, 2)); }
function loadBatch() { return fs.existsSync(BATCH_FILE) ? JSON.parse(fs.readFileSync(BATCH_FILE, 'utf8')) : { replies: [] }; }
function saveBatch(d) { fs.writeFileSync(BATCH_FILE, JSON.stringify(d, null, 2)); }

function loadHistory() { return fs.existsSync(HISTORY_FILE) ? JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')) : []; }
function saveHistory(d) { fs.writeFileSync(HISTORY_FILE, JSON.stringify(d, null, 2)); }

function loadVideos() {
  const content = loadFile(path.join(__dirname, 'videos.txt'));
  return content.split('\n').filter(l => l.trim() && !l.startsWith('#')).map(line => {
    const [channelName, videoUrl] = line.split('|').map(s => s.trim());
    const match = videoUrl?.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    return { channelName, videoUrl, videoId: match ? match[1] : null };
  });
}

function loadPartAOptions() {
  const f = path.join(__dirname, 'part-a-options.txt');
  if (!fs.existsSync(f)) return [];
  const content = fs.readFileSync(f, 'utf8');
  return content.split('\n').filter(l => l.trim());
}

function getRandomPartA(options) {
  if (options.length === 0) return 'Ascultă acum:';
  return options[Math.floor(Math.random() * options.length)];
}

function saveConfig(data) {
  if (data.partA !== undefined) fs.writeFileSync(path.join(__dirname, 'part-a.txt'), data.partA);
  if (data.partB !== undefined) fs.writeFileSync(path.join(__dirname, 'part-b.txt'), data.partB);
  if (data.videos !== undefined) fs.writeFileSync(path.join(__dirname, 'videos.txt'), data.videos);
}

// API Routes
app.get('/api/config', (req, res) => {
  res.json({
    partA: loadFile(path.join(__dirname, 'part-a.txt')),
    partB: loadFile(path.join(__dirname, 'part-b.txt')),
    partAOptions: loadPartAOptions(),
    videos: loadFile(path.join(__dirname, 'videos.txt'))
  });
});

app.get('/api/part-a-options', (req, res) => {
  const options = loadPartAOptions();
  res.json(options);
});

app.post('/api/part-a-options', (req, res) => {
  const { options } = req.body;
  if (Array.isArray(options)) {
    fs.writeFileSync(path.join(__dirname, 'part-a-options.txt'), options.join('\n'));
    res.json({ success: true });
  } else {
    res.json({ success: false, error: 'Invalid options' });
  }
});

app.get('/api/stats', (req, res) => {
  const tokensDir = path.join(__dirname, 'tokens');
  const tokenFiles = fs.readdirSync(tokensDir).filter(f => f.endsWith('.json'));
  const replied = loadReplied();
  const today = new Date().toISOString().split('T')[0];
  const videos = loadVideos();
  
  // Get channel names from token filenames
  const channelNames = tokenFiles.map(f => f.replace('.json', '').replace(/_/g, ' '));
  
  res.json({
    channels: tokenFiles.length,
    channelNames: channelNames,
    today: replied[today]?.length || 0,
    pending: videos.length
  });
});

app.get('/api/history', (req, res) => {
  const history = loadHistory();
  // Sort by date descending
  history.sort((a, b) => new Date(b.date) - new Date(a.date));
  res.json(history);
});

app.post('/api/history/revert', async (req, res) => {
  const { videoId, videoUrl } = req.body;
  
  try {
    // Get tokens
    const tokensDir = path.join(__dirname, 'tokens');
    const tokenFiles = fs.readdirSync(tokensDir).filter(f => f.endsWith('.json'));
    if (tokenFiles.length === 0) return res.json({ success: false, error: 'No tokens found' });
    
    const tokens = JSON.parse(fs.readFileSync(path.join(tokensDir, tokenFiles[0]), 'utf8'));
    const oauth2Client = new google.auth.OAuth2(CONFIG.clientId, CONFIG.clientSecret, CONFIG.redirectUri);
    oauth2Client.setCredentials(tokens);
    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
    
    // Find replies for this video
    let nextPageToken = null;
    let deleted = 0;
    
    do {
      const response = await youtube.commentThreads.list({
        part: 'snippet,replies',
        videoId: videoId,
        textFormat: 'plainText',
        maxResults: 50,
        pageToken: nextPageToken
      });
      
      if (response.data.items) {
        for (const thread of response.data.items) {
          // Check replies
          if (thread.replies && thread.replies.comments) {
            for (const reply of thread.replies.comments) {
              const replyAuthorChannel = reply.snippet.authorChannelId?.value;
              // Get our channel ID from token
              if (replyAuthorChannel) {
                try {
                  await youtube.comments.delete({ id: reply.id });
                  deleted++;
                } catch (e) {
                  console.log('Delete error:', e.message);
                }
              }
            }
          }
        }
      }
      
      nextPageToken = response.data.nextPageToken;
    } while (nextPageToken);
    
    // Update replied tracking
    const replied = loadReplied();
    if (replied[videoId]) {
      delete replied[videoId];
      saveReplied(replied);
    }
    
    // Update history - mark as reverted
    const history = loadHistory();
    const historyEntry = history.find(h => h.videoId === videoId);
    if (historyEntry) {
      historyEntry.reverted = true;
      historyEntry.revertedAt = new Date().toISOString();
      saveHistory(history);
    }
    
    res.json({ success: true, deleted });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

app.post('/api/config', (req, res) => {
  saveConfig(req.body);
  res.json({ success: true });
});

app.post('/api/run', async (req, res) => {
  try {
    const videos = loadVideos();
    const partB = loadFile(path.join(__dirname, 'part-b.txt'));
    const partAOptions = loadPartAOptions();
    const replied = loadReplied();
    
    const tokensDir = path.join(__dirname, 'tokens');
    const tokenFiles = fs.readdirSync(tokensDir).filter(f => f.endsWith('.json'));
    if (tokenFiles.length === 0) return res.json({ success: false, error: 'No tokens found' });
    
    const tokens = JSON.parse(fs.readFileSync(path.join(tokensDir, tokenFiles[0]), 'utf8'));
    const oauth2Client = new google.auth.OAuth2(CONFIG.clientId, CONFIG.clientSecret, CONFIG.redirectUri);
    oauth2Client.setCredentials(tokens);
    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
    
    let repliesSent = 0;
    const batchReplies = [];
    const runHistory = [];
    
    for (const video of videos) {
      if (!video.videoId || repliesSent >= CONFIG.maxRepliesPerRun) continue;
      
      // Get video title
      let videoTitle = 'Unknown';
      try {
        const videoResp = await youtube.videos.list({ part: 'snippet', id: video.videoId });
        if (videoResp.data.items && videoResp.data.items[0]) {
          videoTitle = videoResp.data.items[0].snippet.title;
        }
      } catch (e) {
        console.log('Could not fetch video title:', e.message);
      }
      
      // Get comments
      let comments = [], nextPageToken = null;
      do {
        const r = await youtube.commentThreads.list({ part: 'snippet', videoId: video.videoId, textFormat: 'plainText', maxResults: 100, pageToken: nextPageToken });
        if (r.data.items) for (const item of r.data.items) {
          comments.push({ id: item.snippet.topLevelComment.id, author: item.snippet.topLevelComment.snippet.authorDisplayName, text: item.snippet.topLevelComment.snippet.textDisplay });
        }
        nextPageToken = r.data.nextPageToken;
      } while (nextPageToken);
      
      console.log(`Video ${video.videoId}: Found ${comments.length} comments`);
      
      const videoReplied = replied[video.videoId] || [];
      let videoReplies = 0;
      let sentimentCounts = { POSITIVE: 0, NEGATIVE: 0, NEUTRAL: 0 };
      
      for (const comment of comments) {
        if (repliesSent >= CONFIG.maxRepliesPerRun) break;
        if (videoReplied.includes(comment.id)) continue;
        
        // Detect sentiment
        const sentiment = await detectEmotion(comment.text);
        sentimentCounts[sentiment] = (sentimentCounts[sentiment] || 0) + 1;
        if (sentiment !== 'POSITIVE') continue;
        
        console.log(`Comment ${comment.id}: POSITIVE - Replying...`);
        
        // Build reply - randomly select from Part A options
        const partAText = getRandomPartA(partAOptions);
        const reply = `${partAText}\n\n${partB}`;
        
        // Send reply
        try {
          const result = await youtube.comments.insert({ part: 'snippet', resource: { snippet: { parentId: comment.id, textOriginal: reply } } });
          console.log(`Reply sent: ${result.data.id}`);
          
          if (!replied[video.videoId]) replied[video.videoId] = [];
          replied[video.videoId].push(comment.id);
          batchReplies.push({ videoId: video.videoId, commentId: comment.id, replyId: result.data.id });
          repliesSent++;
          videoReplies++;
        } catch (e) {
          console.log(`Error sending reply: ${e.message}`);
        }
        
        await new Promise(r => setTimeout(r, CONFIG.delayMs));
      }
      
      console.log(`Video ${video.videoId}: Sent ${videoReplies} replies. Sentiments:`, sentimentCounts);
      
      // Record to history (even if no replies)
      let historyNote = '';
      if (comments.length === 0) {
        historyNote = 'No comments found on video';
      } else if (videoReplied.length >= comments.length) {
        historyNote = `All ${comments.length} comments already replied to`;
      } else if (sentimentCounts.POSITIVE === 0) {
        historyNote = `No positive comments found (${sentimentCounts.NEGATIVE} negative, ${sentimentCounts.NEUTRAL} neutral)`;
      }
      
      if (historyNote || videoReplies > 0) {
        runHistory.push({
          videoId: video.videoId,
          videoUrl: video.videoUrl,
          videoTitle: videoTitle,
          date: new Date().toISOString(),
          replies: videoReplies,
          note: historyNote,
          reverted: false
        });
      }
    }
    
    saveReplied(replied);
    saveBatch({ replies: batchReplies });
    
    // Update history
    const history = loadHistory();
    history.push(...runHistory);
    saveHistory(history);
    
    res.json({ success: true, replies: repliesSent });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

app.post('/api/revert', async (req, res) => {
  try {
    const batch = loadBatch();
    if (!batch.replies?.length) return res.json({ success: false, error: 'No batch to revert' });
    
    const tokensDir = path.join(__dirname, 'tokens');
    const tokens = JSON.parse(fs.readFileSync(path.join(tokensDir, fs.readdirSync(tokensDir)[0]), 'utf8'));
    const oauth2Client = new google.auth.OAuth2(CONFIG.clientId, CONFIG.clientSecret, CONFIG.redirectUri);
    oauth2Client.setCredentials(tokens);
    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
    
    let deleted = 0;
    for (const reply of batch.replies) {
      try { await youtube.comments.delete({ id: reply.replyId }); deleted++; } catch (e) { console.log(e.message); }
    }
    
    const replied = loadReplied();
    for (const reply of batch.replies) {
      if (replied[reply.videoId]) replied[reply.videoId] = replied[reply.videoId].filter(id => id !== reply.commentId);
    }
    saveReplied(replied);
    saveBatch({ replies: [] });
    
    // Mark as reverted in history
    const history = loadHistory();
    const videoIds = [...new Set(batch.replies.map(r => r.videoId))];
    for (const vid of videoIds) {
      const entry = history.find(h => h.videoId === vid && !h.reverted);
      if (entry) {
        entry.reverted = true;
        entry.revertedAt = new Date().toISOString();
      }
    }
    saveHistory(history);
    
    res.json({ success: true, deleted });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

async function detectEmotion(text) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ model: CONFIG.emotionModel, prompt: `Analyze sentiment. Reply only POSITIVE, NEGATIVE, or NEUTRAL.\n\n"${text}"\n\nSentiment:`, stream: false });
    const url = new URL(CONFIG.ollamaHost + '/api/generate');
    const req = http.request({ hostname: url.hostname, port: url.port, path: url.pathname, method: 'POST', headers: { 'Content-Type': 'application/json' } }, (res) => {
      let body = ''; res.on('data', c => body += c); res.on('end', () => {
        try {
          const r = JSON.parse(body).response.trim().toUpperCase();
          resolve(r.includes('POSITIVE') ? 'POSITIVE' : r.includes('NEGATIVE') ? 'NEGATIVE' : 'NEUTRAL');
        } catch { resolve('NEUTRAL'); }
      });
    });
    req.on('error', reject); req.write(data); req.end();
  });
}

const PORT = 3000;

// Store pending OAuth requests
const pendingOAuth = {};

// Generate OAuth URL
app.get('/api/oauth/url', (req, res) => {
  const state = Date.now().toString();
  
  const scopes = [
    'https://www.googleapis.com/auth/youtube.force-ssl',
    'https://www.googleapis.com/auth/youtube',
    'https://www.googleapis.com/auth/youtubepartner'
  ];
  
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent select_account',
    state: state,
    accessMode: 'delegate'
  });
  
  pendingOAuth[state] = { created: Date.now() };
  res.json({ url: authUrl, state: state });
});

// Clear all history and replied
app.post('/api/history/clear', (req, res) => {
  try {
    fs.writeFileSync(REPLIED_FILE, JSON.stringify({}, null, 2));
    fs.writeFileSync(HISTORY_FILE, JSON.stringify([], null, 2));
    fs.writeFileSync(BATCH_FILE, JSON.stringify({ replies: [] }, null, 2));
    res.json({ success: true });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n🎬 YouTube Comment Auto-Replier GUI`);
  console.log(`   Open: http://127.0.0.1:${PORT}/gui.html\n`);
});

// API: Remove channel token
app.delete('/api/channels/:name', (req, res) => {
  const { name } = req.params;
  const safeName = name.replace(/[^a-zA-Z0-9]/g, '_');
  const tokenPath = path.join(__dirname, 'tokens', `${safeName}.json`);
  
  if (fs.existsSync(tokenPath)) {
    fs.unlinkSync(tokenPath);
    res.json({ success: true });
  } else {
    res.json({ success: false, error: 'Channel not found' });
  }
});

// API: Save selected channel token
app.post('/api/channels/save', (req, res) => {
  const { tokens, channelName, channelId, safeName } = req.body;
  
  const tokenPath = path.join(__dirname, 'tokens', `${safeName}.json`);
  fs.writeFileSync(tokenPath, JSON.stringify({ ...tokens, channelName, channelId }, null, 2));
  
  res.json({ success: true });
});
