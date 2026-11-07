import Link from "next/link";
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  Field,
  Input,
  List,
  ListRow,
  PageHeader,
  SavedNote,
  SectionTitle,
  Textarea,
} from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { listEquipmentTypes } from "@/lib/modules/equipment/service";
import { createClient } from "@/lib/supabase/server";
import { createEquipmentTypeAction, deleteEquipmentTypeAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function EquipmentTypesPage(props: {
  searchParams: Promise<{ saved?: string; deleted?: string }>;
}) {
  await requireStaff();
  const supabase = await createClient();
  const searchParams = await props.searchParams;

  const types = await listEquipmentTypes(supabase);

  // Get item counts per type
  const { data: countsData } = await supabase
    .from("equipment")
    .select("equipment_type_id")
    .is("deleted_at", null);

  const countMap = new Map<string, number>();
  (countsData ?? []).forEach((row) => {
    if (row.equipment_type_id) {
      countMap.set(row.equipment_type_id, (countMap.get(row.equipment_type_id) || 0) + 1);
    }
  });

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader
        title="Equipment types"
        subtitle="Manage testing instrument categories (UT flaw detectors, probes, blocks, yokes, gauges, etc.)."
        action={
          <ButtonLink href="/equipment" variant="secondary">
            ← Back to equipment
          </ButtonLink>
        }
      />

      {searchParams.saved && <SavedNote />}
      {searchParams.deleted && (
        <Card className="border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
          Equipment type moved to{" "}
          <Link href="/recycle-bin" className="underline font-medium">
            Recycle bin
          </Link>
          .
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Types List */}
        <div className="md:col-span-2 space-y-3">
          <SectionTitle>Existing categories ({types.length})</SectionTitle>
          <List>
            {types.map((t) => {
              const count = countMap.get(t.id) || 0;
              return (
                <ListRow
                  key={t.id}
                  title={
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-neutral-900">{t.name}</span>
                      <Badge>{count} {count === 1 ? "item" : "items"}</Badge>
                    </div>
                  }
                  detail={
                    t.description ? (
                      <span className="text-xs text-neutral-500">{t.description}</span>
                    ) : null
                  }
                  action={
                    <form action={deleteEquipmentTypeAction.bind(null, t.id)}>
                      <button
                        type="submit"
                        onClick={(e) => {
                          if (
                            !confirm(
                              `Are you sure you want to delete type "${t.name}"? It will move to the recycle bin.`
                            )
                          ) {
                            e.preventDefault();
                          }
                        }}
                        className="rounded border border-neutral-200 px-2 py-1 text-xs text-neutral-600 hover:text-red-700 hover:bg-red-50"
                      >
                        Delete
                      </button>
                    </form>
                  }
                />
              );
            })}
          </List>
        </div>

        {/* Add New Type Card */}
        <div>
          <Card className="p-5 space-y-4">
            <SectionTitle>Add equipment type</SectionTitle>
            <form action={createEquipmentTypeAction} className="space-y-3">
              <Field label="Category name" hint="e.g. Thickness gauge, Hardness tester">
                <Input name="name" placeholder="Name" required />
              </Field>

              <Field label="Description (optional)">
                <Textarea name="description" placeholder="Description of this instrument category" rows={2} />
              </Field>

              <div className="pt-2">
                <Button type="submit">Create category</Button>
              </div>
            </form>
          </Card>
        </div>
      </div>
    </div>
  );
}
