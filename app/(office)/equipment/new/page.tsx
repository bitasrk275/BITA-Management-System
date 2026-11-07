import Link from "next/link";
import {
  Button,
  ButtonLink,
  Card,
  Field,
  Input,
  PageHeader,
  Select,
  Textarea,
} from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { listEquipmentTypes } from "@/lib/modules/equipment/service";
import { createClient } from "@/lib/supabase/server";
import { createEquipmentAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function NewEquipmentPage() {
  await requireStaff();
  const supabase = await createClient();
  const types = await listEquipmentTypes(supabase);

  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader
        title="Add equipment"
        subtitle="Register a new testing instrument, probe, block, or gauge."
        action={
          <ButtonLink href="/equipment" variant="secondary">
            ← Back to equipment
          </ButtonLink>
        }
      />

      <Card className="p-6">
        <form action={createEquipmentAction} className="space-y-4">
          <Field label="Equipment type" hint="Choose the instrument category or manage types">
            <Select name="equipment_type_id" defaultValue={types[0]?.id || ""}>
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
            <div className="mt-1 text-xs text-neutral-500">
              Need a new type?{" "}
              <Link href="/equipment/types" className="underline hover:text-neutral-800">
                Add an equipment type
              </Link>
            </div>
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Make / Manufacturer" hint="e.g. Olympus, Magnaflux, Baker">
              <Input name="make" placeholder="Olympus" required />
            </Field>

            <Field label="Model" hint="e.g. EPOCH 650, Y-7, 26MG">
              <Input name="model" placeholder="EPOCH 650" />
            </Field>
          </div>

          <Field label="Serial number" hint="Unique serial stamped on instrument or probe">
            <Input name="serial_no" placeholder="SN-12045" required />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Calibrated on" hint="Date of last calibration">
              <Input type="date" name="calibrated_on" />
            </Field>

            <Field label="Calibration due date" hint="Date when next calibration is required">
              <Input type="date" name="calibration_due" />
            </Field>
          </div>

          <Field label="Calibration certificate file" hint="Upload PDF certificate or scan copy">
            <input
              type="file"
              name="certificate_file"
              accept=".pdf,image/*"
              className="w-full text-xs text-neutral-600 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border file:border-neutral-300 file:text-xs file:bg-neutral-50 file:text-neutral-800 hover:file:bg-neutral-100"
            />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Initial status">
              <Select name="status" defaultValue="in_office">
                <option value="in_office">In office</option>
                <option value="at_site">At site</option>
                <option value="out_for_calibration">Out for calibration</option>
              </Select>
            </Field>

            <Field label="Current physical location" hint="e.g. In office, Peenya Shop 1">
              <Input name="current_location" defaultValue="In office" />
            </Field>
          </div>

          <Field label="Notes / Accessories" hint="Probes included, cables, battery condition, etc.">
            <Textarea name="notes" placeholder="Includes 4 MHz normal probe and 5m BNC cable" />
          </Field>

          <div className="pt-4 flex items-center justify-end gap-3 border-t border-neutral-100">
            <ButtonLink href="/equipment" variant="secondary">
              Cancel
            </ButtonLink>
            <Button type="submit">Save equipment</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
