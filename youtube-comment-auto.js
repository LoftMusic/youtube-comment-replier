/**
 * YouTube Comment Auto-Replier v2
 * 
 * Features:
 * - Emotion detection (positive only)
 * - Duplicate prevention (tracks replied comments)
 * - Revert/undo last batch
 * - Anti-spam measures
 * 
 * Run: node youtube-comment-auto.js
 * Revert: node youtube-comment-auto.js --revert
 */

const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// ============================================
// CONFIGURATION
// ============================================

const CONFIG = {
  clientId: process.env.YOUTUBE_CLIENT_ID,
  clientSecret: process.env.YOUTUBE_CLIENT_SECRET,
  redirectUri: process.env.YOUTUBE_REDIRECT_URI || 'http://localhost',
  
  // Ollama
  ollamaHost: 'http://127.0.0.1:11434',
  emotionModel: 'minimax-m2.5:cloud',
  
  // Files
  inputVideosFile: 'videos.txt',
  inputPartAFile: 'part-a.txt',
  inputPartBFile: 'part-b.txt',
  tokensDir: 'tokens',
  
  // Anti-spam settings
  delayMs: 2000,          // Delay between replies (ms)
  maxRepliesPerRun: 50,  // Max replies per run
  dailyLimit: 100,       // Max replies per day
  
  // Varied replies (randomly pick one)
  variedReplies: [
    "Asculta Acum:",
    "Ascultă acum:",
    "Ascultă și tu:",
    "Listen now:",
    "🎵 Ascultă acum:",
    "🔥 Ascultă acum:",
  ]
};

const REPLIED_FILE = path.join(__dirname, 'replied.json');
const BATCH_FILE = path.join(__dirname, 'last-batch.json');

// ============================================
// UTILITIES
// ============================================

function loadFile(filename) {
  const filepath = path.join(__dirname, filename);
  if (!fs.existsSync(filepath)) return '';
  return fs.readFileSync(filepath, 'utf8').trim();
}

function loadVideos() {
  const content = loadFile(CONFIG.inputVideosFile);
  const lines = content.split('\n').filter(l => l.trim() && !l.startsWith('#'));
  return lines.map(line => {
    const [channelName, videoUrl] = line.split('|').map(s => s.trim());
    const videoIdMatch = videoUrl.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    const videoId = videoIdMatch ? videoIdMatch[1] : null;
    return { channelName, videoUrl, videoId };
  });
}

function loadReplyTemplates() {
  const partA = loadFile(CONFIG.inputPartAFile);
  const partB = loadFile(CONFIG.inputPartBFile).trim();
  return { partA, partB };
}

// ============================================
// TRACKING
// ============================================

function loadReplied() {
  if (!fs.existsSync(REPLIED_FILE)) return {};
  return JSON.parse(fs.readFileSync(REPLIED_FILE, 'utf8'));
}

function saveReplied(data) {
  fs.writeFileSync(REPLIED_FILE, JSON.stringify(data, null, 2));
}

function loadBatch() {
  if (!fs.existsSync(BATCH_FILE)) return { replies: [] };
  return JSON.parse(fs.readFileSync(BATCH_FILE, 'utf8'));
}

function saveBatch(data) {
  fs.writeFileSync(BATCH_FILE, JSON.stringify(data, null, 2));
}

// ============================================
// OLLAMA EMOTION DETECTION
// ============================================

async function detectEmotion(text) {
  const prompt = `Analyze the sentiment of this YouTube comment. 
Respond with only ONE word: POSITIVE, NEGATIVE, or NEUTRAL.

Comment: "${text}"

Sentiment:`;

  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      model: CONFIG.emotionModel,
      prompt: prompt,
      stream: false
    });

    const url = new URL(CONFIG.ollamaHost + '/api/generate');
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(body);
          const response = result.response.trim().toUpperCase();
          if (response.includes('POSITIVE')) resolve('POSITIVE');
          else if (response.includes('NEGATIVE')) resolve('NEGATIVE');
          else resolve('NEUTRAL');
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// ============================================
// YOUTUBE API
// ============================================

function createYoutubeClient(channelTokens) {
  const oauth2Client = new google.auth.OAuth2(CONFIG.clientId, CONFIG.clientSecret, CONFIG.redirectUri);
  oauth2Client.setCredentials(channelTokens);
  return google.youtube({ version: 'v3', auth: oauth2Client });
}

async function getVideoComments(youtube, videoId) {
  const comments = [];
  let nextPageToken = null;
  do {
    const response = await youtube.commentThreads.list({
      part: 'snippet',
      videoId: videoId,
      textFormat: 'plainText',
      maxResults: 100,
      pageToken: nextPageToken
    });
    if (response.data.items) {
      for (const item of response.data.items) {
        const snippet = item.snippet.topLevelComment.snippet;
        comments.push({
          id: item.snippet.topLevelComment.id,
          author: snippet.authorDisplayName,
          text: snippet.textDisplay,
          likeCount: snippet.likeCount
        });
      }
    }
    nextPageToken = response.data.nextPageToken;
  } while (nextPageToken);
  return comments;
}

async function replyToComment(youtube, parentCommentId, replyText) {
  const response = await youtube.comments.insert({
    part: 'snippet',
    resource: { snippet: { parentId: parentCommentId, textOriginal: replyText } }
  });
  return response.data;
}

async function deleteComment(youtube, commentId) {
  await youtube.comments.delete({ id: commentId });
}

// ============================================
// MAIN
// ============================================

