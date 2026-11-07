import { API_BASE_URL } from "./config";
import {
  getStoredCredentials,
  clearCredentials,
  getCachedJobs,
  setCachedJobs,
} from "./storage";
import type { JobAssignment, ProblemKind, ReportTemplate, TestMethod } from "./types";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function authHeaders(): Promise<Record<string, string>> {
  const creds = await getStoredCredentials();
  if (!creds) {
    throw new ApiError("Device not linked", 401);
  }
  return {
    Authorization: `Bearer ${creds.deviceId}.${creds.secret}`,
    "Content-Type": "application/json",
  };
}

export async function pairDevice(params: {
  code: string;
  deviceName?: string;
  pushToken?: string;
}): Promise<{ deviceId: string; secret: string; technician: { name: string } }> {
  const res = await fetch(`${API_BASE_URL}/api/field/pair`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(json.error || "Pairing failed", res.status);
  }
  return json;
}

export async function updatePushToken(pushToken: string): Promise<void> {
  const headers = await authHeaders();
  await fetch(`${API_BASE_URL}/api/field/push-token`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ pushToken }),
  });
}

export async function fetchJobs(): Promise<JobAssignment[]> {
  try {
    const headers = await authHeaders();
    const res = await fetch(`${API_BASE_URL}/api/field/jobs`, {
      method: "GET",
      headers,
    });

    if (res.status === 401) {
      await clearCredentials();
      throw new ApiError("Device access was revoked by office", 401);
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new ApiError(err.error || "Failed to load jobs", res.status);
    }

    const jobs: JobAssignment[] = await res.json();
    await setCachedJobs(jobs);
    return jobs;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) throw error;
    // Fall back to offline cache
    const cached = await getCachedJobs();
    if (cached.length > 0) return cached;
    throw error;
  }
}

export async function acknowledgeJob(assignmentId: string): Promise<{ acknowledgedAt: string }> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE_URL}/api/field/assignments/${assignmentId}/acknowledge`, {
    method: "POST",
    headers,
  });

  if (res.status === 401) {
    await clearCredentials();
    throw new ApiError("Device revoked", 401);
  }

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(json.error || "Failed to acknowledge assignment", res.status);
  }
  return json;
}

export async function startWork(assignmentId: string): Promise<{ startedAt: string }> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE_URL}/api/field/assignments/${assignmentId}/start`, {
    method: "POST",
    headers,
  });

  if (res.status === 401) {
    await clearCredentials();
    throw new ApiError("Device revoked", 401);
  }

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(json.error || "Failed to record start of work", res.status);
  }
  return json;
}

export async function fetchReportTemplate(method: TestMethod): Promise<ReportTemplate> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE_URL}/api/field/report-template/${method}`, {
    method: "GET",
    headers,
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(json.error || "Failed to load report template", res.status);
  }
  return json;
}

export async function submitReport(
  assignmentId: string,
  params: {
    method: TestMethod;
    readings: Record<string, unknown>;
    observations?: string;
    draft: boolean;
  },
): Promise<{ ok: boolean; draft: boolean; missingFields: string[]; submittedAt?: string }> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE_URL}/api/field/assignments/${assignmentId}/report`, {
    method: "POST",
    headers,
    body: JSON.stringify(params),
  });

  if (res.status === 401) {
    await clearCredentials();
    throw new ApiError("Device revoked", 401);
  }

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(json.error || "Failed to submit report", res.status);
  }
  return json;
}

export async function uploadPhoto(
  assignmentId: string,
  params: {
    uri: string;
    name: string;
    type: string;
    caption?: string;
    kind?: "site_photo" | "defect_photo" | "drawing";
  },
): Promise<{ ok: boolean; attachmentId: string; storagePath: string }> {
  const creds = await getStoredCredentials();
  if (!creds) throw new ApiError("Device not linked", 401);

  const formData = new FormData();
  formData.append("file", {
    uri: params.uri,
    name: params.name,
    type: params.type || "image/jpeg",
  } as unknown as Blob);

  if (params.caption) formData.append("caption", params.caption);
  if (params.kind) formData.append("kind", params.kind);

  const res = await fetch(`${API_BASE_URL}/api/field/assignments/${assignmentId}/photos`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${creds.deviceId}.${creds.secret}`,
    },
    body: formData,
  });

  if (res.status === 401) {
    await clearCredentials();
    throw new ApiError("Device revoked", 401);
  }

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(json.error || "Photo upload failed", res.status);
  }
  return json;
}

export async function reportProblem(params: {
  kind: ProblemKind;
  body: string;
  jobId?: string;
}): Promise<{ ok: boolean; messageId: string }> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE_URL}/api/field/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify(params),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(json.error || "Failed to submit message", res.status);
  }
  return json;
}
