import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-4 p-4 text-center">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="text-muted-foreground text-sm">The page doesn&apos;t exist, or the link is out of date.</p>
      <Button asChild><Link href="/">Back to my work</Link></Button>
    </main>
  );
}
