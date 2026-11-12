"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { createPairingCode } from "@/lib/field/pairing";
import { getSupabaseAdmin } from "@/lib/field/service";
import {
  isValidUuid,
  parseEmployeeInput,
  parseQualificationInput,
} from "@/lib/modules/employees/schema";
import {
  createEmployee,
  createEmployeeQualification,
  deleteEmployee,
  deleteEmployeeQualification,
  removeEmployeeSignature,
  updateEmployee,
  uploadEmployeeSignature,
} from "@/lib/modules/employees/service";

function fail(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

export async function createEmployeeAction(formData: FormData) {
  const { supabase, person } = await requireStaff();
  const isManagement = person?.roles.includes("management") ?? false;
  if (!isManagement) {
    fail("/employees", "Only management can add employees.");
  }

  const raw: Record<string, unknown> = {
    roles: formData.getAll("roles").map(String),
    active: formData.get("active") !== null,
  };
  formData.forEach((val, key) => {
    if (key !== "roles" && key !== "active") raw[key] = val;
  });

  let createdId = "";
  try {
    const input = parseEmployeeInput(raw, { includeCompensation: isManagement });
    const created = await createEmployee(supabase, input);
    createdId = created.id;
  } catch (err) {
    fail("/employees", err instanceof Error ? err.message : "Could not add employee.");
  }

  revalidatePath("/employees");
  revalidatePath("/registers");
  redirect(`/employees/${createdId}?saved=created`);
}

export async function updateEmployeeAction(employeeId: string, formData: FormData) {
  if (!isValidUuid(employeeId)) redirect("/employees");
  const { supabase, person } = await requireStaff();
  const isManagement = person?.roles.includes("management") ?? false;
  const path = `/employees/${employeeId}`;

  if (!isManagement) {
    fail(path, "Only management can update employee records and salaries.");
  }

  const raw: Record<string, unknown> = {
    roles: formData.getAll("roles").map(String),
    active: formData.get("active") !== null,
  };
  formData.forEach((val, key) => {
    if (key !== "roles" && key !== "active") raw[key] = val;
  });

  try {
    const input = parseEmployeeInput(raw, { includeCompensation: isManagement });
    if (employeeId === person?.id && (!input.active || !input.roles.includes("management"))) {
      fail(path, "You cannot deactivate yourself or remove your own management role.");
    }
    await updateEmployee(supabase, employeeId, input);
  } catch (err) {
    fail(path, err instanceof Error ? err.message : "Could not update employee.");
  }

  revalidatePath(path);
  revalidatePath("/employees");
  revalidatePath("/registers");
  redirect(`${path}?saved=updated`);
}

export async function deleteEmployeeAction(employeeId: string) {
  if (!isValidUuid(employeeId)) redirect("/employees");
  const { supabase, person } = await requireStaff();
  const isManagement = person?.roles.includes("management") ?? false;
  const path = `/employees/${employeeId}`;

  if (!isManagement) {
    fail(path, "Only management can move employees to the recycle bin.");
  }
  if (employeeId === person?.id) {
    fail(path, "You cannot delete your own account.");
  }

  try {
    await deleteEmployee(supabase, employeeId);
  } catch (err) {
    fail(path, err instanceof Error ? err.message : "Could not delete employee.");
  }

  revalidatePath("/employees");
  revalidatePath("/recycle-bin");
  redirect("/employees?deleted=1");
}

export async function addQualificationAction(employeeId: string, formData: FormData) {
  if (!isValidUuid(employeeId)) redirect("/employees");
  const { supabase, person } = await requireStaff();
  const isManagement = person?.roles.includes("management") ?? false;
  const path = `/employees/${employeeId}`;

  if (!isManagement) {
    fail(path, "Only management can add qualifications.");
  }

  let certificate_path: string | null = null;
  const certFile = formData.get("certificate_file");
  if (certFile && certFile instanceof File && certFile.size > 0) {
    const ext = certFile.name.split(".").pop() || "pdf";
    const storagePath = `qualifications/${employeeId}/${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}.${ext}`;
    const { error: uploadErr } = await supabase.storage
      .from("documents")
      .upload(storagePath, certFile, { contentType: certFile.type, upsert: false });
    if (!uploadErr) {
      certificate_path = storagePath;
    }
  }

  const raw: Record<string, unknown> = {
    person_id: employeeId,
  };
  formData.forEach((val, key) => {
    if (key !== "certificate_file") raw[key] = val;
  });
  if (certificate_path) raw.certificate_path = certificate_path;

  try {
    const input = parseQualificationInput(raw);
    await createEmployeeQualification(supabase, input);
  } catch (err) {
    fail(path, err instanceof Error ? err.message : "Could not add qualification.");
  }

  revalidatePath(path);
  revalidatePath("/employees");
  revalidatePath("/registers");
  redirect(`${path}?saved=qualification`);
}

export async function deleteQualificationAction(
  employeeId: string,
  qualificationId: string
) {
  if (!isValidUuid(employeeId) || !isValidUuid(qualificationId)) {
    redirect("/employees");
  }
  const { supabase, person } = await requireStaff();
  const isManagement = person?.roles.includes("management") ?? false;
  const path = `/employees/${employeeId}`;

  if (!isManagement) {
    fail(path, "Only management can delete qualifications.");
  }

  try {
    await deleteEmployeeQualification(supabase, qualificationId);
  } catch (err) {
    fail(path, err instanceof Error ? err.message : "Could not delete qualification.");
  }

  revalidatePath(path);
  revalidatePath("/employees");
  redirect(`${path}?saved=qual_deleted`);
}

export async function linkEmployeePhoneAction(employeeId: string) {
  if (!isValidUuid(employeeId)) redirect("/employees");
  const { person } = await requireStaff();
  const canLink =
    person?.roles.some((r) => r === "management" || r === "office") ?? false;
  const path = `/employees/${employeeId}`;

  if (!canLink || !person) {
    fail(path, "Only management or office staff can link technician phones.");
  }

  let code = "";
  let expiresAt = "";
  try {
    const result = await createPairingCode(getSupabaseAdmin(), {
      personId: employeeId,
      createdBy: person.id,
    });
    code = result.code;
    expiresAt = result.expiresAt;
  } catch (err) {
    fail(path, err instanceof Error ? err.message : "Could not generate pairing code.");
  }

  revalidatePath(path);
  redirect(
    `${path}?pairingCode=${encodeURIComponent(code)}&expiresAt=${encodeURIComponent(
      expiresAt
    )}`
  );
}

export async function revokeEmployeePhoneAction(
  employeeId: string,
  deviceId: string
) {
  if (!isValidUuid(employeeId) || !isValidUuid(deviceId)) redirect("/employees");
  const { supabase, person } = await requireStaff();
  const canRevoke =
    person?.roles.some((r) => r === "management" || r === "office") ?? false;
  const path = `/employees/${employeeId}`;

  if (!canRevoke) {
    fail(path, "Only management or office staff can unlink technician phones.");
  }

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("technician_devices")
    .update({ revoked_at: now })
    .eq("id", deviceId)
    .eq("person_id", employeeId);

  if (error) {
    fail(path, error.message);
  }

  revalidatePath(path);
  revalidatePath("/employees");
  redirect(`${path}?saved=device_revoked`);
}

export async function uploadEmployeeSignatureAction(
  employeeId: string,
  formData: FormData
) {
  if (!isValidUuid(employeeId)) redirect("/employees");
  const { supabase, person } = await requireStaff();
  const isManagement = person?.roles.includes("management") ?? false;
  const path = `/employees/${employeeId}`;

  if (!isManagement) {
    fail(path, "Only management can upload employee signatures.");
  }

  const file = formData.get("signature_file");
  if (!(file instanceof File) || file.size === 0) {
    fail(path, "Please select a signature image file (PNG or JPEG).");
  }

  if (file.size > 2 * 1024 * 1024) {
    fail(path, "Signature image must be under 2 MB.");
  }

  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    await uploadEmployeeSignature(supabase, employeeId, {
      name: file.name,
      type: file.type,
      bytes,
    });
  } catch (err) {
    fail(path, err instanceof Error ? err.message : "Failed to upload signature.");
  }

  revalidatePath(path);
  revalidatePath("/employees");
  redirect(`${path}?saved=signature_uploaded`);
}

export async function removeEmployeeSignatureAction(employeeId: string) {
  if (!isValidUuid(employeeId)) redirect("/employees");
  const { supabase, person } = await requireStaff();
  const isManagement = person?.roles.includes("management") ?? false;
  const path = `/employees/${employeeId}`;

  if (!isManagement) {
    fail(path, "Only management can remove employee signatures.");
  }

  try {
    await removeEmployeeSignature(supabase, employeeId);
  } catch (err) {
    fail(path, err instanceof Error ? err.message : "Failed to remove signature.");
  }

  revalidatePath(path);
  revalidatePath("/employees");
  redirect(`${path}?saved=signature_removed`);
}
