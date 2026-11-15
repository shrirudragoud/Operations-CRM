import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ShieldXIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { getMe } from "@/lib/auth";
import { createClient } from "@/utils/supabase/server";

export const metadata: Metadata = { title: "No access" };

export default async function NoAccessPage({ searchParams }: PageProps<"/no-access">) {
  // If they do have access (e.g. invited since), send them in.
  if (await getMe()) redirect("/");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // A deactivated person can still read their own staff row (staff_sel), which tells the two cases apart.
  const { data: own } = user
    ? await supabase.from("staff").select("is_active").eq("id", user.id).maybeSingle()
    : { data: null };
  const disabled = (await searchParams).reason === "disabled" || own?.is_active === false;

  return (
    <main className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <ShieldXIcon className="text-muted-foreground mb-2 size-8" aria-hidden />
          <CardTitle>{disabled ? "Your access has been turned off" : "You haven't been invited yet"}</CardTitle>
          <CardDescription>
            {disabled
              ? "Your account was deactivated. Ask the founder if you think this is a mistake."
              : "Hard-Code Ops is invite-only. Ask the founder to invite the email below, then sign in again."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm">
            Signed in as <strong className="break-all">{user?.email ?? "unknown"}</strong>
          </p>
        </CardContent>
        <CardFooter>
          <form action="/auth/signout" method="post">
            <Button type="submit" variant="outline">
              Sign out and use another account
            </Button>
          </form>
        </CardFooter>
      </Card>
    </main>
  );
}
