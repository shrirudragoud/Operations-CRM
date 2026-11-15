import Link from "next/link";
import { LockIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

export function AccessDenied({ what }: { what: string }) {
  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon"><LockIcon aria-hidden /></EmptyMedia>
        <EmptyTitle>You don&apos;t have access to {what}</EmptyTitle>
        <EmptyDescription>
          Your role or departments don&apos;t include this area. Ask the founder if you need it.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button asChild variant="outline"><Link href="/">Back to my work</Link></Button>
      </EmptyContent>
    </Empty>
  );
}
