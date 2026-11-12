"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import type { Enums } from "@/lib/db/types";
import { friendlyError, text } from "@/lib/forms";
import { parseEnquiryInput } from "@/lib/modules/enquiries/schema";
import {
  createEnquiryRecord,
  deleteEnquiryRecord,
  updateEnquiryRecord,
} from "@/lib/modules/enquiries/service";

export async function createEnquiry(fd: FormData) {
  const { supabase } = await requireStaff();
  const parsed = parseEnquiryInput(fd);
  if (!parsed.ok) {
    redirect("/enquiries/new?error=" + encodeURIComponent(parsed.error));
  }
  const { data, error } = await createEnquiryRecord(supabase, parsed.value);
  if (error || !data) {
    redirect(
      "/enquiries/new?error=" +
        encodeURIComponent(friendlyError(error ?? "Could not create enquiry.")),
    );
  }
  redirect(`/enquiries/${data.id}`);
}

export async function linkCustomer(enquiryId: string, fd: FormData) {
  const { supabase } = await requireStaff();
  const customerId = text(fd, "customer_id");
  const { error } = await updateEnquiryRecord(supabase, enquiryId, {
    customer_id: customerId,
    ...(customerId ? { status: "linked" as const } : {}),
  });
  if (error) {
    redirect(
      `/enquiries/${enquiryId}?error=` +
        encodeURIComponent(friendlyError(error)),
    );
  }
  revalidatePath(`/enquiries/${enquiryId}`);
}

export async function setStatus(enquiryId: string, fd: FormData) {
  const { supabase } = await requireStaff();
  const status = text(fd, "status") as Enums<"enquiry_status">;
  const { error } = await updateEnquiryRecord(supabase, enquiryId, { status });
  if (error) {
    redirect(
      `/enquiries/${enquiryId}?error=` +
        encodeURIComponent(friendlyError(error)),
    );
  }
  revalidatePath(`/enquiries/${enquiryId}`);
}

export async function deleteEnquiry(enquiryId: string) {
  const { supabase, person } = await requireStaff();
  const res = await deleteEnquiryRecord(supabase, enquiryId, person?.roles);
  if (!res.ok) {
    redirect(
      `/enquiries/${enquiryId}?error=` +
        encodeURIComponent(friendlyError(res.error)),
    );
  }
  revalidatePath("/enquiries");
  revalidatePath("/recycle-bin");
  redirect("/enquiries?deleted=1");
}

export const deleteEnquiryAction = deleteEnquiry;
