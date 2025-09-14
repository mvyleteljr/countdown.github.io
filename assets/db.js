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
  // Enforce max two entries per user per day (original + one edit)
  try {
    const existingToday = await getTodayNotes(user);
    if (existingToday.length >= 2) {
      throw new Error('edit-limit-reached');
    }
  } catch (e) {
    if (e && e.message === 'edit-limit-reached') throw e;
    // If counting failed (e.g., IndexedDB open fail), continue best-effort
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

async function getTodayNotes(user) {
  const all = await getAllNotes();
  const todayKey = Utils.toDateKey(new Date());
  const arr = all.filter(n => n.dateKey === todayKey && n.user === user);
  // getAllNotes returns sorted desc by timestamp; keep that order
  return arr;
}

async function getNotesExcludingToday() {
  const all = await getAllNotes();
  const todayKey = Utils.toDateKey(new Date());
  return all.filter(n => n.dateKey !== todayKey);
}

async function clearTodayNotes() {
  const todayKey = Utils.toDateKey(new Date());
  // Try IndexedDB path first
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const idx = store.index('by_dateKey');
      const range = IDBKeyRange.only(todayKey);
      const req = idx.openCursor(range);
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          store.delete(cursor.primaryKey);
          cursor.continue();
        } else {
          resolve();
        }
      };
      req.onerror = () => reject(req.error);
    });
    return true;
  } catch (e) {
    // Fallback to localStorage array
    USE_LS_FALLBACK = true;
    const arr = lsRead();
    const filtered = arr.filter(n => n.dateKey !== todayKey);
    lsWrite(filtered);
    return true;
  }
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

window.DB = { addNote, getAllNotes, getLatestNoteForToday, getTodayNotes, getNotesExcludingToday, clearTodayNotes, clearAll };
