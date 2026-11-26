import type { PatchDef } from './types';

/** Morphe-style patches-list.json → PatchDef[] */
export function fromPatchesList(j: any): PatchDef[] {
  return (j.patches || []).map((p: any) => ({
    name: p.name,
    description: p.description,
    default: p.default !== false,
    packages: p.compatiblePackages
      ? p.compatiblePackages.map((c: any) => ({
          packageName: c.packageName,
          name: c.name || undefined,
          signatures: Array.isArray(c.signatures) && c.signatures.length ? c.signatures.map((x: string) => x.toLowerCase().replace(/[^0-9a-f]/g, '')) : undefined,
          versions: (() => {
            const v: string[] = c.targets
              ? c.targets.filter((t: any) => !t.isExperimental).map((t: any) => t.version).filter(Boolean)
              : c.versions || [];
            return v.length ? v : null;
          })(),
        }))
      : null,
    options: (p.options || []).map((o: any) => ({
      key: o.key,
      title: o.title,
      description: o.description?.trim(),
      required: o.required,
      type: o.type,
      default: o.default,
      values: o.values,
    })),
  }));
}

