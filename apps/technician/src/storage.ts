import * as SecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { STORAGE_KEYS } from "./config";
import type { JobAssignment } from "./types";

export type AuthCredentials = {
  deviceId: string;
  secret: string;
  technicianName: string;
};

export async function getStoredCredentials(): Promise<AuthCredentials | null> {
  try {
    const deviceId = await SecureStore.getItemAsync(STORAGE_KEYS.DEVICE_ID);
    const secret = await SecureStore.getItemAsync(STORAGE_KEYS.DEVICE_SECRET);
    const technicianName =
      (await SecureStore.getItemAsync(STORAGE_KEYS.TECHNICIAN_NAME)) || "Technician";

    if (deviceId && secret) {
      return { deviceId, secret, technicianName };
    }
    return null;
  } catch {
    return null;
  }
}

export async function saveCredentials(credentials: AuthCredentials): Promise<void> {
  await SecureStore.setItemAsync(STORAGE_KEYS.DEVICE_ID, credentials.deviceId);
  await SecureStore.setItemAsync(STORAGE_KEYS.DEVICE_SECRET, credentials.secret);
  await SecureStore.setItemAsync(STORAGE_KEYS.TECHNICIAN_NAME, credentials.technicianName);
}

export async function clearCredentials(): Promise<void> {
  await SecureStore.deleteItemAsync(STORAGE_KEYS.DEVICE_ID);
  await SecureStore.deleteItemAsync(STORAGE_KEYS.DEVICE_SECRET);
  await SecureStore.deleteItemAsync(STORAGE_KEYS.TECHNICIAN_NAME);
  await AsyncStorage.removeItem(STORAGE_KEYS.OFFLINE_JOBS_CACHE);
}

export async function getCachedJobs(): Promise<JobAssignment[]> {
  try {
    const data = await AsyncStorage.getItem(STORAGE_KEYS.OFFLINE_JOBS_CACHE);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

export async function setCachedJobs(jobs: JobAssignment[]): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEYS.OFFLINE_JOBS_CACHE, JSON.stringify(jobs));
  } catch {
    // Non-fatal
  }
}

export async function getDraftReport(assignmentId: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await AsyncStorage.getItem(`${STORAGE_KEYS.REPORT_DRAFTS}_${assignmentId}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function saveDraftReport(
  assignmentId: string,
  readings: Record<string, unknown>,
): Promise<void> {
  try {
    await AsyncStorage.setItem(
      `${STORAGE_KEYS.REPORT_DRAFTS}_${assignmentId}`,
      JSON.stringify(readings),
    );
  } catch {
    // Non-fatal
  }
}
