import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div role="status" aria-label="Loading sales" className="space-y-4">
      <Skeleton className="h-8 w-60" />
      <Skeleton className="h-9 w-full max-w-md" />
      <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-64 w-full" />)}
      </div>
    </div>
  );
}
