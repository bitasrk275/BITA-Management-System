"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import {
  isValidUuid,
  parseJobExpenseInput,
  parseUpdateLogBookEntryInput,
} from "@/lib/modules/log-book/schema";
import {
  createJobExpense,
  deleteJobExpense,
  updateLogBookEntry,
} from "@/lib/modules/log-book/service";

function fail(message: string): never {
  redirect(`/log-book?error=${encodeURIComponent(message)}`);
}

export async function addJobExpenseAction(formData: FormData) {
  const { supabase, user, person } = await requireStaff();
  if (!person) redirect("/login");

  const raw: Record<string, unknown> = {};
  formData.forEach((value, key) => {
    raw[key] = value;
  });

  try {
    const input = parseJobExpenseInput(raw);
    await createJobExpense(supabase, input, user?.id ?? null);
  } catch (err) {
    fail(err instanceof Error ? err.message : "Could not record expense.");
  }

  revalidatePath("/log-book");
  revalidatePath(`/jobs/${raw.job_id}`);
  redirect("/log-book?saved=expense");
}

export async function deleteJobExpenseAction(expenseId: string) {
  if (!isValidUuid(expenseId)) fail("Invalid expense record.");
  const { supabase, person } = await requireStaff();
  if (!person) redirect("/login");

  try {
    await deleteJobExpense(supabase, expenseId);
  } catch (err) {
    fail(err instanceof Error ? err.message : "Could not delete expense.");
  }

  revalidatePath("/log-book");
  redirect("/log-book?saved=deleted");
}

export async function updateLogBookEntryAction(entryId: string, formData: FormData) {
  if (!isValidUuid(entryId)) fail("Invalid log book entry.");
  const { supabase, person } = await requireStaff();
  if (!person) redirect("/login");

  const raw: Record<string, unknown> = {};
  formData.forEach((value, key) => {
    raw[key] = value;
  });

  try {
    const input = parseUpdateLogBookEntryInput(raw);
    await updateLogBookEntry(supabase, entryId, input);
  } catch (err) {
    fail(err instanceof Error ? err.message : "Could not update log book entry.");
  }

  revalidatePath("/log-book");
  redirect("/log-book?saved=entry");
}
