import Link from "next/link";
import { SchoolIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

export default function NotFound() {
  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon"><SchoolIcon aria-hidden /></EmptyMedia>
        <EmptyTitle>Institution not found</EmptyTitle>
        <EmptyDescription>It may have been removed, or it is not one you have access to.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button asChild variant="outline"><Link href="/institutions">Back to institutions</Link></Button>
      </EmptyContent>
    </Empty>
  );
}
