import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import { getDatabase, type Database } from "firebase/database";
import { getFirestore, type Firestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

/**
 * Lazy-initialized singletons.
 * Firebase SDK requires browser APIs and runtime env vars, so we
 * initialize on first access (which only happens client-side in
 * "use client" components) rather than at module-evaluation time.
 */
let _app: FirebaseApp | null = null;
let _db: Database | null = null;
let _firestore: Firestore | null = null;

function getAppInstance(): FirebaseApp {
  if (!_app) {
    _app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  }
  return _app;
}

/** Firebase Realtime Database — used for ephemeral live stroke sync */
export function getDb(): Database {
  if (!_db) {
    _db = getDatabase(getAppInstance());
  }
  return _db;
}

/** Cloud Firestore — used for persistent sketch snapshot storage */
export function getFirestoreDb(): Firestore {
  if (!_firestore) {
    _firestore = getFirestore(getAppInstance());
  }
  return _firestore;
}

export default getAppInstance;
