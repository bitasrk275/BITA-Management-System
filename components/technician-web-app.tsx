"use client";

import { useState, useEffect, useCallback } from "react";

type TestMethod = "UT" | "MPT" | "DPT" | "RT" | "VT";

type EquipmentItem = {
  id: string;
  kind: string;
  model: string | null;
  serialNo: string | null;
  calibrationDue: string | null;
};

type InspectionStatus = {
  id: string;
  method: TestMethod;
  status: "draft" | "submitted" | "approved";
  isApproved?: boolean;
  missingFields: string[];
  observations: string | null;
  readings: Record<string, unknown>;
  submittedAt: string | null;
};

type SiteFileItem = {
  id: string;
  kind: string;
  caption: string | null;
  storagePath: string;
  fileName: string;
  uploadedAt: string;
};

type JobNoteItem = {
  id: string;
  kind: string;
  body: string;
  receivedAt: string;
};

type LeaveRequestItem = {
  id: string;
  startDate: string;
  endDate: string;
  reason: string | null;
  status: "pending" | "approved" | "rejected";
  reviewNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
};

type ApprovedLeaveDayItem = {
  id: string;
  leaveDate: string;
  reason: string | null;
};

type JobAssignment = {
  id: string;
  jobId: string;
  jobNo: string;
  customerName: string;
  site: string | null;
  scope: string | null;
  standard?: string | null;
  testMethods: TestMethod[];
  workDate: string;
  endDate?: string | null;
  notes: string | null;
  acknowledgedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  equipment: EquipmentItem[];
  inspection: InspectionStatus | null;
  attachments?: SiteFileItem[];
  jobNotes?: JobNoteItem[];
};

type FieldDefinition = {
  key: string;
  label: string;
  required: boolean;
  input: "text" | "date" | "number" | "textarea";
  fieldType?: "fixed" | "automatic" | "dropdown" | "pick_or_type" | "typed";
  listKey?: string;
  options?: readonly string[];
  readOnly?: boolean;
  fixed?: boolean;
};

type RepeatingGroupDefinition = {
  key: string;
  label: string;
  minimumRows: number;
  fields: readonly FieldDefinition[];
};

type ReportTemplate = {
  method: string;
  fields: FieldDefinition[];
  repeatingGroups: RepeatingGroupDefinition[];
  dropdownOptions?: Record<string, string[]>;
  rememberedDefaults?: Record<string, string>;
};

type StoredCreds = {
  deviceId: string;
  secret: string;
  technicianName: string;
};

const STORAGE_KEY = "bita_field_device_creds_v1";

