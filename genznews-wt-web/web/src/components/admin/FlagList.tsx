function split(flag: string): [string, string] {
  const i = flag.indexOf(":");
  return i === -1 ? [flag, ""] : [flag.slice(0, i), flag.slice(i + 1)];
}

/** Flags grouped by the text before the first colon, with a count and the values per group. */
export function FlagList({ flags }: { flags: string[] }) {
  if (flags.length === 0) return null;
  const groups = new Map<string, string[]>();
  for (const flag of flags) {
    const [kind, value] = split(flag);
    groups.set(kind, [...(groups.get(kind) ?? []), value]);
  }
  return (
    <section aria-labelledby="flags-heading">
      <h2 id="flags-heading" className="section-label mb-2">
        Flags
      </h2>
      <div className="flex flex-col gap-3">
        {[...groups].map(([kind, values]) => (
          <div key={kind}>
            <h3 className="font-bold">
              {kind} ({values.length})
            </h3>
            <ul className="list-disc pl-5 text-sm">
              {values
                .filter((v) => v !== "")
                .map((v, i) => (
                  <li key={`${v}-${i}`}>{v}</li>
                ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
