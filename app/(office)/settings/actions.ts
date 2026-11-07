"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { friendlyError, text } from "@/lib/forms";
import { parseSettingsOptionInput } from "@/lib/modules/settings/schema";
import {
  createSettingsOption,
  deleteSettingsOption,
  updateSettingsOption,
} from "@/lib/modules/settings/service";

export async function addDropdownOption(fd: FormData) {
  const { supabase } = await requireStaff();
  const parsed = parseSettingsOptionInput({
    list_key: text(fd, "list_key") ?? "",
    value: text(fd, "value") ?? "",
    position: text(fd, "position") ?? "0",
    active: true,
  });

  if (!parsed.ok) {
    redirect("/settings?error=" + encodeURIComponent(parsed.error));
  }

  const { error } = await createSettingsOption(supabase, parsed.value);
  if (error) {
    redirect("/settings?error=" + encodeURIComponent(friendlyError(error)));
  }

  revalidatePath("/settings");
  redirect("/settings?saved=1");
}

export async function toggleDropdownOption(id: string, nextActive: boolean) {
  const { supabase } = await requireStaff();
  const { error } = await updateSettingsOption(supabase, id, { active: nextActive });
  if (error) {
    redirect("/settings?error=" + encodeURIComponent(friendlyError(error)));
  }
  revalidatePath("/settings");
  redirect("/settings?saved=1");
}

export async function removeDropdownOption(id: string) {
  const { supabase } = await requireStaff();
  const res = await deleteSettingsOption(supabase, id);
  if (!res.ok) {
    redirect("/settings?error=" + encodeURIComponent(friendlyError(res.error)));
  }
  revalidatePath("/settings");
  redirect("/settings?saved=1");
}
