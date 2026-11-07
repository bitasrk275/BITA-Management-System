import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  Button,
  Card,
  EmptyRow,
  ErrorNote,
  Field,
  Input,
  List,
  ListRow,
  PageHeader,
  SecondaryButton,
} from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import {
  createPhonePairingCode,
  revokeTechnicianDevice,
  saveRegister,
} from "../../actions";
import { calibrationStatus, isId, isRegister, TITLES } from "../../fields";
import { RegisterForm, type RegisterRecord } from "../../register-form";
import { StatusBadge } from "../../status-badge";

export default async function RegisterDetail({
  params,
  searchParams,
}: {
  params: Promise<{ register: string; id: string }>;
  searchParams: Promise<{
    error?: string;
    saved?: string;
    pairingCode?: string;
    expiresAt?: string;
  }>;
}) {
  const { register, id } = await params;
  if (!isRegister(register) || (id !== "new" && !isId(id))) notFound();
  const { error: formError, saved, pairingCode, expiresAt } = await searchParams;
  const { supabase, person } = await requireStaff();
  const canEdit = person?.roles.includes("management") ?? false;
  if (id === "new" && !canEdit) {
    redirect("/registers?error=Only%20management%20can%20add%20records.");
  }

  const { data: people, error: peopleError } = await supabase
    .from("people")
    .select("id, full_name, active")
    .order("full_name");

  let record: RegisterRecord | undefined;
  let loadError: string | undefined = peopleError?.message;
  let qualificationStatus: string | undefined;

  let linkedDevices: Array<{
    id: string;
    device_name: string | null;
    push_token: string | null;
    paired_at: string;
    last_seen_at: string | null;
    revoked_at: string | null;
  }> = [];

  if (id !== "new") {
    const { data, error } = await supabase
      .from(register)
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) loadError = error.message;
    else if (!data) notFound();
    else record = data;

    if (register === "qualifications") {
      const { data: status, error: statusError } = await supabase
        .from("qualification_status")
        .select("is_expired, valid_until")
        .eq("id", id)
        .maybeSingle();
      if (statusError) loadError = statusError.message;
      else if (status) {
        qualificationStatus = status.is_expired
          ? "Expired"
          : status.valid_until
            ? "In date"
            : "Expiry not recorded";
      }
    } else if (register === "people" && record && "roles" in record) {
      const isTech =
        Array.isArray(record.roles) && record.roles.includes("technician");
      if (isTech) {
        const { data: devices } = await supabase
          .from("technician_devices")
          .select("id, device_name, push_token, paired_at, last_seen_at, revoked_at")
          .eq("person_id", id)
          .order("paired_at", { ascending: false });
        if (devices) linkedDevices = devices;
      }
    }
  }

  const isTechnician =
    record && "roles" in record && Array.isArray(record.roles) && record.roles.includes("technician");

  return (
    <>
      <Link
        href={`/registers?tab=${register}`}
        className="mb-4 inline-block text-sm font-semibold text-ink"
      >
        ← {TITLES[register]} register
      </Link>
      <PageHeader
        title={
          id === "new"
            ? `Add ${register === "people" ? "person" : register === "qualifications" ? "qualification" : "equipment"}`
            : `${TITLES[register]} record`
        }
      />
      <ErrorNote message={formError ?? loadError} />
      {saved && (
        <p role="status" className="mb-4 rounded-md bg-ok/5 p-3 text-sm text-ok">
          Saved.
        </p>
      )}

      {pairingCode && (
        <div className="mb-6 rounded-xl border border-ok/30 bg-ok/5 p-5">
          <div className="text-xs font-semibold uppercase tracking-wider text-ink-3">
            New Phone Pairing Code
          </div>
          <div className="my-2 font-mono text-3xl font-bold tracking-widest text-ink">
            {pairingCode}
          </div>
          <p className="text-xs text-ink-2">
            Valid for 15 minutes
            {expiresAt ? ` (until ${new Date(expiresAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })})` : ""}.
            Have the technician open the Android app and enter these 6 digits. The code can be used once.
          </p>
        </div>
      )}

      {!canEdit && (
        <p className="mb-4 text-sm text-ink-2">
          Only management can edit this record.
        </p>
      )}

      {!loadError && (
        <div className="space-y-6">
          <Card>
            <div className="mb-4 flex flex-wrap items-center gap-3">
              {qualificationStatus && <StatusBadge label={qualificationStatus} />}
              {record && "calibration_due" in record && (
                <StatusBadge label={calibrationStatus(record.calibration_due)} />
              )}
              {record && "certificate_path" in record && (
                record.certificate_path ? (
                  <a
                    href={`/registers/${register}/${id}/certificate`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-semibold text-ink underline"
                  >
                    Open certificate copy
                  </a>
                ) : (
                  <p className="text-sm text-ink-3">No certificate copy uploaded.</p>
                )
              )}
            </div>

            {register === "qualifications" && !people?.length ? (
              <p className="text-sm">
                Add a person in the{" "}
                <Link href="/registers?tab=people" className="text-ink underline">
                  people register
                </Link>{" "}
                first.
              </p>
            ) : (
              <RegisterForm
                register={register}
                record={record}
                people={people ?? []}
                canEdit={canEdit}
                action={saveRegister.bind(null, register, id)}
              />
            )}

            {canEdit && record && register !== "people" && (
              <form
                action={`/registers/${register}/${id}/certificate`}
                method="post"
                encType="multipart/form-data"
                className="mt-6 space-y-3 border-t border-line pt-4"
              >
                <Field
                  label={
                    "certificate_path" in record && record.certificate_path
                      ? "Replace certificate copy"
                      : "Certificate copy"
                  }
                  hint="PDF, JPEG or PNG, up to 5 MB. Upload separately after saving details. The current copy stays linked if the upload fails."
                >
                  <Input
                    name="certificate"
                    type="file"
                    required
                    accept="application/pdf,image/jpeg,image/png"
                  />
                </Field>
                <Button type="submit">Upload certificate</Button>
              </form>
            )}
          </Card>

          {register === "people" && id !== "new" && isTechnician && (
            <Card>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-ink">
                    Linked phones (Android app)
                  </h2>
                  <p className="mt-0.5 text-xs text-ink-3">
                    Technicians link their phone once with a 6-digit code to access jobs and enter readings.
                  </p>
                </div>
                {canEdit && (
                  <form action={createPhonePairingCode.bind(null, id)}>
                    <Button type="submit">Link a phone</Button>
                  </form>
                )}
              </div>

              <List>
                {linkedDevices.length === 0 ? (
                  <EmptyRow>
                    No phones linked yet. Click &quot;Link a phone&quot; to generate a 6-digit pairing code.
                  </EmptyRow>
                ) : (
                  linkedDevices.map((dev) => (
                    <ListRow
                      key={dev.id}
                      tone={dev.revoked_at ? "bad" : "ok"}
                      title={dev.device_name || "Android device"}
                      detail={
                        dev.revoked_at
                          ? `Revoked on ${new Date(dev.revoked_at).toLocaleDateString("en-IN")}`
                          : `Paired ${new Date(dev.paired_at).toLocaleDateString("en-IN")} · Last seen ${
                              dev.last_seen_at
                                ? new Date(dev.last_seen_at).toLocaleDateString("en-IN")
                                : "never"
                            }`
                      }
                      action={
                        canEdit &&
                        !dev.revoked_at && (
                          <form action={revokeTechnicianDevice.bind(null, id, dev.id)}>
                            <SecondaryButton type="submit">Revoke</SecondaryButton>
                          </form>
                        )
                      }
                    />
                  ))
                )}
              </List>
            </Card>
          )}
        </div>
      )}
    </>
  );
}
