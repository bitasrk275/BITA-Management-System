// Configurable server endpoint. Defaults to Android emulator host or production URL.
export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_URL || "https://bita-management-system.vercel.app";

export const STORAGE_KEYS = {
  DEVICE_ID: "bita_device_id",
  DEVICE_SECRET: "bita_device_secret",
  TECHNICIAN_NAME: "bita_technician_name",
  OFFLINE_JOBS_CACHE: "bita_offline_jobs",
  REPORT_DRAFTS: "bita_report_drafts",
};
