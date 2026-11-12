import { ErrorNote, PageHeader } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { checkAiEnv } from "@/lib/env";
import { NewEnquiryForm } from "./new-enquiry-form";

export const metadata = { title: "New enquiry – BITA" };

// Phone and WhatsApp enquiries are entered here by hand. Email enquiries can be pasted
// into the AI assist box (when ANTHROPIC_API_KEY is configured) to prefill the form.
export default async function NewEnquiryPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const { supabase } = await requireStaff();
  const { data: customers } = await supabase
    .from("customers")
    .select("id, name")
    .order("name");
  const aiEnabled = Boolean(checkAiEnv().apiKey);

  return (
    <>
      <PageHeader title="New enquiry" />
      <ErrorNote message={error} />
      <NewEnquiryForm customers={customers ?? []} aiEnabled={aiEnabled} />
    </>
  );
}
