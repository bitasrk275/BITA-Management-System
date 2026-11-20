import { API_BASE_URL } from "./config";
import {
  getStoredCredentials,
  clearCredentials,
  getCachedJobs,
  setCachedJobs,
} from "./storage";
import type {
  ApprovedLeaveDayItem,
  JobAssignment,
  JobNoteItem,
  LeaveRequestItem,
  ProblemKind,
  ReportTemplate,
  SiteFileItem,
  TestMethod,
} from "./types";

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

export async function uploadSiteFile(
  assignmentId: string,
  params: {
    uri: string;
    name: string;
    type: string;
    caption?: string;
    kind?: "site_photo" | "defect_photo" | "drawing" | "supporting_document" | "other" | "site_file";
  },
): Promise<{ ok: boolean; attachmentId: string; storagePath: string; kind: string; fileName: string }> {
  const creds = await getStoredCredentials();
  if (!creds) throw new ApiError("Device not linked", 401);

  // Attempt 1: Direct signed upload URL to Supabase Storage (up to 25 MB, bypasses Vercel 4.5 MB limit)
  try {
    const urlRes = await fetch(`${API_BASE_URL}/api/field/assignments/${assignmentId}/upload-url`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.deviceId}.${creds.secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        fileName: params.name,
        contentType: params.type || "application/octet-stream",
      }),
    });

    if (urlRes.status === 401) {
      await clearCredentials();
      throw new ApiError("Device revoked", 401);
    }

    if (urlRes.ok) {
      const urlJson = await urlRes.json().catch(() => ({}));
      if (urlJson.ok && urlJson.signedUrl && urlJson.storagePath) {
        // Fetch binary data from local uri
        const blobRes = await fetch(params.uri);
        const fileBlob = await blobRes.blob();

        const putRes = await fetch(urlJson.signedUrl, {
          method: "PUT",
          headers: {
            "Content-Type": params.type || "application/octet-stream",
          },
          body: fileBlob,
        });

        if (putRes.ok) {
          // Confirm upload metadata and insert attachment row
          const confirmRes = await fetch(
            `${API_BASE_URL}/api/field/assignments/${assignmentId}/upload-confirm`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${creds.deviceId}.${creds.secret}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                storagePath: urlJson.storagePath,
                kind: params.kind || "site_file",
                caption: params.caption || null,
                contentType: params.type || "application/octet-stream",
              }),
            },
          );

          if (confirmRes.ok) {
            const confirmJson = await confirmRes.json().catch(() => ({}));
            if (confirmJson.ok) {
              return confirmJson;
            }
          }
        }
      }
    }
  } catch (directErr) {
    if (directErr instanceof ApiError && directErr.status === 401) throw directErr;
    // Fall back cleanly to multipart upload route
  }

  // Attempt 2: Standard multipart FormData upload (for smaller files / fallback)
  const formData = new FormData();
  formData.append("file", {
    uri: params.uri,
    name: params.name,
    type: params.type || "application/octet-stream",
  } as unknown as Blob);

  if (params.caption) formData.append("caption", params.caption);
  if (params.kind) formData.append("kind", params.kind);

  const res = await fetch(`${API_BASE_URL}/api/field/assignments/${assignmentId}/files`, {
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
    throw new ApiError(json.error || "File upload failed", res.status);
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
  return uploadSiteFile(assignmentId, params);
}

export async function fetchAssignmentFiles(
  assignmentId: string,
): Promise<SiteFileItem[]> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE_URL}/api/field/assignments/${assignmentId}/files`, {
    method: "GET",
    headers,
  });

  if (res.status === 401) {
    await clearCredentials();
    throw new ApiError("Device revoked", 401);
  }

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(json.error || "Failed to load files", res.status);
  }
  return Array.isArray(json.files) ? json.files : [];
}

export async function fetchAssignmentNotes(
  assignmentId: string,
): Promise<JobNoteItem[]> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE_URL}/api/field/assignments/${assignmentId}/notes`, {
    method: "GET",
    headers,
  });

  if (res.status === 401) {
    await clearCredentials();
    throw new ApiError("Device revoked", 401);
  }

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(json.error || "Failed to load notes", res.status);
  }
  return Array.isArray(json.notes) ? json.notes : [];
}

export async function submitAssignmentNote(
  assignmentId: string,
  body: string,
): Promise<{ ok: boolean; noteId: string; receivedAt: string }> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE_URL}/api/field/assignments/${assignmentId}/notes`, {
    method: "POST",
    headers,
    body: JSON.stringify({ body }),
  });

  if (res.status === 401) {
    await clearCredentials();
    throw new ApiError("Device revoked", 401);
  }

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(json.error || "Failed to save note", res.status);
  }
  return json;
}

export async function fetchLeaveData(): Promise<{
  requests: LeaveRequestItem[];
  approvedDays: ApprovedLeaveDayItem[];
}> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE_URL}/api/field/leave`, {
    method: "GET",
    headers,
  });

  if (res.status === 401) {
    await clearCredentials();
    throw new ApiError("Device revoked", 401);
  }

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(json.error || "Failed to load leave requests", res.status);
  }
  return {
    requests: Array.isArray(json.requests) ? json.requests : [],
    approvedDays: Array.isArray(json.approvedDays) ? json.approvedDays : [],
  };
}

export async function submitLeaveRequest(params: {
  startDate: string;
  endDate: string;
  reason: string;
}): Promise<{ ok: boolean; request: LeaveRequestItem }> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE_URL}/api/field/leave`, {
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
    throw new ApiError(json.error || "Failed to submit leave request", res.status);
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
