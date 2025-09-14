// Minimal IndexedDB wrapper for notes with attachments and user
// Note shape: { id, user, timestamp, dateKey, text, attachments:[{name,type,blob,size}] }

const DB_NAME = 'garden-notes';
const DB_VER = 1;
const STORE = 'notes';
const LS_KEY = 'garden-notes-fallback';
let USE_LS_FALLBACK = false;

function openDB() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      USE_LS_FALLBACK = true;
      reject(new Error('indexeddb-unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        store.createIndex('by_timestamp', 'timestamp');
        store.createIndex('by_dateKey', 'dateKey');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      USE_LS_FALLBACK = true;
      reject(req.error || new Error('indexeddb-open-failed'));
    };
  });
}

function lsRead() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || '[]');
  } catch { return []; }
}

function lsWrite(arr) {
  localStorage.setItem(LS_KEY, JSON.stringify(arr));
}

async function addNote({ user, text, files }) {
  let db;
  try {
    db = await openDB();
  } catch (e) {
    USE_LS_FALLBACK = true;
  }
  const now = new Date();
  const todayKey = Utils.toDateKey(now);
  // Enforce single note per user per day
  const existing = await getLatestNoteForToday(user);
  if (existing && existing.dateKey === todayKey) {
    throw new Error('note-exists-today');
  }
  const attachments = files ? await Promise.all(Array.from(files).map(async (file) => {
    // Store as Blob when using IDB; in fallback we skip to keep it simple
    if (!USE_LS_FALLBACK) {
      const blob = file.slice(0, file.size, file.type);
      return { name: file.name, type: file.type || 'application/octet-stream', size: file.size, blob };
    }
    return null;
  })) : [];

  const note = {
    user: user || null,
    timestamp: now.getTime(),
    dateKey: todayKey,
    text: (text || '').trim(),
    attachments: attachments.filter(Boolean)
  };

  if (USE_LS_FALLBACK || !db) {
    const arr = lsRead();
    note.id = Date.now();
    arr.push(note);
    lsWrite(arr);
    return note.id;
  }

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const req = store.add(note);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getAllNotes() {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const store = tx.objectStore(STORE);
      const req = store.getAll();
      req.onsuccess = () => {
        const arr = req.result || [];
        arr.sort((a, b) => b.timestamp - a.timestamp);
        resolve(arr);
      };
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    USE_LS_FALLBACK = true;
    const arr = lsRead();
    arr.sort((a, b) => b.timestamp - a.timestamp);
    return arr;
  }
}

async function getLatestNoteForToday(user) {
  const all = await getAllNotes();
  const todayKey = Utils.toDateKey(new Date());
  return all.find(n => n.dateKey === todayKey && n.user === user) || null;
}

async function getNotesExcludingToday() {
  const all = await getAllNotes();
  const todayKey = Utils.toDateKey(new Date());
  return all.filter(n => n.dateKey !== todayKey);
}

function clearAll() {
  // Clear fallback first
  try { localStorage.removeItem(LS_KEY); } catch (_){}
  return new Promise((resolve) => {
    if (!('indexedDB' in window)) return resolve(true);
    let done = false;
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => { if (!done) { done = true; resolve(true); } };
    req.onerror = () => { if (!done) { done = true; resolve(false); } };
    req.onblocked = () => { /* best effort */ };
  });
}

window.DB = { addNote, getAllNotes, getLatestNoteForToday, getNotesExcludingToday, clearAll };
