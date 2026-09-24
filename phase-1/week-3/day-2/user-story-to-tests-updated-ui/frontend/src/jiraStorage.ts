import { JiraCredentials } from "./types";

const credentialsStorageKey = "jira-credentials-encrypted";
const keyDatabaseName = "user-story-to-tests-security";
const keyStoreName = "keys";
const keyRecordName = "jira-credentials";

type StoredCredentials = {
  iv: string;
  ciphertext: string;
};

function toBase64(value: ArrayBuffer | Uint8Array<ArrayBufferLike>): string {
  const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : value;
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function openKeyDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(keyDatabaseName, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(keyStoreName);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getEncryptionKey(): Promise<CryptoKey> {
  const database = await openKeyDatabase();
  const existingKey = await new Promise<CryptoKey | undefined>(
    (resolve, reject) => {
      const request = database
        .transaction(keyStoreName, "readonly")
        .objectStore(keyStoreName)
        .get(keyRecordName);
      request.onsuccess = () =>
        resolve(request.result as CryptoKey | undefined);
      request.onerror = () => reject(request.error);
    },
  );

  if (existingKey) return existingKey;

  const newKey = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );

  await new Promise<void>((resolve, reject) => {
    const request = database
      .transaction(keyStoreName, "readwrite")
      .objectStore(keyStoreName)
      .put(newKey, keyRecordName);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });

  return newKey;
}

export async function saveJiraCredentials(
  credentials: JiraCredentials,
): Promise<void> {
  const key = await getEncryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(credentials));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as unknown as BufferSource },
    key,
    plaintext,
  );
  const storedValue: StoredCredentials = {
    iv: toBase64(iv),
    ciphertext: toBase64(encrypted),
  };

  localStorage.setItem(credentialsStorageKey, JSON.stringify(storedValue));
}

export async function loadJiraCredentials(): Promise<JiraCredentials | null> {
  const storedValue = localStorage.getItem(credentialsStorageKey);
  if (!storedValue) return null;

  try {
    const storedCredentials = JSON.parse(storedValue) as StoredCredentials;
    const key = await getEncryptionKey();
    const decrypted = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: fromBase64(storedCredentials.iv) as unknown as BufferSource,
      },
      key,
      fromBase64(storedCredentials.ciphertext) as unknown as BufferSource,
    );
    return JSON.parse(new TextDecoder().decode(decrypted)) as JiraCredentials;
  } catch {
    localStorage.removeItem(credentialsStorageKey);
    return null;
  }
}

export function clearJiraCredentials(): void {
  localStorage.removeItem(credentialsStorageKey);
}
