# Wayline Sequence Timer

An installable, offline-first sequence timer made with plain HTML, CSS, and JavaScript. There is no build step and no external dependency.

## Run locally

A service worker requires HTTP rather than opening `index.html` directly:

```bash
python3 -m http.server 8080 --directory wayline
```

Then open `http://localhost:8080`. For another device on your local network, HTTPS is required for installation and service workers (localhost is the development exception).

## Deploy

Upload the contents of this folder to any static HTTPS host. Good zero-build options are GitHub Pages, Netlify Drop, Cloudflare Pages, or Firebase Hosting. Keep every file at the same relative path.

### GitHub Pages

1. Create a repository and put the contents of this folder at its root.
2. In **Settings → Pages**, choose **Deploy from a branch**, select `main` and `/ (root)`, then save.
3. Open the HTTPS Pages URL in Chrome on Android.
4. Use Chrome's **⋮ → Install app** (or **Add to Home screen**).

## Android timing limitation

Wayline uses an absolute wall-clock start timestamp, not a decrementing counter. If Android suspends or closes it, reopening computes the exact current block and time remaining. Paused state is stored as a fixed elapsed duration and reopens at the same point.

However, a standard PWA cannot guarantee that JavaScript runs—or that a sound is played—at an exact future time after the app is fully closed or Android kills its process. The browser experiment that would have scheduled local notifications at the OS level was discontinued. Wayline feature-detects that API if a browser provides it, but does not depend on it.

For the strongest web-only reliability:

- install the PWA;
- enable notifications and handoff chimes;
- keep the app open;
- optionally enable **Keep screen awake**;
- exempt Chrome/Wayline from aggressive battery optimization if your Android skin offers that setting.

If exact closed-app alarms are non-negotiable, this UI and timer core need a small native Android wrapper using AlarmManager. That cannot honestly be delivered as a no-build vanilla web app.

## Tests

Run the dependency-free parser/timing tests:

```bash
cd wayline
npm test
```

The automated suite covers separators, repeats, decimals, invalid input, exact block boundaries, completion clamping, and time formatting.
