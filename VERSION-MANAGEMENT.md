# Version Management

This project implements automatic version management and update notifications to ensure users always get the latest version of the web editor.

## How It Works

### 1. Cache Busting

All static assets (CSS, JS) are versioned using the git commit hash:

- `main.js?v=abc123`
- `style.css?v=abc123`
- `quill-bridge.js?v=abc123`

When you deploy a new version, the git hash changes, so all URLs change and browsers fetch fresh files.

### 2. Service Worker

A service worker (`service-worker.js`) provides:

- **Offline support** - Caches assets for offline use
- **Smart caching strategy**:
  - HTML: Network first (always checks for updates)
  - Versioned assets (`?v=`): Cache first (since URLs change with new versions)
  - Other assets: Network first with fallback to cache

### 3. Version Checker

The `VersionChecker` class:

- Checks for new versions every 5 minutes
- Compares current version hash with latest from server
- Shows a notification when an update is available
- Allows users to reload immediately or dismiss

### 4. Update Notification

When a new version is detected:

- A blue notification appears in the bottom-right corner
- User can click "Reload Now" to get the latest version
- User can click "Later" to dismiss and continue working
- **Editor content is automatically saved before reload and restored after**

## User Experience

### On Page Load

- Service worker registers and caches assets
- Version checker starts monitoring for updates
- User sees the current version in the footer
- **If reloading after an update, editor content is automatically restored**

### When New Version Deployed

1. Version checker detects the change (within 5 minutes)
2. Notification appears: "New Version Available"
3. User clicks "Reload Now"
4. **Editor content is saved to localStorage**
5. Page reloads with new version
6. **Editor content is automatically restored**
7. Service worker updates its cache

### Browser Refresh Behavior

- **Regular refresh (F5)**: Gets latest HTML, which loads new JS/CSS via changed URLs
- **Hard refresh (Ctrl+F5)**: Bypasses all caches
- **Service worker**: Ensures HTML is always fresh while caching versioned assets

## Development

### Version Source

Version comes from git commit hash via `_config.ts`:

```typescript
const gitInfo = getGitInfo();
site.data("git", gitInfo);
```

### Adding Cache Busting to New Assets

In layout files, append version to URLs:

```tsx
const version = git?.shortHash || Date.now().toString();
<script src={`my-script.js?v=${version}`}></script>;
```

### Testing Locally

1. Build: `deno task build`
2. Serve: Use a local server in `_site/`
3. Open DevTools → Application → Service Workers
4. Check console for version checker logs

### Disabling Service Worker

In `main.ts`, comment out the service worker registration:

```typescript
// if ("serviceWorker" in navigator) { ... }
```

## Benefits

✅ Users automatically get new versions  
✅ No manual cache clearing needed  
✅ Works offline after first visit  
✅ Version visible in footer for debugging  
✅ Smooth update experience  
✅ Works across all modern browsers

## Browser Compatibility

- Service Workers: Chrome 40+, Firefox 44+, Safari 11.1+, Edge 17+
- All modern browsers support cache-busting query parameters
