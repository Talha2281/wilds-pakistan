import { getApps, initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  User,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

export const GOOGLE_SHEETS_SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

const SHEET_META_KEY = 'wild_pakistan_feedback_sheet_v1';

export interface SavedFeedbackSheetMeta {
  spreadsheetId: string;
  spreadsheetUrl: string;
  sheetTitle: string;
  spreadsheetName: string;
}

const app = getApps().length > 0 ? getApps()[0] : initializeApp(firebaseConfig);
const auth = getAuth(app);

const provider = new GoogleAuthProvider();
for (const scope of GOOGLE_SHEETS_SCOPES) {
  provider.addScope(scope);
}

// Keep the OAuth access token strictly in memory (never in localStorage or sessionStorage).
let cachedAccessToken: string | null = null;
let isSigningIn = false;

export interface GoogleSessionState {
  user: User | null;
  hasToken: boolean;
}

export function subscribeGoogleAuth(
  onUpdate: (state: GoogleSessionState) => void,
): () => void {
  return onAuthStateChanged(auth, (user) => {
    if (!user) {
      cachedAccessToken = null;
      onUpdate({ user: null, hasToken: false });
      return;
    }
    if (cachedAccessToken) {
      onUpdate({ user, hasToken: true });
    } else if (!isSigningIn) {
      cachedAccessToken = null;
      onUpdate({ user, hasToken: false });
    }
  });
}

export async function signInWithGoogleSheets(): Promise<{
  user: User;
  accessToken: string;
}> {
  isSigningIn = true;
  try {
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Google Sheets permission token was not returned by sign-in.');
    }
    cachedAccessToken = credential.accessToken;
    return { user: result.user, accessToken: cachedAccessToken };
  } finally {
    isSigningIn = false;
  }
}

export function getGoogleAccessToken(): string | null {
  return cachedAccessToken;
}

export function getCurrentGoogleUser(): User | null {
  return auth.currentUser;
}

export async function signOutGoogle(): Promise<void> {
  cachedAccessToken = null;
  await signOut(auth);
}

export function parseSpreadsheetId(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  const urlMatch = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (urlMatch) return urlMatch[1];
  return trimmed.replace(/[^a-zA-Z0-9-_]/g, '');
}

