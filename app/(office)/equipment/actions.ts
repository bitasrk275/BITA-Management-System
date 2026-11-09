"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import {
  parseEquipmentItemInput,
  parseEquipmentMovementInput,
} from "@/lib/modules/equipment/schema";
import {
  createEquipment,
  createEquipmentType,
  deleteEquipment,
  deleteEquipmentType,
  recordEquipmentMovement,
  updateEquipment,
} from "@/lib/modules/equipment/service";
import { createClient } from "@/lib/supabase/server";

export async function createEquipmentAction(formData: FormData) {
  await requireStaff();
  const supabase = await createClient();

  let createdId: string;
  try {
    let certificate_path: string | null = null;
    const certFile = formData.get("certificate_file");
    if (certFile && certFile instanceof File && certFile.size > 0) {
      const ext = certFile.name.split(".").pop() || "pdf";
      const path = `equipment/certificates/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error: uploadErr } = await supabase.storage
        .from("documents")
        .upload(path, certFile, { contentType: certFile.type, upsert: false });

      if (!uploadErr) {
        certificate_path = path;
      }
    }

    const raw: Record<string, unknown> = {};
    formData.forEach((value, key) => {
      if (key !== "certificate_file") raw[key] = value;
    });
    if (certificate_path) {
      raw.certificate_path = certificate_path;
    }

    const input = parseEquipmentItemInput(raw);
    const created = await createEquipment(supabase, input);
    createdId = created.id;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to create equipment";
    redirect(`/equipment/new?error=${encodeURIComponent(msg)}`);
  }

  revalidatePath("/equipment");
  revalidatePath("/calendar");
  redirect(`/equipment/${createdId}?saved=true`);
}

export async function updateEquipmentAction(id: string, formData: FormData) {
  await requireStaff();
  const supabase = await createClient();

  try {
    let certificate_path: string | undefined = undefined;
    const certFile = formData.get("certificate_file");
    if (certFile && certFile instanceof File && certFile.size > 0) {
      const ext = certFile.name.split(".").pop() || "pdf";
      const path = `equipment/certificates/${id}-${Date.now()}.${ext}`;
      const { error: uploadErr } = await supabase.storage
        .from("documents")
        .upload(path, certFile, { contentType: certFile.type, upsert: false });

      if (!uploadErr) {
        certificate_path = path;
      }
    }

    const raw: Record<string, unknown> = {};
    formData.forEach((value, key) => {
      if (key !== "certificate_file") raw[key] = value;
    });
    if (certificate_path !== undefined) {
      raw.certificate_path = certificate_path;
    }

    const input = parseEquipmentItemInput(raw);
    await updateEquipment(supabase, id, input);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to update equipment";
    redirect(`/equipment/${id}?error=${encodeURIComponent(msg)}`);
  }

  revalidatePath(`/equipment/${id}`);
  revalidatePath("/equipment");
  revalidatePath("/calendar");
  redirect(`/equipment/${id}?saved=true`);
}

export async function deleteEquipmentAction(id: string) {
  await requireStaff();
  const supabase = await createClient();

  try {
    await deleteEquipment(supabase, id);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to delete equipment";
    redirect(`/equipment/${id}?error=${encodeURIComponent(msg)}`);
  }

  revalidatePath("/equipment");
  revalidatePath("/recycle-bin");
  revalidatePath("/calendar");
  redirect("/equipment?deleted=true");
}

export async function recordMovementAction(equipmentId: string, formData: FormData) {
  const { person } = await requireStaff();
  const supabase = await createClient();

  try {
    let delivery_challan_path: string | null = null;
    const challanFile = formData.get("challan_file");
    if (challanFile && challanFile instanceof File && challanFile.size > 0) {
      const ext = challanFile.name.split(".").pop() || "pdf";
      const path = `equipment/challans/${equipmentId}-${Date.now()}.${ext}`;
      const { error: uploadErr } = await supabase.storage
        .from("documents")
        .upload(path, challanFile, { contentType: challanFile.type, upsert: false });

      if (!uploadErr) {
        delivery_challan_path = path;
      }
    }

    const raw: Record<string, unknown> = {
      equipment_id: equipmentId,
      moved_by: person?.id ?? null,
    };
    formData.forEach((value, key) => {
      if (key !== "challan_file") raw[key] = value;
    });
    if (delivery_challan_path) {
      raw.delivery_challan_path = delivery_challan_path;
    }

    const input = parseEquipmentMovementInput(raw);
    await recordEquipmentMovement(supabase, input);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to record movement";
    redirect(`/equipment/${equipmentId}?error=${encodeURIComponent(msg)}`);
  }

  revalidatePath(`/equipment/${equipmentId}`);
  revalidatePath("/equipment");
  revalidatePath("/calendar");
  redirect(`/equipment/${equipmentId}?moved=true`);
}

export async function createEquipmentTypeAction(formData: FormData) {
  await requireStaff();
  const supabase = await createClient();

  const name = formData.get("name")?.toString().trim();
  const description = formData.get("description")?.toString().trim() || null;

  if (!name) {
    redirect(`/equipment/types?error=${encodeURIComponent("Equipment type name is required.")}`);
  }

  try {
    await createEquipmentType(supabase, { name, description });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to create equipment type";
    redirect(`/equipment/types?error=${encodeURIComponent(msg)}`);
  }

  revalidatePath("/equipment/types");
  revalidatePath("/equipment");
  revalidatePath("/settings");
  redirect("/equipment/types?saved=true");
}

export async function deleteEquipmentTypeAction(id: string) {
  await requireStaff();
  const supabase = await createClient();

  try {
    await deleteEquipmentType(supabase, id);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to delete equipment type";
    redirect(`/equipment/types?error=${encodeURIComponent(msg)}`);
  }

  revalidatePath("/equipment/types");
  revalidatePath("/equipment");
  revalidatePath("/recycle-bin");
  redirect("/equipment/types?deleted=true");
}
