"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { friendlyError } from "@/lib/forms";
import { parseContactInput, parseCustomerInput } from "@/lib/modules/customers/schema";
import {
  addCustomerContact,
  createCustomerRecord,
  deleteCustomerContact,
  deleteCustomerRecord,
  restoreCustomerRecord,
  updateCustomerContact,
  updateCustomerRecord,
} from "@/lib/modules/customers/service";

export async function createCustomer(fd: FormData) {
  const { supabase } = await requireStaff();
  const parsed = parseCustomerInput(fd);
  if (!parsed.ok) {
    redirect("/customers/new?error=" + encodeURIComponent(parsed.error));
  }
  const { data, error } = await createCustomerRecord(supabase, parsed.value);
  if (error || !data) {
    redirect("/customers/new?error=" + encodeURIComponent(friendlyError(error ?? "Could not create customer.")));
  }
  revalidatePath("/customers");
  redirect(`/customers/${data.id}`);
}

export async function updateCustomer(id: string, fd: FormData) {
  const { supabase } = await requireStaff();
  const parsed = parseCustomerInput(fd);
  if (!parsed.ok) {
    redirect(`/customers/${id}?error=` + encodeURIComponent(parsed.error));
  }
  const { error } = await updateCustomerRecord(supabase, id, parsed.value);
  if (error) {
    redirect(`/customers/${id}?error=` + encodeURIComponent(friendlyError(error)));
  }
  revalidatePath("/customers");
  revalidatePath(`/customers/${id}`);
  redirect(`/customers/${id}?saved=1`);
}

export async function deleteCustomer(id: string) {
  const { supabase } = await requireStaff();
  const res = await deleteCustomerRecord(supabase, id);
  if (!res.ok) {
    redirect(`/customers/${id}?error=` + encodeURIComponent(friendlyError(res.error)));
  }
  revalidatePath("/customers");
  revalidatePath("/recycle-bin");
  redirect("/customers?deleted=1");
}

export async function restoreCustomer(id: string) {
  const { supabase } = await requireStaff();
  const res = await restoreCustomerRecord(supabase, id);
  if (!res.ok) {
    redirect("/recycle-bin?error=" + encodeURIComponent(friendlyError(res.error)));
  }
  revalidatePath("/customers");
  revalidatePath("/recycle-bin");
  redirect(`/customers/${id}?saved=1`);
}

export async function addContact(customerId: string, fd: FormData) {
  const { supabase } = await requireStaff();
  const parsed = parseContactInput(fd);
  if (!parsed.ok) {
    redirect(`/customers/${customerId}?error=` + encodeURIComponent(parsed.error));
  }
  const { error } = await addCustomerContact(supabase, customerId, parsed.value);
  if (error) {
    redirect(`/customers/${customerId}?error=` + encodeURIComponent(friendlyError(error)));
  }
  revalidatePath(`/customers/${customerId}`);
}

export async function updateContact(customerId: string, contactId: string, fd: FormData) {
  const { supabase } = await requireStaff();
  const parsed = parseContactInput(fd);
  if (!parsed.ok) {
    redirect(`/customers/${customerId}?error=` + encodeURIComponent(parsed.error));
  }
  const { error } = await updateCustomerContact(supabase, contactId, parsed.value);
  if (error) {
    redirect(`/customers/${customerId}?error=` + encodeURIComponent(friendlyError(error)));
  }
  revalidatePath(`/customers/${customerId}`);
}

export async function deleteContact(customerId: string, contactId: string) {
  const { supabase } = await requireStaff();
  const res = await deleteCustomerContact(supabase, contactId);
  if (!res.ok) {
    redirect(`/customers/${customerId}?error=` + encodeURIComponent(friendlyError(res.error)));
  }
  revalidatePath(`/customers/${customerId}`);
}
