# Hireoven mobile app (Capacitor wrapper)

This is the native App Store / Play Store packaging for Hireoven. It exists for
one reason: **instant push the second a sponsor-friendly role drops** (see the
sponsor-match push in `app/api/webhooks/supabase/route.ts`). Email wastes the
"apply first" edge; native push is the real expression of it, and the stores are
their own acquisition channel.

## Architecture: thin native shell over the live PWA

The app does **not** re-implement the product. Capacitor wraps a native WebView
that loads the already-deployed PWA (`capacitor.config.json` → `server.url`).
Everything the web app does — the service worker (`public/sw.js`), offline
shell, app badge, installability — comes along for free, and a web deploy ships
to mobile instantly with no app-store review cycle.

```
┌─────────────────────────────┐
│ iOS / Android native shell  │  Capacitor
│  ┌───────────────────────┐  │
│  │  WKWebView / WebView   │  │  loads https://hireoven.com
│  │   = the Hireoven PWA   │  │  (sw.js, web push on Android)
│  └───────────────────────┘  │
│  @capacitor/push-notifications ──► APNs / FCM (native push, iOS + Android)
└─────────────────────────────┘
```

## Push: why we need a native bridge

Today push is **Web Push (VAPID)** — `public/sw.js` `push` handler +
`lib/alerts/sender.ts#sendPushNotification` + the `push_subscriptions` table.

- **Android WebView** supports Web Push, so it works as-is inside the shell.
- **iOS WKWebView does _not_** deliver Web Push. For iOS parity we must register
  for **native** push via `@capacitor/push-notifications` (APNs on iOS, FCM on
  Android) and deliver through those services.

### The bridge (small, additive — does not replace web push)

1. **Client** (runs only inside Capacitor): on launch, request permission and
   register; POST the device token to a new `POST /api/push/native-register`
   with `{ token, platform: "ios" | "android" }`.

   ```ts
   import { PushNotifications } from "@capacitor/push-notifications"
   import { Capacitor } from "@capacitor/core"

   export async function registerNativePush() {
     if (!Capacitor.isNativePlatform()) return // web path already handled by sw.js
     const perm = await PushNotifications.requestPermissions()
     if (perm.receive !== "granted") return
     await PushNotifications.register()
     PushNotifications.addListener("registration", (t) =>
       fetch("/api/push/native-register", {
         method: "POST",
         headers: { "Content-Type": "application/json" },
         body: JSON.stringify({ token: t.value, platform: Capacitor.getPlatform() }),
       }),
     )
   }
   ```

2. **Server** — store native tokens alongside web subscriptions (extend
   `push_subscriptions` with a `kind` of `web | apns | fcm`, or a sibling
   `native_push_tokens` table). Extend `sendPushNotification(userId, job, type)`
   so that for native tokens it sends via APNs/FCM (e.g. `firebase-admin` for FCM,
   `@parse/node-apn` or APNs HTTP/2 for iOS) using the **same payload + the same
   sponsor-match copy** it already builds for web push. The webhook fan-out
   (`processNotifications`) and the `shouldSponsorPush` decision are unchanged —
   only the transport differs.

This keeps the entire match/decision pipeline (`lib/alerts/sponsor-match.ts`)
intact; mobile just adds two transports.

## One-time setup (run in a dev environment with the mobile toolchain)

> Requires macOS + Xcode for iOS, Android Studio + JDK for Android. These are
> generated/built locally or in mobile CI, not in the web repo's CI.

```bash
# 1. Install Capacitor (pin to the current major; v7 at time of writing)
npm install @capacitor/core@^7 @capacitor/push-notifications@^7
npm install -D @capacitor/cli@^7
npm install @capacitor/ios@^7 @capacitor/android@^7

# 2. Generate the native projects (creates ios/ and android/)
npx cap add ios
npx cap add android

# 3. Sync config + plugins into the native projects (re-run after config changes)
npx cap sync

# 4. Open in the native IDEs to set signing, icons, splash, capabilities
npx cap open ios       # Xcode: add Push Notifications + Background Modes capabilities
npx cap open android   # Android Studio: add google-services.json for FCM
```

The generated `ios/` and `android/` directories are large, tool-generated, and
should be committed from the mobile dev machine (add them to `.gitignore` here
until that happens, or keep them in a dedicated mobile repo).

## Store submission checklist

- **APNs**: create an APNs key in the Apple Developer account; configure it in
  Firebase (if using FCM for both) or call APNs directly.
- **FCM**: create a Firebase project, add `google-services.json` (Android) and
  the APNs key (iOS).
- iOS: enable **Push Notifications** + **Background Modes → Remote notifications**
  capabilities in Xcode.
- App icons / splash: `@capacitor/assets` from `public/icon-512.png`.
- Privacy: declare notification usage; the app loads `hireoven.com` only
  (`limitsNavigationsToAppBoundDomains` is set).
- Submit via App Store Connect / Google Play Console.

## Status

- ✅ `capacitor.config.json` — wrapper config (loads the live PWA, push plugin
  presentation options).
- ✅ This architecture + build doc.
- ⛏️ Remaining (needs the mobile toolchain): generate `ios/`/`android/`, add the
  `@capacitor/push-notifications` deps, the `/api/push/native-register` endpoint,
  and the APNs/FCM transport in `sendPushNotification`.