export function TechnicianWebApp() {
  const [creds, setCreds] = useState<StoredCreds | null>(null);
  const [pairCode, setPairCode] = useState("");
  const [deviceName, setDeviceName] = useState("BITA Field Phone (Web/PWA)");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [jobs, setJobs] = useState<JobAssignment[]>([]);
  const [selectedJob, setSelectedJob] = useState<JobAssignment | null>(null);
  const [activeTab, setActiveTab] = useState<"jobs" | "calendar" | "leave" | "report" | "problem">("jobs");

  // File & note state per assignment
  const [fileCaptions, setFileCaptions] = useState<Record<string, string>>({});
  const [noteInputs, setNoteInputs] = useState<Record<string, string>>({});

  // Leave state
  const [leaveStartDate, setLeaveStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [leaveEndDate, setLeaveEndDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [leaveReason, setLeaveReason] = useState("");
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequestItem[]>([]);
  const [approvedLeaveDays, setApprovedLeaveDays] = useState<ApprovedLeaveDayItem[]>([]);

  // Report state
  const [selectedMethod, setSelectedMethod] = useState<TestMethod>("UT");
  const [template, setTemplate] = useState<ReportTemplate | null>(null);
  const [readings, setReadings] = useState<Record<string, unknown>>({});
  const [observations, setObservations] = useState("");

  // Problem report state
  const [problemKind, setProblemKind] = useState<"delay" | "leave" | "equipment_problem" | "site_issue" | "other">("delay");
  const [problemBody, setProblemBody] = useState("");

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as StoredCreds;
        if (parsed?.deviceId && parsed?.secret) {
          setCreds(parsed);
        }
      }
    } catch {
      // ignore storage errors
    }
  }, []);

  const authHeaders = useCallback(
    (c: StoredCreds | null = creds): Record<string, string> => {
      if (!c) return { "Content-Type": "application/json" };
      return {
        Authorization: `Bearer ${c.deviceId}.${c.secret}`,
        "Content-Type": "application/json",
      };
    },
    [creds],
  );

  const loadJobs = useCallback(
    async (currentCreds: StoredCreds | null = creds) => {
      if (!currentCreds) return;
      setBusy(true);
      setError(null);
      try {
        const res = await fetch("/api/field/jobs", {
          headers: authHeaders(currentCreds),
        });
        if (res.status === 401) {
          localStorage.removeItem(STORAGE_KEY);
          setCreds(null);
          setError("Device access was revoked or expired. Please pair again with a new 6-digit code.");
          return;
        }
        const json = await res.json().catch(() => []);
        if (!res.ok) {
          throw new Error(json.error || "Failed to load assigned jobs");
        }
        const list = Array.isArray(json) ? (json as JobAssignment[]) : [];
        setJobs(list);
        if (selectedJob) {
          const updated = list.find((j) => j.id === selectedJob.id) || null;
          setSelectedJob(updated);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load jobs");
      } finally {
        setBusy(false);
      }
    },
    [authHeaders, creds, selectedJob],
  );

  const loadLeave = useCallback(
    async (currentCreds: StoredCreds | null = creds) => {
      if (!currentCreds) return;
      try {
        const res = await fetch("/api/field/leave", {
          headers: authHeaders(currentCreds),
        });
        if (!res.ok) return;
        const json = await res.json().catch(() => ({}));
        setLeaveRequests(Array.isArray(json.requests) ? json.requests : []);
        setApprovedLeaveDays(Array.isArray(json.approvedDays) ? json.approvedDays : []);
      } catch {
        // ignore
      }
    },
    [authHeaders, creds],
  );

  useEffect(() => {
    if (creds) {
      void loadJobs(creds);
      void loadLeave(creds);
    }
  }, [creds, loadJobs, loadLeave]);

  async function handleUploadSiteFile(
    job: JobAssignment,
    file: File | null,
    defaultKind?: string,
  ) {
    if (!file || !creds) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const caption = (fileCaptions[job.id] || "").trim() || null;
      let uploadedDirectly = false;

      // Direct upload URL (bypasses Vercel 4.5 MB function payload limit)
      try {
        const urlRes = await fetch(`/api/field/assignments/${job.id}/upload-url`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${creds.deviceId}.${creds.secret}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            fileName: file.name,
            contentType: file.type || "application/octet-stream",
          }),
        });
        if (urlRes.ok) {
          const urlJson = await urlRes.json().catch(() => ({}));
          if (urlJson.ok && urlJson.signedUrl && urlJson.storagePath) {
            const putRes = await fetch(urlJson.signedUrl, {
              method: "PUT",
              headers: { "Content-Type": file.type || "application/octet-stream" },
              body: file,
            });
            if (putRes.ok) {
              const confirmRes = await fetch(`/api/field/assignments/${job.id}/upload-confirm`, {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${creds.deviceId}.${creds.secret}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  storagePath: urlJson.storagePath,
                  kind: defaultKind || "site_file",
                  caption,
                  contentType: file.type || "application/octet-stream",
                }),
              });
              if (confirmRes.ok) {
                uploadedDirectly = true;
              }
            }
          }
        }
      } catch {
        // Fall back to multipart
      }

      if (!uploadedDirectly) {
        const formData = new FormData();
        formData.append("file", file);
        if (caption) formData.append("caption", caption);
        if (defaultKind) formData.append("kind", defaultKind);

        const res = await fetch(`/api/field/assignments/${job.id}/files`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${creds.deviceId}.${creds.secret}`,
          },
          body: formData,
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || "Failed to upload file");
      }

      setFileCaptions((prev) => ({ ...prev, [job.id]: "" }));
      setNotice(`Uploaded ${file.name} to ${job.jobNo}.`);
      await loadJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload file");
    } finally {
      setBusy(false);
    }
  }

  async function handleAddJobNote(job: JobAssignment) {
    const body = (noteInputs[job.id] || "").trim();
    if (!body) {
      setError("Please type a note or comment first.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/field/assignments/${job.id}/notes`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ body }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Failed to save note");
      setNoteInputs((prev) => ({ ...prev, [job.id]: "" }));
      setNotice(`Saved note on ${job.jobNo}.`);
      await loadJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save note");
    } finally {
      setBusy(false);
    }
  }

  async function handleApplyLeave(e: React.FormEvent) {
    e.preventDefault();
    if (!leaveReason.trim()) {
      setError("Please enter a reason for your leave request.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/field/leave", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          startDate: leaveStartDate,
          endDate: leaveEndDate,
          reason: leaveReason.trim(),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Failed to submit leave request");
      setLeaveReason("");
      setNotice("Leave request sent to office. Once approved, it will show on the calendar automatically.");
      await loadLeave();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit leave request");
    } finally {
      setBusy(false);
    }
  }

  async function handlePair(e: React.FormEvent) {
    e.preventDefault();
    const cleaned = pairCode.trim();
    if (cleaned.length !== 6) {
      setError("Please enter the 6-digit pairing code from Registers → People → Link Phone.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/field/pair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: cleaned, deviceName }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.error || "Pairing failed");
      }
      const nextCreds: StoredCreds = {
        deviceId: json.deviceId,
        secret: json.secret,
        technicianName: json.technician?.name || "BITA Technician",
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(nextCreds));
      setCreds(nextCreds);
      setPairCode("");
      setNotice(`Phone paired as ${nextCreds.technicianName}`);
      await loadJobs(nextCreds);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pairing failed");
    } finally {
      setBusy(false);
    }
  }

  function handleUnlink() {
    localStorage.removeItem(STORAGE_KEY);
    setCreds(null);
    setJobs([]);
    setSelectedJob(null);
    setNotice("Phone unlinked from browser session.");
  }

  async function handleAcknowledge(job: JobAssignment) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/field/assignments/${job.id}/acknowledge`, {
        method: "POST",
        headers: authHeaders(),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Failed to acknowledge job");
      setNotice(`Job ${job.jobNo} acknowledged.`);
      await loadJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to acknowledge");
    } finally {
      setBusy(false);
    }
  }

  async function handleStartWork(job: JobAssignment) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/field/assignments/${job.id}/start`, {
        method: "POST",
        headers: authHeaders(),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Failed to start work");
      setNotice(`Started inspection work on ${job.jobNo}.`);
      await loadJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start work");
    } finally {
      setBusy(false);
    }
  }

  async function openReportEditor(job: JobAssignment) {
    setSelectedJob(job);
    const method: TestMethod =
      job.inspection?.method ||
      (job.testMethods.find((m) => ["UT", "MPT", "DPT"].includes(m)) as TestMethod) ||
      "UT";
    setSelectedMethod(method);
    setActiveTab("report");
    await loadTemplateForJob(job, method);
  }

  async function loadTemplateForJob(job: JobAssignment, method: TestMethod) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/field/report-template/${method}`, {
        headers: authHeaders(),
      });
      const tpl = (await res.json().catch(() => null)) as ReportTemplate | null;
      if (!res.ok || !tpl) {
        throw new Error("Could not load report template");
      }
      setTemplate(tpl);

      const existing = (job.inspection?.readings || {}) as Record<string, unknown>;
      const defaults = tpl.rememberedDefaults || {};
      const merged: Record<string, unknown> = {
        ...defaults,
        ...existing,
        client: (existing.client as string) || job.customerName || "",
        inspection_site: (existing.inspection_site as string) || job.site || "At Vendor's Works",
        inspection_date: (existing.inspection_date as string) || job.workDate || new Date().toISOString().slice(0, 10),
      };

      // Pre-fill equipment if assigned
      if (!merged.equipment && job.equipment.length > 0) {
        const eq = job.equipment[0];
        merged.equipment = [eq.model, eq.serialNo].filter(Boolean).join(" (S/N ") + (eq.serialNo ? ")" : "");
        if (eq.serialNo && !merged.machine_sl_no) {
          merged.machine_sl_no = eq.serialNo;
        }
      }

      // Ensure repeating groups exist
      for (const grp of tpl.repeatingGroups || []) {
        const currentRows = merged[grp.key];
        if (!Array.isArray(currentRows) || currentRows.length === 0) {
          if (grp.key === "technicians") {
            merged[grp.key] = [
              {
                name: creds?.technicianName || "",
                qualification: "ISNT Level II (UT)",
                certificate_no: "ISNT-UT-2026",
                issued_on: "2024-01-15",
                valid_until: "2029-01-14",
              },
            ];
          } else if (grp.key === "items") {
            merged[grp.key] = [
              {
                description: "Proof Machined Shaft Forging",
                identification_no: "SR-01",
                size: "Ø180 × 1250 mm",
                quantity: 1,
                qty_unit: "No.",
                observations:
                  "Forging scanned with normal probe all round and no significant indications observed.",
                result: "Accepted",
              },
            ];
          } else {
            merged[grp.key] = [];
          }
        }
      }

      setReadings(merged);
      setObservations(
        job.inspection?.observations ||
          "Forging scanned with normal probe all round and no significant indications observed.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load template");
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveReport(draft: boolean) {
    if (!selectedJob) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/field/assignments/${selectedJob.id}/report`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          method: selectedMethod,
          readings,
          observations,
          draft,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const missingMsg =
          Array.isArray(json.missingFields) && json.missingFields.length > 0
            ? ` (Missing: ${json.missingFields.join(", ")})`
            : "";
        throw new Error((json.error || "Failed to save report") + missingMsg);
      }
      setNotice(
        draft
          ? `Saved draft ${selectedMethod} report for ${selectedJob.jobNo}.`
          : `Submitted ${selectedMethod} report for ${selectedJob.jobNo} to office for technical review!`,
      );
      await loadJobs();
      if (!draft) {
        setActiveTab("jobs");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit report");
    } finally {
      setBusy(false);
    }
  }

  async function handleSendProblem(e: React.FormEvent) {
    e.preventDefault();
    if (!problemBody.trim()) {
      setError("Please describe the issue or update.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/field/messages", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          kind: problemKind,
          body: problemBody.trim(),
          jobId: selectedJob?.jobId,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Failed to send message");
      setProblemBody("");
      setNotice("Field message sent to BITA office.");
      setActiveTab("jobs");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send message");
    } finally {
      setBusy(false);
    }
  }

  function updateScalarField(key: string, value: string) {
    setReadings((prev) => ({ ...prev, [key]: value }));
  }

  function updateGroupRow(groupKey: string, rowIdx: number, fieldKey: string, value: string | number) {
    setReadings((prev) => {
      const rows = Array.isArray(prev[groupKey]) ? [...(prev[groupKey] as Record<string, unknown>[])] : [];
      rows[rowIdx] = { ...(rows[rowIdx] || {}), [fieldKey]: value };
      return { ...prev, [groupKey]: rows };
    });
  }

  function addGroupRow(groupKey: string) {
    setReadings((prev) => {
      const rows = Array.isArray(prev[groupKey]) ? [...(prev[groupKey] as Record<string, unknown>[])] : [];
      rows.push({});
      return { ...prev, [groupKey]: rows };
    });
  }

  function removeGroupRow(groupKey: string, rowIdx: number) {
    setReadings((prev) => {
      const rows = Array.isArray(prev[groupKey]) ? [...(prev[groupKey] as Record<string, unknown>[])] : [];
      rows.splice(rowIdx, 1);
      return { ...prev, [groupKey]: rows };
    });
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      {/* Header Banner */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-white p-4 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-ink text-sm font-semibold text-white">
            BITA
          </div>
          <div>
            <h1 className="text-[16px] font-semibold text-ink">BITA Field Technician App</h1>
            <p className="text-[12.5px] text-ink-3">
              {creds
                ? `Linked as ${creds.technicianName} · Device active`
                : "Not linked yet · Enter 6-digit office pairing code"}
            </p>
          </div>
        </div>
        {creds && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void loadJobs()}
              disabled={busy}
              className="rounded-lg border border-line bg-paper px-3 py-1.5 text-[12.5px] font-medium text-ink hover:bg-side"
            >
              {busy ? "Syncing…" : "Refresh Jobs"}
            </button>
            <button
              type="button"
              onClick={handleUnlink}
              className="rounded-lg border border-line px-3 py-1.5 text-[12.5px] text-ink-3 hover:text-bad"
            >
              Unlink Phone
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-bad/30 bg-bad-soft px-4 py-3 text-[13px] text-bad">
          {error}
        </div>
      )}
      {notice && (
        <div className="mb-4 rounded-xl border border-good/30 bg-good-soft px-4 py-3 text-[13px] text-good">
          {notice}
        </div>
      )}

      {/* Unpaired Screen */}
      {!creds ? (
        <div className="rounded-2xl border border-line bg-white p-6 shadow-sm">
          <h2 className="text-[15px] font-semibold text-ink">Step 1: Pair Technician Phone</h2>
          <p className="mt-1 text-[13px] text-ink-2">
            In the Office Dashboard, open <strong>Registers → People</strong>, click{" "}
            <strong>Link Phone</strong> next to a technician, and enter the 6-digit code below.
          </p>
          <form onSubmit={handlePair} className="mt-4 space-y-3">
            <div>
              <label className="mb-1 block text-[12px] font-medium text-ink-2">
                6-Digit Pairing Code
              </label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                placeholder="e.g. 482910"
                value={pairCode}
                onChange={(e) => setPairCode(e.target.value.replace(/\D/g, ""))}
                className="w-full rounded-xl border border-line bg-paper px-4 py-2.5 text-center font-mono text-[20px] tracking-[0.25em] text-ink focus:border-ink focus:outline-none"
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-[12px] font-medium text-ink-2">Device Label</label>
              <input
                type="text"
                value={deviceName}
                onChange={(e) => setDeviceName(e.target.value)}
                className="w-full rounded-xl border border-line bg-paper px-3.5 py-2 text-[13.5px] text-ink"
              />
            </div>
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-xl bg-ink py-2.5 text-[13.5px] font-medium text-white hover:bg-ink/90 disabled:opacity-50"
            >
              {busy ? "Pairing Phone…" : "Link Technician Phone"}
            </button>
          </form>
        </div>
      ) : (
        <>
          {/* Navigation Tabs */}
          <div className="mb-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setActiveTab("jobs")}
              className={`rounded-xl px-4 py-2 text-[13px] font-medium ${
                activeTab === "jobs"
                  ? "bg-ink text-white"
                  : "border border-line bg-white text-ink-2 hover:bg-side"
              }`}
            >
              1. My Jobs & Files ({jobs.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("calendar")}
              className={`rounded-xl px-4 py-2 text-[13px] font-medium ${
                activeTab === "calendar"
                  ? "bg-ink text-white"
                  : "border border-line bg-white text-ink-2 hover:bg-side"
              }`}
            >
              2. My Calendar
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("leave")}
              className={`rounded-xl px-4 py-2 text-[13px] font-medium ${
                activeTab === "leave"
                  ? "bg-ink text-white"
                  : "border border-line bg-white text-ink-2 hover:bg-side"
              }`}
            >
              3. Apply for Leave
            </button>
            {selectedJob && (
              <button
                type="button"
                onClick={() => setActiveTab("report")}
                className={`rounded-xl px-4 py-2 text-[13px] font-medium ${
                  activeTab === "report"
                    ? "bg-ink text-white"
                    : "border border-line bg-white text-ink-2 hover:bg-side"
                }`}
              >
                Report ({selectedJob.jobNo})
              </button>
            )}
            <button
              type="button"
              onClick={() => setActiveTab("problem")}
              className={`rounded-xl px-4 py-2 text-[13px] font-medium ${
                activeTab === "problem"
                  ? "bg-ink text-white"
                  : "border border-line bg-white text-ink-2 hover:bg-side"
              }`}
            >
              Delay / Issue
            </button>
          </div>

          {/* Tab 1: Assigned Jobs (Files first, Scope only, Notes, Report secondary) */}
          {activeTab === "jobs" && (
            <div className="space-y-4">
              {jobs.length === 0 ? (
                <div className="rounded-2xl border border-line bg-white p-8 text-center">
                  <div className="text-[14px] font-medium text-ink">No active job assignments yet</div>
                  <p className="mt-1 text-[12.5px] text-ink-3">
                    Assign a job to <strong>{creds.technicianName}</strong> in the Office Dashboard, then tap{" "}
                    <strong>Refresh Jobs</strong>.
                  </p>
                </div>
              ) : (
                jobs.map((job) => (
                  <div
                    key={job.id}
                    className="rounded-2xl border border-line bg-white p-5 shadow-sm space-y-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <span className="font-mono text-[12px] font-semibold text-ink-2">
                          {job.jobNo}
                        </span>
                        <h3 className="text-[15.5px] font-semibold text-ink">
                          {job.customerName}
                        </h3>
                        <p className="text-[12.5px] text-ink-3">
                          Site: {job.site || "At customer works"} · Date:{" "}
                          {job.endDate && job.endDate !== job.workDate
                            ? `${job.workDate} to ${job.endDate}`
                            : job.workDate}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {job.testMethods.map((m) => (
                          <span
                            key={m}
                            className="rounded-md bg-side px-2 py-0.5 font-mono text-[11px] font-medium text-ink"
                          >
                            {m}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* 1. FILES FOR THIS JOB (Priority #1) */}
                    <div className="rounded-xl border border-line bg-paper p-3.5 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[13px] font-semibold text-ink">
                          1. Upload photos & files for {job.jobNo}
                        </span>
                        <span className="text-[11.5px] text-ink-3">
                          {(job.attachments || []).length} uploaded
                        </span>
                      </div>
                      <input
                        type="text"
                        value={fileCaptions[job.id] || ""}
                        onChange={(e) =>
                          setFileCaptions((prev) => ({ ...prev, [job.id]: e.target.value }))
                        }
                        placeholder="Optional label / caption (e.g. Weld joint photo, Gate pass PDF)"
                        className="w-full rounded-lg border border-line bg-white px-3 py-1.5 text-[12.5px] text-ink"
                      />
                      <div className="flex flex-wrap gap-2">
                        <label className="cursor-pointer rounded-xl bg-ink px-3.5 py-2 text-[12.5px] font-medium text-white hover:bg-ink/90">
                          Take photo with camera
                          <input
                            type="file"
                            accept="image/*"
                            capture="environment"
                            className="hidden"
                            disabled={busy}
                            onChange={(e) => {
                              const f = e.target.files?.[0] || null;
                              void handleUploadSiteFile(job, f, "site_photo");
                              e.target.value = "";
                            }}
                          />
                        </label>
                        <label className="cursor-pointer rounded-xl border border-line bg-white px-3.5 py-2 text-[12.5px] font-medium text-ink hover:bg-side">
                          Upload file from phone (Photo / PDF / Doc)
                          <input
                            type="file"
                            accept="image/*,.pdf,.doc,.docx,*/*"
                            className="hidden"
                            disabled={busy}
                            onChange={(e) => {
                              const f = e.target.files?.[0] || null;
                              void handleUploadSiteFile(job, f);
                              e.target.value = "";
                            }}
                          />
                        </label>
                      </div>
                      {(job.attachments || []).length > 0 && (
                        <ul className="divide-y divide-line-2 pt-1 text-[12px]">
                          {(job.attachments || []).map((att) => (
                            <li key={att.id} className="flex items-center justify-between py-1">
                              <span className="truncate font-medium text-ink">
                                {att.caption || att.fileName.replace(/^\d+-/, "")}
                              </span>
                              <span className="shrink-0 text-[11px] text-ink-3">
                                {att.kind.replace("_", " ")} · {att.uploadedAt.slice(0, 10)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    {/* 2. SCOPE OF WORK ONLY (No quotation, no rates) */}
                    <div className="rounded-xl border border-line bg-paper px-3.5 py-2.5 text-[12.5px] space-y-1">
                      <div className="font-semibold text-ink">2. Scope of work</div>
                      <div>
                        <strong className="text-ink-2">What to test:</strong>{" "}
                        {job.scope || "NDT Inspection"}
                      </div>
                      <div>
                        <strong className="text-ink-2">Where (Site):</strong>{" "}
                        {job.site || "At customer works"}
                      </div>
                      <div>
                        <strong className="text-ink-2">Method & Standard:</strong>{" "}
                        {job.testMethods.join(", ")} · {job.standard || "ASME Sec V / IS Standard"}
                      </div>
                      {job.equipment.length > 0 && (
                        <div>
                          <strong className="text-ink-2">Assigned Equipment:</strong>{" "}
                          {job.equipment
                            .map((e) => `${e.model || e.kind} (${e.serialNo || "no S/N"})`)
                            .join(", ")}
                        </div>
                      )}
                    </div>

                    {/* 3. NOTES & COMMENTS FOR OFFICE */}
                    <div className="rounded-xl border border-line bg-paper p-3.5 space-y-2">
                      <div className="text-[13px] font-semibold text-ink">
                        3. Notes & comments for office
                      </div>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={noteInputs[job.id] || ""}
                          onChange={(e) =>
                            setNoteInputs((prev) => ({ ...prev, [job.id]: e.target.value }))
                          }
                          placeholder="Add a site note or comment for the office…"
                          className="flex-1 rounded-lg border border-line bg-white px-3 py-1.5 text-[12.5px] text-ink"
                        />
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void handleAddJobNote(job)}
                          className="rounded-lg bg-ink px-3 py-1.5 text-[12px] font-medium text-white hover:bg-ink/90"
                        >
                          Send note
                        </button>
                      </div>
                      {(job.jobNotes || []).length > 0 && (
                        <ul className="divide-y divide-line-2 pt-1 text-[12px]">
                          {(job.jobNotes || []).map((n) => (
                            <li key={n.id} className="py-1">
                              <span className="text-ink">{n.body}</span>
                              <span className="ml-2 text-[11px] text-ink-3">
                                {n.receivedAt.slice(0, 16).replace("T", " ")}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    {/* Status & Secondary Report Action buttons */}
                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
                      <div className="flex flex-wrap items-center gap-2 text-[11.5px]">
                        <span
                          className={`rounded-full px-2.5 py-0.5 font-medium ${
                            job.acknowledgedAt
                              ? "bg-good-soft text-good"
                              : "bg-warn-soft text-warn"
                          }`}
                        >
                          {job.acknowledgedAt ? "✓ Acknowledged" : "Pending Acknowledgement"}
                        </span>
                        {job.startedAt && (
                          <span className="rounded-full bg-info-soft px-2.5 py-0.5 font-medium text-info">
                            ✓ Work Started
                          </span>
                        )}
                        {job.inspection && (
                          <span className="rounded-full bg-side px-2.5 py-0.5 font-medium text-ink">
                            Report: {job.inspection.status.toUpperCase()}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {!job.acknowledgedAt && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void handleAcknowledge(job)}
                            className="rounded-xl border border-line bg-paper px-3 py-1.5 text-[12px] font-medium text-ink hover:bg-side"
                          >
                            Acknowledge Job
                          </button>
                        )}
                        {!job.startedAt && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void handleStartWork(job)}
                            className="rounded-xl border border-line bg-paper px-3 py-1.5 text-[12px] font-medium text-ink hover:bg-side"
                          >
                            Start Work
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void openReportEditor(job)}
                          className="rounded-xl border border-line bg-white px-3.5 py-1.5 text-[12px] font-medium text-ink hover:bg-side"
                        >
                          Fill {job.testMethods[0] || "UT"} Report (Secondary) →
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Tab 2: My Calendar */}
          {activeTab === "calendar" && (
            <div className="rounded-2xl border border-line bg-white p-5 shadow-sm space-y-3">
              <h2 className="text-[15px] font-semibold text-ink">
                My Calendar (Assigned Jobs & Approved Leave)
              </h2>
              {jobs.length === 0 && approvedLeaveDays.length === 0 ? (
                <p className="text-[13px] text-ink-3">
                  No upcoming assignments or leave days scheduled yet.
                </p>
              ) : (
                <div className="space-y-2.5">
                  {jobs.map((job) => (
                    <div
                      key={job.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-paper p-3"
                    >
                      <div>
                        <div className="font-mono text-[12px] font-semibold text-ink">
                          {job.endDate && job.endDate !== job.workDate
                            ? `${job.workDate} to ${job.endDate}`
                            : job.workDate}{" "}
                          · {job.jobNo}
                        </div>
                        <div className="text-[13.5px] font-medium text-ink">
                          {job.customerName}
                        </div>
                        <div className="text-[12px] text-ink-3">
                          {job.site || "At customer works"} · {job.scope || "NDT Inspection"}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setActiveTab("jobs")}
                        className="rounded-lg border border-line bg-white px-3 py-1.5 text-[12px] font-medium text-ink hover:bg-side"
                      >
                        Open Job
                      </button>
                    </div>
                  ))}
                  {approvedLeaveDays.map((ld) => (
                    <div
                      key={ld.id}
                      className="flex items-center justify-between rounded-xl border border-line bg-warn-soft/40 p-3 text-[12.5px]"
                    >
                      <span className="font-mono font-semibold text-ink">{ld.leaveDate}</span>
                      <span className="text-ink-2">On leave · {ld.reason || "Approved leave"}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Tab 3: Apply for Leave */}
          {activeTab === "leave" && (
            <div className="space-y-4">
              <form
                onSubmit={handleApplyLeave}
                className="rounded-2xl border border-line bg-white p-5 shadow-sm space-y-3"
              >
                <h2 className="text-[15px] font-semibold text-ink">Apply for Leave</h2>
                <p className="text-[12.5px] text-ink-3">
                  The office will approve or reject your request. Approved leave is added to the calendar automatically.
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-[12px] font-medium text-ink-2">
                      From Date
                    </label>
                    <input
                      type="date"
                      value={leaveStartDate}
                      onChange={(e) => setLeaveStartDate(e.target.value)}
                      className="w-full rounded-xl border border-line bg-paper px-3 py-2 text-[13px] text-ink"
                      required
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[12px] font-medium text-ink-2">
                      To Date
                    </label>
                    <input
                      type="date"
                      value={leaveEndDate}
                      onChange={(e) => setLeaveEndDate(e.target.value)}
                      className="w-full rounded-xl border border-line bg-paper px-3 py-2 text-[13px] text-ink"
                      required
                    />
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-[12px] font-medium text-ink-2">
                    Reason
                  </label>
                  <textarea
                    rows={2}
                    value={leaveReason}
                    onChange={(e) => setLeaveReason(e.target.value)}
                    placeholder="e.g. Personal work / medical appointment"
                    className="w-full rounded-xl border border-line bg-paper px-3 py-2 text-[13px] text-ink"
                    required
                  />
                </div>
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-xl bg-ink px-4 py-2 text-[13px] font-medium text-white hover:bg-ink/90"
                >
                  {busy ? "Submitting…" : "Submit Leave Request"}
                </button>
              </form>

              <div className="rounded-2xl border border-line bg-white p-5 shadow-sm space-y-2">
                <h3 className="text-[14px] font-semibold text-ink">
                  My Leave Requests ({leaveRequests.length})
                </h3>
                {leaveRequests.length === 0 ? (
                  <p className="text-[12.5px] text-ink-3">No leave requests submitted yet.</p>
                ) : (
                  <ul className="divide-y divide-line-2 text-[12.5px]">
                    {leaveRequests.map((lr) => (
                      <li key={lr.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                        <div>
                          <span className="font-mono font-semibold text-ink">
                            {lr.startDate === lr.endDate
                              ? lr.startDate
                              : `${lr.startDate} to ${lr.endDate}`}
                          </span>
                          {lr.reason && <span className="ml-2 text-ink-2">· {lr.reason}</span>}
                        </div>
                        <span className="rounded-full bg-side px-2.5 py-0.5 text-[11px] font-medium uppercase text-ink">
                          {lr.status}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          {/* Tab 2: 29-Field UT / MPT / DPT Report Form */}
          {activeTab === "report" && selectedJob && (
            <div className="rounded-2xl border border-line bg-white p-5 shadow-sm">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
                <div>
                  <h2 className="text-[15.5px] font-semibold text-ink">
                    {selectedMethod} Field Inspection Report · {selectedJob.jobNo}
                  </h2>
                  <p className="text-[12px] text-ink-3">
                    Customer: {selectedJob.customerName} · Pre-filled with BITA fixed & dropdown standards
                  </p>
                </div>
                <div className="flex gap-1.5">
                  {(["UT", "MPT", "DPT"] as TestMethod[]).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => {
                        setSelectedMethod(m);
                        void loadTemplateForJob(selectedJob, m);
                      }}
                      className={`rounded-lg px-2.5 py-1 text-[12px] font-medium ${
                        selectedMethod === m
                          ? "bg-ink text-white"
                          : "border border-line bg-paper text-ink-2"
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              {!template ? (
                <div className="py-8 text-center text-[13px] text-ink-3">
                  Loading {selectedMethod} report template…
                </div>
              ) : (
                <div className="space-y-5">
                  {/* Scalar Fields */}
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {template.fields.map((f) => {
                      const val = String(readings[f.key] ?? "");
                      const opts =
                        (f.listKey && template.dropdownOptions?.[f.listKey]) ||
                        f.options ||
                        [];
                      return (
                        <div
                          key={f.key}
                          className={f.input === "textarea" ? "sm:col-span-2" : ""}
                        >
                          <label className="mb-1 flex items-center justify-between text-[12px] font-medium text-ink-2">
                            <span>
                              {f.label} {f.required && <span className="text-bad">*</span>}
                            </span>
                            {f.fieldType && (
                              <span className="rounded bg-side px-1.5 py-0.5 text-[10px] uppercase text-ink-3">
                                {f.fieldType}
                              </span>
                            )}
                          </label>
                          {opts.length > 0 ? (
                            <div className="flex gap-1.5">
                              <select
                                value={opts.includes(val) ? val : ""}
                                onChange={(e) => {
                                  if (e.target.value) updateScalarField(f.key, e.target.value);
                                }}
                                className="w-1/2 rounded-xl border border-line bg-paper px-2.5 py-2 text-[12.5px] text-ink"
                              >
                                <option value="">Select preset…</option>
                                {opts.map((o) => (
                                  <option key={o} value={o}>
                                    {o}
                                  </option>
                                ))}
                              </select>
                              <input
                                type="text"
                                value={val}
                                readOnly={Boolean(f.readOnly)}
                                onChange={(e) => updateScalarField(f.key, e.target.value)}
                                placeholder="Or type value…"
                                className="w-1/2 rounded-xl border border-line bg-paper px-3 py-2 text-[12.5px] text-ink"
                              />
                            </div>
                          ) : f.input === "textarea" ? (
                            <textarea
                              rows={2}
                              value={val}
                              readOnly={Boolean(f.readOnly)}
                              onChange={(e) => updateScalarField(f.key, e.target.value)}
                              className="w-full rounded-xl border border-line bg-paper px-3 py-2 text-[12.5px] text-ink"
                            />
                          ) : (
                            <input
                              type={f.input === "date" ? "date" : f.input === "number" ? "number" : "text"}
                              value={val}
                              readOnly={Boolean(f.readOnly)}
                              onChange={(e) => updateScalarField(f.key, e.target.value)}
                              className={`w-full rounded-xl border border-line px-3 py-2 text-[12.5px] text-ink ${
                                f.readOnly ? "bg-side text-ink-3" : "bg-paper"
                              }`}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Repeating Groups (Technicians, Items, Defects) */}
                  {template.repeatingGroups.map((grp) => {
                    const rows = Array.isArray(readings[grp.key])
                      ? (readings[grp.key] as Record<string, unknown>[])
                      : [];
                    return (
                      <div key={grp.key} className="rounded-xl border border-line bg-paper p-3.5">
                        <div className="mb-2.5 flex items-center justify-between">
                          <h3 className="text-[13px] font-semibold text-ink">
                            {grp.label} ({rows.length})
                          </h3>
                          <button
                            type="button"
                            onClick={() => addGroupRow(grp.key)}
                            className="rounded-lg border border-line bg-white px-2.5 py-1 text-[11.5px] font-medium text-ink hover:bg-side"
                          >
                            + Add Row
                          </button>
                        </div>
                        <div className="space-y-3">
                          {rows.map((row, idx) => (
                            <div
                              key={idx}
                              className="rounded-lg border border-line bg-white p-3"
                            >
                              <div className="mb-2 flex items-center justify-between">
                                <span className="font-mono text-[11px] font-semibold text-ink-3">
                                  Row #{idx + 1}
                                </span>
                                {rows.length > grp.minimumRows && (
                                  <button
                                    type="button"
                                    onClick={() => removeGroupRow(grp.key, idx)}
                                    className="text-[11px] text-bad hover:underline"
                                  >
                                    Remove
                                  </button>
                                )}
                              </div>
                              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                                {grp.fields.map((gf) => {
                                  const rVal = String(row[gf.key] ?? "");
                                  const gOpts =
                                    (gf.listKey && template.dropdownOptions?.[gf.listKey]) ||
                                    gf.options ||
                                    [];
                                  return (
                                    <div
                                      key={gf.key}
                                      className={gf.input === "textarea" ? "sm:col-span-2" : ""}
                                    >
                                      <label className="mb-0.5 block text-[11.5px] font-medium text-ink-2">
                                        {gf.label} {gf.required && <span className="text-bad">*</span>}
                                      </label>
                                      {gOpts.length > 0 ? (
                                        <div className="flex gap-1.5">
                                          <select
                                            value={gOpts.includes(rVal) ? rVal : ""}
                                            onChange={(e) => {
                                              if (e.target.value)
                                                updateGroupRow(grp.key, idx, gf.key, e.target.value);
                                            }}
                                            className="w-1/2 rounded-lg border border-line bg-paper px-2 py-1.5 text-[12px] text-ink"
                                          >
                                            <option value="">Preset…</option>
                                            {gOpts.map((o) => (
                                              <option key={o} value={o}>
                                                {o}
                                              </option>
                                            ))}
                                          </select>
                                          <input
                                            type="text"
                                            value={rVal}
                                            onChange={(e) =>
                                              updateGroupRow(grp.key, idx, gf.key, e.target.value)
                                            }
                                            className="w-1/2 rounded-lg border border-line bg-paper px-2.5 py-1.5 text-[12px] text-ink"
                                          />
                                        </div>
                                      ) : (
                                        <input
                                          type={
                                            gf.input === "date"
                                              ? "date"
                                              : gf.input === "number"
                                                ? "number"
                                                : "text"
                                          }
                                          value={rVal}
                                          onChange={(e) =>
                                            updateGroupRow(
                                              grp.key,
                                              idx,
                                              gf.key,
                                              gf.input === "number"
                                                ? Number(e.target.value)
                                                : e.target.value,
                                            )
                                          }
                                          className="w-full rounded-lg border border-line bg-paper px-2.5 py-1.5 text-[12px] text-ink"
                                        />
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}

                  {/* Overall Observations */}
                  <div>
                    <label className="mb-1 block text-[12px] font-medium text-ink-2">
                      Overall Inspection Summary / Observations
                    </label>
                    <textarea
                      rows={2}
                      value={observations}
                      onChange={(e) => setObservations(e.target.value)}
                      className="w-full rounded-xl border border-line bg-paper px-3 py-2 text-[12.5px] text-ink"
                    />
                  </div>

                  {/* Save Draft / Submit Report Buttons */}
                  <div className="flex flex-wrap items-center justify-end gap-2.5 border-t border-line pt-4">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleSaveReport(true)}
                      className="rounded-xl border border-line bg-paper px-4 py-2.5 text-[13px] font-medium text-ink hover:bg-side"
                    >
                      Save Draft
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleSaveReport(false)}
                      className="rounded-xl bg-ink px-5 py-2.5 text-[13px] font-medium text-white hover:bg-ink/90"
                    >
                      {busy ? "Submitting…" : "Submit Final Report to Office"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Tab 3: Report Delay / Problem */}
          {activeTab === "problem" && (
            <form
              onSubmit={handleSendProblem}
              className="rounded-2xl border border-line bg-white p-5 shadow-sm space-y-3"
            >
              <h2 className="text-[15px] font-semibold text-ink">Report Field Delay or Issue</h2>
              <div>
                <label className="mb-1 block text-[12px] font-medium text-ink-2">Issue Type</label>
                <select
                  value={problemKind}
                  onChange={(e) => setProblemKind(e.target.value as typeof problemKind)}
                  className="w-full rounded-xl border border-line bg-paper px-3 py-2 text-[13px] text-ink"
                >
                  <option value="delay">Site / Travel Delay</option>
                  <option value="equipment_problem">Equipment / Probe Problem</option>
                  <option value="site_issue">Customer Site Not Ready</option>
                  <option value="leave">Leave Request</option>
                  <option value="other">Other Update</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[12px] font-medium text-ink-2">Message to Office</label>
                <textarea
                  rows={3}
                  value={problemBody}
                  onChange={(e) => setProblemBody(e.target.value)}
                  placeholder="Describe the site situation, delay duration, or equipment issue…"
                  className="w-full rounded-xl border border-line bg-paper px-3 py-2 text-[13px] text-ink"
                  required
                />
              </div>
              <button
                type="submit"
                disabled={busy}
                className="rounded-xl bg-ink px-4 py-2 text-[13px] font-medium text-white hover:bg-ink/90"
              >
                {busy ? "Sending…" : "Send Alert to Office"}
              </button>
            </form>
          )}
        </>
      )}
    </div>
  );
}
