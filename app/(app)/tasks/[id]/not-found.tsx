import Link from "next/link";
import { ListChecksIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

export default function NotFound() {
  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon"><ListChecksIcon aria-hidden /></EmptyMedia>
        <EmptyTitle>Task not found</EmptyTitle>
        <EmptyDescription>It may have been deleted, or it is not one you have access to.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button asChild variant="outline"><Link href="/tasks">Back to Tasks</Link></Button>
      </EmptyContent>
    </Empty>
  );
}
