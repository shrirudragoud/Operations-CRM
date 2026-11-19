import Link from "next/link";
import { CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

export default function NotFound() {
  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon"><CalendarIcon aria-hidden /></EmptyMedia>
        <EmptyTitle>Meeting not found</EmptyTitle>
        <EmptyDescription>It may have been removed, or it is not one you can see. Meetings are visible to the people invited, and to a department or the company when the organizer opened them up.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button asChild variant="outline"><Link href="/calendar">Back to the calendar</Link></Button>
      </EmptyContent>
    </Empty>
  );
}
