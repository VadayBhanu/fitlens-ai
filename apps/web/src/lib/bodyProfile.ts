import type { BodyProfile } from "@fitlens/shared";

/** The calibrated body profile is kept only in this browser (never uploaded). */
const KEY = "fitlens.bodyProfile.v1";

export function loadProfile(): BodyProfile | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as BodyProfile;
    return p && p.version === 1 && typeof p.chestRatio === "number" ? p : null;
  } catch {
    return null;
  }
}

export function saveProfile(p: BodyProfile): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable: the profile lasts for this session only */
  }
}

export function clearProfile(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
