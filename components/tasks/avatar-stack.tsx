import { Avatar, AvatarFallback } from "@ui-sdk/react/avatar";
import { initials } from "@/lib/format";

/** Overlapping initials for the people a task was given to: the first few, then "+N". The names are read out for screen readers. */
export function AvatarStack({ names, max = 3 }: { names: string[]; max?: number }) {
  const shown = names.slice(0, max);
  const more = names.length - shown.length;
  return (
    <span className="flex items-center -space-x-1.5">
      {shown.map((name, i) => (
        <Avatar key={`${name}-${i}`} aria-hidden className="ring-card size-6 ring-2">
          <AvatarFallback className="text-[10px]">{initials(name)}</AvatarFallback>
        </Avatar>
      ))}
      {more > 0 && (
        <Avatar aria-hidden className="ring-card size-6 ring-2">
          <AvatarFallback className="text-[10px]">+{more}</AvatarFallback>
        </Avatar>
      )}
      <span className="sr-only">{names.join(", ")}</span>
    </span>
  );
}
