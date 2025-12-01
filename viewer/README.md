# KRNL Secure Document Viewer

A modern, standalone React + Vite application for securely viewing KRNL blockchain-verified documents.

## Features

- 🔒 **Secure document viewing** with blockchain verification
- 📄 **Multi-page PDF rendering** using PDF.js
- ⏱️ **Real-time SSE-based session updates** and token expiry countdown
- 🎨 **Dark/Light mode** slider toggle
- ⚡ **Fast** - Built with Vite for instant HMR
- 📱 **Responsive** - Works on desktop and mobile

## Tech Stack

- **React 18** - UI framework
- **TypeScript** - Type safety
- **Vite** - Build tool and dev server
- **Tailwind CSS** - Styling (Zinc + Indigo theme)
- **PDF.js** - PDF rendering
- **pdfjs-dist** - Official PDF.js distribution

## Development

### Prerequisites

- Node.js 18+ and npm

### Setup

```bash
# Install dependencies
npm install

# Start dev server
npm run dev
```

The app will be available at `http://localhost:5173`

### Environment Variables

Create a `.env` file:

```env
VITE_API_URL=http://localhost:3000
```

For production, point to your deployed backend:

```env
VITE_API_URL=https://poc.platform.lat/salesforce
```

## Building for Production

```bash
# Build
npm run build

# Preview production build
npm run preview
```

The built files will be in the `dist/` directory.

## Deployment

### Vercel

```bash
npx vercel
```

### Netlify

```bash
npx netlify deploy --prod
```

### Environment Variables for Production

Set in your deployment platform:

- `VITE_API_URL` - Your backend API URL (e.g., `https://poc.platform.lat/salesforce`)

## Usage

The viewer expects a `sessionId` query parameter:

```
https://your-viewer-url.com?sessionId=access_1234567890_abc123
```

### Flow

1. User clicks "View" in Salesforce
2. Apex creates a session and returns a viewer URL with `sessionId`
3. Viewer connects to the backend via **SSE** to receive real-time workflow status
4. When blockchain verification completes, viewer fetches a viewer token and then the document
5. PDF is rendered with all pages in a KRNL-themed frame

## Architecture

```
┌─────────────────┐
│  Salesforce LWC │ 
└────────┬────────┘
         │ Opens viewer URL with sessionId
         ▼
┌─────────────────┐
│  Vite Viewer    │ ◄── Deployed on Vercel/Netlify
│  (This app)     │
└────────┬────────┘
         │ API calls
         ▼
┌─────────────────┐
│  Express Backend│ ◄── Your KRNL backend
│  (Caddy/ngrok)  │
└─────────────────┘
```

## API Integration

The viewer interacts with three backend endpoints:

1. `GET /api/access/stream/:sessionId` - **SSE** endpoint for real-time workflow status (`connected`, `progress`, `complete`, `error`).
2. `POST /api/access/token` - Get viewer token after `COMPLETED_WITH_EVENT`.
3. `GET /api/view?token=...` - Fetch the watermarked PDF document.

The progress bar is driven first by SSE workflow steps (~0–90%), then by the document loading
pipeline (token fetch, PDF fetch, PDF.js render) which fills the remaining 10–20%. All
progress updates are monotonic (never decrease).

### Security Features

- Disables browser context menu and most keyboard shortcuts in the viewer surface.
- Shows a **Protected Content** overlay (screenshot shield) when:
  - The tab loses focus or becomes hidden.
  - Common screenshot/print/save shortcuts are pressed (e.g. `Cmd+Shift+3/4/5`, `PrintScreen`, `Cmd/Ctrl+P`, `Cmd/Ctrl+S`).
- Overlay includes a **Click to Resume** button that restores access.

### Session-aware Expiry Timer

- Uses `expiresAt` from `/api/access/token` and also persists the earliest known expiry per `sessionId` in `localStorage`.
- On reload, the countdown uses the minimum of backend and stored expiry so refreshes cannot extend the viewing window.

## License

Proprietary - KRNL Labs