export function loadSavedFeedbackSheet(): SavedFeedbackSheetMeta | null {
  try {
    const envId =
      typeof import.meta !== 'undefined' && import.meta.env
        ? String(import.meta.env.VITE_FEEDBACK_SHEET_ID || '').trim()
        : '';
    const raw = localStorage.getItem(SHEET_META_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SavedFeedbackSheetMeta>;
      if (parsed.spreadsheetId) {
        return {
          spreadsheetId: parsed.spreadsheetId,
          spreadsheetUrl:
            parsed.spreadsheetUrl ||
            `https://docs.google.com/spreadsheets/d/${parsed.spreadsheetId}/edit`,
          sheetTitle: parsed.sheetTitle || '',
          spreadsheetName: parsed.spreadsheetName || 'Wild Pakistan – Player Feedback',
        };
      }
    }
    if (envId) {
      return {
        spreadsheetId: envId,
        spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${envId}/edit`,
        sheetTitle: '',
        spreadsheetName: 'Configured Feedback Sheet',
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function saveFeedbackSheetMeta(meta: SavedFeedbackSheetMeta | null): void {
  try {
    if (!meta) {
      localStorage.removeItem(SHEET_META_KEY);
    } else {
      localStorage.setItem(SHEET_META_KEY, JSON.stringify(meta));
    }
  } catch {
    // ignore storage errors
  }
}

const FEEDBACK_HEADERS = [
  'Timestamp (UTC)',
  'Player / Ranger',
  'Account Email',
  'Rating (1-5)',
  'Category',
  'Mode',
  'Animal',
  'Biome',
  'Round',
  'Score',
  'Outcome',
  'Comment',
];

async function fetchSpreadsheetMetadata(
  spreadsheetId: string,
  accessToken: string,
): Promise<{ title: string; firstSheetTitle: string }> {
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId,
    )}?fields=properties.title,sheets.properties.title`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Could not read Google Sheet metadata (${res.status}): ${text.slice(0, 140)}`);
  }
  const json = (await res.json()) as {
    properties?: { title?: string };
    sheets?: Array<{ properties?: { title?: string } }>;
  };
  const firstSheetTitle = json.sheets?.[0]?.properties?.title;
  if (!firstSheetTitle) {
    throw new Error('Target Google Sheet has no worksheet tabs.');
  }
  return {
    title: json.properties?.title || 'Player Feedback',
    firstSheetTitle,
  };
}

export async function createFeedbackSpreadsheet(
  accessToken: string,
): Promise<SavedFeedbackSheetMeta> {
  const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      properties: { title: 'Wild Pakistan – Player Feedback' },
      sheets: [{ properties: { title: 'Player Feedback' } }],
    }),
  });
  if (!createRes.ok) {
    const err = await createRes.text().catch(() => '');
    throw new Error(`Failed to create Google Sheet (${createRes.status}): ${err.slice(0, 160)}`);
  }
  const created = (await createRes.json()) as {
    spreadsheetId: string;
    spreadsheetUrl?: string;
    properties?: { title?: string };
    sheets?: Array<{ properties?: { title?: string } }>;
  };
  const spreadsheetId = created.spreadsheetId;
  const sheetTitle = created.sheets?.[0]?.properties?.title || 'Player Feedback';
  const spreadsheetName = created.properties?.title || 'Wild Pakistan – Player Feedback';
  const spreadsheetUrl =
    created.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;

  // Initialize header row
  await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId,
    )}/values/${encodeURIComponent(`${sheetTitle}!A1:L1`)}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values: [FEEDBACK_HEADERS] }),
    },
  );

  const meta: SavedFeedbackSheetMeta = {
    spreadsheetId,
    spreadsheetUrl,
    sheetTitle,
    spreadsheetName,
  };
  saveFeedbackSheetMeta(meta);
  return meta;
}

export async function connectExistingFeedbackSheet(
  idOrUrl: string,
  accessToken: string,
): Promise<SavedFeedbackSheetMeta> {
  const spreadsheetId = parseSpreadsheetId(idOrUrl);
  if (!spreadsheetId) {
    throw new Error('Please paste a valid Google Spreadsheet link or ID.');
  }
  const metaInfo = await fetchSpreadsheetMetadata(spreadsheetId, accessToken);
  const meta: SavedFeedbackSheetMeta = {
    spreadsheetId,
    spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
    sheetTitle: metaInfo.firstSheetTitle,
    spreadsheetName: metaInfo.title,
  };
  saveFeedbackSheetMeta(meta);
  return meta;
}

export interface FeedbackSheetRow {
  createdAtIso: string;
  playerName: string;
  userEmail?: string;
  rating: number;
  category: string;
  mode: string;
  animalId: string;
  biomeId: string;
  round: number;
  score: number;
  victory: boolean;
  comment: string;
}

export async function appendFeedbackToGoogleSheet(
  row: FeedbackSheetRow,
  sheetMeta: SavedFeedbackSheetMeta,
  accessToken: string,
): Promise<{ spreadsheetUrl: string; sheetTitle: string }> {
  // Always discover real sheet tab name if missing rather than hardcoding "Sheet1"
  let targetTab = sheetMeta.sheetTitle;
  if (!targetTab) {
    const resolved = await fetchSpreadsheetMetadata(sheetMeta.spreadsheetId, accessToken);
    targetTab = resolved.firstSheetTitle;
    saveFeedbackSheetMeta({
      ...sheetMeta,
      sheetTitle: targetTab,
      spreadsheetName: resolved.title,
    });
  }

  const range = `${targetTab}!A1`;
  const values = [
    [
      row.createdAtIso,
      row.playerName,
      row.userEmail || 'Guest',
      row.rating,
      row.category,
      row.mode,
      row.animalId,
      row.biomeId,
      row.round,
      row.score,
      row.victory ? 'Victory' : 'Ended',
      row.comment,
    ],
  ];

  const appendRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      sheetMeta.spreadsheetId,
    )}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values }),
    },
  );

  if (!appendRes.ok) {
    const errText = await appendRes.text().catch(() => '');
    throw new Error(`Google Sheets append failed (${appendRes.status}): ${errText.slice(0, 140)}`);
  }

  return {
    spreadsheetUrl: sheetMeta.spreadsheetUrl,
    sheetTitle: targetTab,
  };
}
