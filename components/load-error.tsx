import { AlertCircleIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export function LoadError({ what }: { what: string }) {
  return (
    <Alert variant="destructive">
      <AlertCircleIcon aria-hidden />
      <AlertTitle>Couldn&apos;t load {what}</AlertTitle>
      <AlertDescription>Refresh the page to try again. If it keeps failing, tell the founder.</AlertDescription>
    </Alert>
  );
}
