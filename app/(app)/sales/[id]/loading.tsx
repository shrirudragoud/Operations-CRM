import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div role="status" aria-label="Loading institution" className="space-y-4">
      <Skeleton className="h-8 w-72" />
      <Skeleton className="h-6 w-40" />
      <Skeleton className="h-10 w-full max-w-xl" />
      <Skeleton className="h-48 w-full" />
    </div>
  );
}
