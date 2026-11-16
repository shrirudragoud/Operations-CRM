import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div role="status" aria-label="Loading workshop" className="space-y-4">
      <Skeleton className="h-8 w-60" />
      <Skeleton className="h-9 w-full max-w-md" />
      <Skeleton className="h-[28rem] w-full" />
    </div>
  );
}
