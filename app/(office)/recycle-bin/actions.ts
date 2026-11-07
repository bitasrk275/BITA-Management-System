"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { friendlyError } from "@/lib/forms";
import {
  isSoftDeleteTable,
  restoreRecord,
} from "@/lib/modules/recycle-bin/service";

export async function restoreRecycleBinItem(table: string, id: string) {
  const { supabase } = await requireStaff();

  if (!isSoftDeleteTable(table)) {
    redirect("/recycle-bin?error=" + encodeURIComponent(`Unsupported table: ${table}`));
  }

  const res = await restoreRecord(supabase, table, id);
  if (!res.ok) {
    redirect("/recycle-bin?error=" + encodeURIComponent(friendlyError(res.error)));
  }

  revalidatePath("/recycle-bin");
  revalidatePath("/customers");
  revalidatePath("/enquiries");
  revalidatePath("/quotations");
  revalidatePath("/jobs");
  revalidatePath("/registers");
  revalidatePath("/settings/users");
  redirect("/recycle-bin?restored=1");
}
