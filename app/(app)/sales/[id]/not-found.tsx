import Link from "next/link";
import { HandshakeIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

export default function NotFound() {
  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon"><HandshakeIcon aria-hidden /></EmptyMedia>
        <EmptyTitle>Deal not found</EmptyTitle>
        <EmptyDescription>It may have been removed, or it is not one you have access to.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button asChild variant="outline"><Link href="/sales">Back to Sales</Link></Button>
      </EmptyContent>
    </Empty>
  );
}
