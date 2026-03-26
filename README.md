# 🎬 YouTube Comment Auto-Replier

Automates replies to YouTube comments with emotion detection.

## Setup

### 1. Configure Environment Variables

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

Get OAuth credentials from [Google Cloud Console](https://console.cloud.google.com/apis/credentials):
- Create OAuth 2.0 Client ID (Desktop app)
- Add `YOUTUBE_CLIENT_ID` and `YOUTUBE_CLIENT_SECRET` to `.env`

### 2. Install Dependencies

```bash
npm install
```

### 3. Authorize Channels

```bash
node youtube-oauth-flow.js
```

Each channel gets its own token in `tokens/ChannelName.json`.

### 4. Configure Input

| File | Description |
|------|-------------|
| `videos.txt` | Videos to process (format: `ChannelName \| URL`) |
| `part-a.txt` | Custom reply text (beginning) |
| `part-b.txt` | Video link to promote (end of reply) |

### 5. Run

```bash
node youtube-comment-auto.js
```

Or use the GUI:

```bash
npm start
# or
node server.js
# then open http://127.0.0.1:3000
```

## Workflow

1. Fetch comments from videos in `videos.txt`
2. Analyze sentiment using Ollama (local)
3. Reply only to POSITIVE comments
4. Reply format: `[Part A text] + [Part B link]`

## Adding More Channels

```bash
node youtube-oauth-flow.js
```

This will save a new token to `tokens/<ChannelName>.json`. The script automatically uses all available tokens.

## Security

- **Never commit `.env` or `tokens/` to version control**
- OAuth credentials are loaded from environment variables
- Each channel's token is stored locally

## Notes

- Each channel needs to authorize once (OAuth)
- Emotion detection uses Ollama (local model)
- 1-second delay between replies (API rate limits)
