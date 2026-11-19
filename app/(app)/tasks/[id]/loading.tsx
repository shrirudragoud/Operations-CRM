import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div role="status" aria-label="Loading task" className="space-y-4">
      <Skeleton className="h-8 w-72" />
      <Skeleton className="h-6 w-56" />
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-72 w-full lg:col-span-2" />
        <Skeleton className="h-72 w-full" />
      </div>
    </div>
  );
}
