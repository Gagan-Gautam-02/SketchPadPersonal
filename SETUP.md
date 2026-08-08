# SketchSync — Setup Guide

Real-time cross-device digital sketchpad powered by Next.js, Firebase, and Tailwind CSS.

---

## 1. Create a Firebase Project

1. Go to the [Firebase Console](https://console.firebase.google.com/).
2. Click **Add Project** → name it (e.g. `sketchsync`) → create.
3. Disable Google Analytics if you want (not needed).

### Enable Realtime Database

1. In the Firebase Console sidebar, go to **Build → Realtime Database**.
2. Click **Create Database** → choose your region → select **Start in test mode**.
3. Once created, go to the **Rules** tab and paste:

```json
{
  "rules": {
    ".read": true,
    ".write": true
  }
}
```

> ⚠️ These are **test-mode rules** — anyone can read/write. For production, add authentication and restrict access.

### Enable Cloud Firestore

1. In the Firebase Console sidebar, go to **Build → Firestore Database**.
2. Click **Create database** → choose your region → select **Start in test mode**.
3. Once created, go to the **Rules** tab and paste:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /sketches/{sketchId} {
      allow read, write: if true;
    }
  }
}
```

> ⚠️ Same caveat — these are open test-mode rules. Lock them down for production.

---

## 2. Get Your Firebase Web App Config

1. In the Firebase Console, go to **Project Settings** (gear icon) → **General** tab.
2. Under "Your apps", click the **</>** (Web) icon to register a new web app.
3. Give it a nickname (e.g. `sketchsync-web`) and click **Register app**.
4. Copy the Firebase config object values.

---

## 3. Configure Environment Variables

1. Copy the example env file:

```bash
cp .env.local.example .env.local
```

2. Open `.env.local` and fill in your Firebase project values:

```env
NEXT_PUBLIC_FIREBASE_API_KEY=AIza...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=sketchsync-xxxxx.firebaseapp.com
NEXT_PUBLIC_FIREBASE_DATABASE_URL=https://sketchsync-xxxxx-default-rtdb.firebaseio.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=sketchsync-xxxxx
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=sketchsync-xxxxx.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=123456789012
NEXT_PUBLIC_FIREBASE_APP_ID=1:123456789012:web:abcdef123456
```

---

## 4. Install Dependencies

```bash
npm install
```

The following key packages are already in `package.json`:

- `next`, `react`, `react-dom` — App framework
- `firebase` — Firebase client SDK (RTDB + Firestore)
- `lucide-react` — Icon library
- `tailwindcss`, `@tailwindcss/postcss`, `postcss` — Styling

---

## 5. Run Locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

To test real-time sync, open a second browser tab (or use your phone on the same network) pointing at the same URL.

---

## 6. Deploy to Vercel

### Option A: Vercel CLI

```bash
# Install Vercel CLI globally (if not already)
npm install -g vercel

# Login
vercel login

# Deploy (preview)
vercel

# Set environment variables
vercel env add NEXT_PUBLIC_FIREBASE_API_KEY
vercel env add NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
vercel env add NEXT_PUBLIC_FIREBASE_DATABASE_URL
vercel env add NEXT_PUBLIC_FIREBASE_PROJECT_ID
vercel env add NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
vercel env add NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
vercel env add NEXT_PUBLIC_FIREBASE_APP_ID

# Deploy to production
vercel --prod
```

### Option B: Vercel Dashboard

1. Push your repo to GitHub.
2. Go to [vercel.com/new](https://vercel.com/new) → import your repository.
3. Add all `NEXT_PUBLIC_FIREBASE_*` environment variables in the project settings.
4. Deploy.

---

## Firebase Security Rules (Final Reference)

### Realtime Database Rules

```json
{
  "rules": {
    ".read": true,
    ".write": true
  }
}
```

### Firestore Security Rules

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /sketches/{sketchId} {
      allow read, write: if true;
    }
  }
}
```

---

## Project Structure

```
src/
├── app/
│   ├── lib/
│   │   └── firebase.ts          # Firebase SDK init
│   ├── globals.css              # Tailwind + custom theme
│   ├── layout.tsx               # Root layout
│   └── page.tsx                 # Root page
└── components/
    ├── Sketchpad.tsx            # Canvas + controls + RTDB sync
    └── SketchGallery.tsx        # Saved sketches gallery drawer
```
