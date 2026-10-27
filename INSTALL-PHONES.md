# Installing Woodlands on phones

The phone app is the field client; the farm's data lives on one server that
every phone syncs with (that is how the owner sees the caretaker's work from
anywhere). So there are two steps: run the server once, then install the app
on each phone. The app keeps working with no signal for days and syncs when
it can.

## 1. Run the server

**Free option:** [DEPLOY-FREE-CLOUD.md](DEPLOY-FREE-CLOUD.md) walks through a
free Google Cloud or Oracle Cloud server. One command installs everything,
HTTPS included:

```bash
curl -fsSL https://raw.githubusercontent.com/MFD-14/Farm-Manager/main/scripts/install-server.sh | sudo bash
```

The same command works on any Ubuntu or Debian VPS. To do it by hand on any
small Linux machine (a cloud VPS, or a mini PC at the farmhouse):

```bash
git clone https://github.com/MFD-14/Farm-Manager.git
cd Farm-Manager
cp .env.example .env      # fill in DB_PASSWORD, JWT_SECRET, OWNER_PASSWORD, CARETAKER_PASSWORD
docker compose up -d
```

The app is now at `http://<machine-address>:4000`. It serves the API, the
installable web app, and the address the phone apps point at.

**Phones away from the farm network need HTTPS.** The simplest route is
[Caddy](https://caddyserver.com/) in front of port 4000, which fetches a
certificate automatically for a domain pointed at the machine:

```
farm.example.com {
    reverse_proxy localhost:4000
}
```

The starter accounts are `owner@woodlands.farm` and `caretaker@woodlands.farm`,
with the passwords you set in `.env`. After signing in, the owner can switch to
their own email under **My account** (person icon) and add or manage everyone
else under **People**.

## 2. Install on Android

**Native app (recommended).** On the phone, open:

> https://github.com/MFD-14/Farm-Manager/releases/download/android-latest/woodlands.apk

Tap the downloaded file and allow installs from your browser when Android asks.
Open it and sign in: the farm's server address is built into the app
(`VITE_SERVER_URL` in `frontend/.env.production`), so nobody is asked for it.
If the server ever moves, change that line and the next build picks it up.

A new APK is built automatically every time the app changes. Installing it goes
over the previous version and keeps any unsynced records.

**Or as a web app:** open the server address in Chrome, then menu ⋮ → *Install
app* (or *Add to Home screen*).

## 3. Install on iPhone

Open the server address in **Safari**, tap the Share button, then *Add to Home
Screen*. Woodlands then opens full-screen from its own icon, works offline, and
can use the camera for evidence photos.

A native iPhone app (App Store or TestFlight) needs an Apple Developer account
($99 a year) and a Mac with Xcode to sign it. The iOS project is ready in
`frontend/ios`: on a Mac, run `cd frontend && npm install && npm run ios:open`,
pick your team under *Signing & Capabilities*, and archive. Until then the
home-screen app is the way to run it on iPhone.

## Building the Android app yourself

Needs Node 22, Java 21 and the Android SDK (Android Studio installs it).

```bash
cd frontend
npm install
npm run android:apk
# → frontend/android/app/build/outputs/apk/debug/app-debug.apk
```

## Signing

Builds are signed with `frontend/android/app/sideload.keystore`, a fixed key
committed to the repository so every downloaded APK installs as an update. Because
the repository is public, anyone could sign an APK with this key. Before handing
the app to anyone outside the farm, create your own key and add it as repository
secrets (`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`,
`ANDROID_KEY_PASSWORD`). The build then signs with it automatically. Phones need
one uninstall and reinstall when switching keys, so sync first.
