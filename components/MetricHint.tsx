export function MetricHint({ label, hint }: { label: string; hint?: string }) {
  if (!hint) return <p className="text-muted-foreground">{label}</p>;
  return (
    <p className="text-muted-foreground">
      {label}
      <button
        type="button"
        className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full border text-[10px] leading-none"
        aria-label={hint}
        title={hint}
      >
        ?
      </button>
    </p>
  );
}
