/** The app's one loading indicator, centred in whatever holds it. */
export function Spinner({ label }: { label: string }) {
  return (
    <div className="flex flex-1 items-center justify-center" role="status" aria-live="polite">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      <span className="sr-only">{label}</span>
    </div>
  );
}
