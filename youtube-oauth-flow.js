const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const oauth2Client = new google.auth.OAuth2(
  process.env.YOUTUBE_CLIENT_ID,
  process.env.YOUTUBE_CLIENT_SECRET,
  process.env.YOUTUBE_REDIRECT_URI || 'http://localhost'
);

// Generate auth URL
const scopes = [
  'https://www.googleapis.com/auth/youtube.force-ssl',
  'https://www.googleapis.com/auth/youtube'
];

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: scopes,
  prompt: 'consent'
});

console.log('\n=== AUTHORIZATION REQUIRED ===\n');
console.log('1. Visit this URL:\n');
console.log(authUrl);
console.log('\n2. Sign in with the YouTube account you want to authorize');
console.log('3. Grant permission when asked');
console.log('4. You\'ll be redirected to a blank page');
console.log('5. Copy the URL from your browser address bar\n');
console.log('Paste the full redirect URL here:\n');

process.stdin.on('data', async (chunk) => {
  const code = chunk.toString().trim();
  
  try {
    const { tokens } = await oauth2Client.getToken(code);
    
    const tokenPath = path.join(__dirname, 'youtube-tokens.json');
    fs.writeFileSync(tokenPath, JSON.stringify(tokens, null, 2));
    
    console.log('\n✅ Success! Tokens saved to youtube-tokens.json');
    console.log('\nToken details:');
    console.log('  - Access token: ' + (tokens.access_token ? '✓ received' : '✗ missing'));
    console.log('  - Refresh token: ' + (tokens.refresh_token ? '✓ received' : '✗ missing (run again with prompt: consent)'));
    console.log('  - Expiry: ' + tokens.expiry_date);
    console.log('\nYou can now use these tokens to manage YouTube comments!');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ Error exchanging code for tokens:', err.message);
    process.exit(1);
  }
});
