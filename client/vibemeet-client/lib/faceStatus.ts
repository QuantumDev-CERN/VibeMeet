
import { getFaceStatus } from './api';

const keyFor = (userId: string) => `vibemeet_face_on_file_${userId}`;

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function hasFaceOnFile(userId: string): boolean {
  return storage()?.getItem(keyFor(userId)) === '1';
}

export function markFaceOnFile(userId: string): void {
  storage()?.setItem(keyFor(userId), '1');
}

export function clearFaceOnFile(userId: string): void {
  storage()?.removeItem(keyFor(userId));
}

export async function fetchFaceOnFile(token: string, userId: string): Promise<boolean> {
  const { registered } = await getFaceStatus(token);
  if (registered) markFaceOnFile(userId);
  else clearFaceOnFile(userId);
  return registered;
}