async function revertLastBatch() {
  const batch = loadBatch();
  if (!batch.replies || batch.replies.length === 0) {
    console.log('\n⚠️  No batch to revert.\n');
    return;
  }

  console.log(`\n🔄 Reverting last batch (${batch.replies.length} replies)...\n`);
  
  // Find any token
  const tokensDir = path.join(__dirname, CONFIG.tokensDir);
  const tokenFiles = fs.readdirSync(tokensDir).filter(f => f.endsWith('.json'));
  if (tokenFiles.length === 0) {
    console.error('\n❌ No tokens found\n');
    process.exit(1);
  }
  
  const channelTokens = JSON.parse(fs.readFileSync(path.join(tokensDir, tokenFiles[0]), 'utf8'));
  const youtube = createYoutubeClient(channelTokens);
  
  let deleted = 0;
  for (const reply of batch.replies) {
    try {
      await deleteComment(youtube, reply.replyId);
      console.log(`   ✅ Deleted reply to ${reply.commentAuthor}`);
      deleted++;
    } catch (e) {
      console.log(`   ❌ Failed to delete: ${e.message}`);
    }
  }
  
  // Remove from replied tracking
  const replied = loadReplied();
  for (const reply of batch.replies) {
    if (replied[reply.videoId]) {
      replied[reply.videoId] = replied[reply.videoId].filter(id => id !== reply.commentId);
    }
  }
  saveReplied(replied);
  
  // Clear batch
  saveBatch({ replies: [] });
  
  console.log(`\n✅ Reverted ${deleted} replies\n`);
}

async function main() {
  // Check for revert flag
  if (process.argv.includes('--revert')) {
    await revertLastBatch();
    return;
  }

  console.log('\n🎬 YouTube Comment Auto-Replier v2\n');
  console.log('='.repeat(50));
  
  // Load input
  console.log('\n📂 Loading input files...');
  const videos = loadVideos();
  const { partA, partB } = loadReplyTemplates();
  const replied = loadReplied();
  
  console.log(`   Videos: ${videos.length}`);
  console.log(`   Part A: ${partA || '(using varied replies)'}`);
  console.log(`   Part B: ${partB}`);
  
  // Check daily limit
  const today = new Date().toISOString().split('T')[0];
  const dailyCount = replied[today] || 0;
  if (dailyCount >= CONFIG.dailyLimit) {
    console.log(`\n❌ Daily limit reached (${CONFIG.dailyLimit}). Try again tomorrow.\n`);
    process.exit(1);
  }
  console.log(`   Daily replies: ${dailyCount}/${CONFIG.dailyLimit}`);
  
  // Load tokens
  const tokensDir = path.join(__dirname, CONFIG.tokensDir);
  const tokenFiles = fs.readdirSync(tokensDir).filter(f => f.endsWith('.json'));
  if (tokenFiles.length === 0) {
    console.error('\n❌ No channel tokens found\n');
    process.exit(1);
  }
  
  const channelTokens = JSON.parse(fs.readFileSync(path.join(tokensDir, tokenFiles[0]), 'utf8'));
  const channelName = tokenFiles[0].replace('.json', '');
  console.log(`\n🔐 Using channel: ${channelName}`);
  
  const youtube = createYoutubeClient(channelTokens);
  
  // Process
  let totalComments = 0;
  let positiveComments = 0;
  let repliesSent = 0;
  const batchReplies = [];
  
  for (const video of videos) {
    if (!video.videoId) continue;
    console.log(`\n📹 Processing: ${video.videoUrl}`);
    
    try {
      const comments = await getVideoComments(youtube, video.videoId);
      console.log(`   Comments: ${comments.length}`);
      totalComments += comments.length;
      
      // Get already replied comments for this video
      const videoReplied = replied[video.videoId] || [];
      
      for (const comment of comments) {
        if (repliesSent >= CONFIG.maxRepliesPerRun) break;
        if (dailyCount + repliesSent >= CONFIG.dailyLimit) break;
        
        // Skip if already replied
        if (videoReplied.includes(comment.id)) {
          console.log(`   ⏭️  Skipped (already replied): ${comment.author}`);
          continue;
        }
        
        try {
          console.log(`\n   👤 ${comment.author}: ${comment.text.substring(0, 50)}...`);
          const sentiment = await detectEmotion(comment.text);
          console.log(`      Sentiment: ${sentiment}`);
          
          if (sentiment === 'POSITIVE') {
            positiveComments++;
            
            // Randomize Part A slightly
            let partAText = partA;
            if (!partAText && CONFIG.variedReplies.length > 0) {
              partAText = CONFIG.variedReplies[Math.floor(Math.random() * CONFIG.variedReplies.length)];
            }
            
            const reply = `${partAText}\n\n${partB}`;
            
            console.log(`      ➡️  Replying...`);
            const result = await replyToComment(youtube, comment.id, reply);
            repliesSent++;
            
            // Track this reply
            if (!replied[video.videoId]) replied[video.videoId] = [];
            replied[video.videoId].push(comment.id);
            
            batchReplies.push({
              videoId: video.videoId,
              commentId: comment.id,
              commentAuthor: comment.author,
              replyId: result.id
            });
            
            console.log(`      ✅ Reply sent!`);
            
            await new Promise(r => setTimeout(r, CONFIG.delayMs));
          }
        } catch (e) {
          console.log(`      ❌ Error: ${e.message}`);
        }
      }
    } catch (e) {
      console.log(`   ❌ Error: ${e.message}`);
    }
  }
  
  // Save tracking
  saveReplied(replied);
  saveBatch({ replies: batchReplies });
  
  console.log('\n' + '='.repeat(50));
  console.log('\n📊 SUMMARY');
  console.log(`   Total comments: ${totalComments}`);
  console.log(`   Positive: ${positiveComments}`);
  console.log(`   Replies sent: ${repliesSent}`);
  console.log(`\n✅ Done! Use --revert to undo last batch.\n`);
}

main().catch(console.error);
