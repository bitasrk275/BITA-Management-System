"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { friendlyError } from "@/lib/forms";
import { parsePriceItemInput } from "@/lib/modules/price-items/schema";
import {
  createPriceItem,
  softDeletePriceItem,
  updatePriceItem,
} from "@/lib/modules/price-items/service";

export async function createPriceItemAction(fd: FormData) {
  const { supabase, person } = await requireStaff();
  if (!person?.roles.some((r) => r === "management" || r === "office")) {
    redirect("/price-list?error=" + encodeURIComponent("Only management or office staff can add price items."));
  }

  const parsed = parsePriceItemInput(fd);
  if (!parsed.ok) {
    redirect("/price-list?error=" + encodeURIComponent(parsed.error));
  }

  const { error } = await createPriceItem(supabase, parsed.value);
  if (error) {
    redirect("/price-list?error=" + encodeURIComponent(friendlyError(error)));
  }

  revalidatePath("/price-list");
  revalidatePath("/invoices");
  redirect("/price-list?saved=created");
}

export async function updatePriceItemAction(id: string, fd: FormData) {
  const { supabase, person } = await requireStaff();
  if (!person?.roles.some((r) => r === "management" || r === "office")) {
    redirect("/price-list?error=" + encodeURIComponent("Only management or office staff can edit price items."));
  }

  const parsed = parsePriceItemInput(fd);
  if (!parsed.ok) {
    redirect("/price-list?error=" + encodeURIComponent(parsed.error));
  }

  const { error } = await updatePriceItem(supabase, id, parsed.value);
  if (error) {
    redirect("/price-list?error=" + encodeURIComponent(friendlyError(error)));
  }

  revalidatePath("/price-list");
  revalidatePath("/invoices");
  redirect("/price-list?saved=updated");
}

export async function deletePriceItemAction(id: string) {
  const { supabase } = await requireStaff();
  const res = await softDeletePriceItem(supabase, id);
  if (!res.ok) {
    redirect("/price-list?error=" + encodeURIComponent(friendlyError(res.error)));
  }

  revalidatePath("/price-list");
  revalidatePath("/recycle-bin");
  revalidatePath("/invoices");
  redirect("/price-list?deleted=1");
}
