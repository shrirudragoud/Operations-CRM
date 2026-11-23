"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSeparator, FieldSet } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { savePushGroups, sendTestPush } from "@/lib/actions/push";
import { currentSubscription, disablePush, enablePush, pushSupported } from "@/lib/push-client";
import { PUSH_GROUPS, type PushGroupId } from "@/lib/schemas/push";

type Support = "checking" | "unsupported" | "ready";

export function BrowserForm({ vapidKey, initialGroups, endpoints }: { vapidKey: string | null; initialGroups: PushGroupId[]; endpoints: string[] }) {
  const [support, setSupport] = useState<Support>("checking");
  const [blocked, setBlocked] = useState(false);
  const [thisDevice, setThisDevice] = useState(false);
  const [groups, setGroups] = useState<PushGroupId[]>(initialGroups);
  const [switching, startSwitch] = useTransition();
  const [saving, startSave] = useTransition();
  const [testing, startTest] = useTransition();

  useEffect(() => {
    let live = true;
    (async () => {
      if (!pushSupported()) {
        if (live) setSupport("unsupported");
        return;
      }
      const sub = await currentSubscription().catch(() => null);
      if (!live) return;
      setBlocked(Notification.permission === "denied");
      setThisDevice(!!sub && endpoints.includes(sub.endpoint));
      setSupport("ready");
    })();
    return () => {
      live = false;
    };
  }, [endpoints]);

  const toggleDevice = (on: boolean) =>
    startSwitch(async () => {
      if (!vapidKey) return;
      const r = on ? await enablePush(vapidKey) : await disablePush();
      if (!r.ok) {
        toast.error(r.error);
        setBlocked(typeof Notification !== "undefined" && Notification.permission === "denied");
        return;
      }
      setThisDevice(on);
      toast.success(on ? "Notifications are on for this device" : "Notifications are off for this device");
    });

  const toggle = (id: PushGroupId, on: boolean) => setGroups((g) => (on ? [...new Set([...g, id])] : g.filter((x) => x !== id)));

  const save = () =>
    startSave(async () => {
      const r = await savePushGroups({ groups });
      if (r.ok) toast.success("Notification choices saved");
      else toast.error(r.error);
    });

  const test = () =>
    startTest(async () => {
      const r = await sendTestPush();
      if (r.ok) toast.success("A test notification is on its way. It should appear within a few seconds.");
      else toast.error(r.error);
    });

  if (!vapidKey) {
    return (
      <Alert>
        <AlertTitle>Not set up yet</AlertTitle>
        <AlertDescription>Browser notifications are not switched on for this server. Ask the founder.</AlertDescription>
      </Alert>
    );
  }
  if (support === "unsupported") {
    return (
      <Alert>
        <AlertTitle>This browser cannot do this</AlertTitle>
        <AlertDescription>It cannot show notifications from a website. Use a current Chrome, Edge or Firefox on a computer or Android phone. iPhone and iPad are not supported yet.</AlertDescription>
      </Alert>
    );
  }

  const others = endpoints.length - (thisDevice ? 1 : 0);

  return (
    <FieldGroup className="max-w-md">
      <Field orientation="horizontal">
        <FieldContent>
          <FieldLabel htmlFor="browser-enabled">Notify me on this device</FieldLabel>
          <FieldDescription>
            Shows a notification on this computer or phone even when the app is closed. Signing out turns it off here.
            {others > 0 ? ` You also get them on ${others} other device${others === 1 ? "" : "s"}.` : ""}
          </FieldDescription>
        </FieldContent>
        {switching && <Spinner />}
        <Switch id="browser-enabled" checked={thisDevice} disabled={support === "checking" || switching || blocked} onCheckedChange={toggleDevice} />
      </Field>

      {blocked && (
        <Alert variant="destructive" role="alert">
          <AlertTitle>Notifications are blocked</AlertTitle>
          <AlertDescription>Your browser is blocking notifications for this site. Click the lock icon next to the address, allow notifications, then reload this page.</AlertDescription>
        </Alert>
      )}

      {thisDevice && (
        <>
          <FieldSeparator />
          <FieldSet>
            <FieldLegend variant="label">What to notify me about</FieldLegend>
            <FieldGroup className="gap-4">
              {PUSH_GROUPS.map((g) => (
                <Field key={g.id} orientation="horizontal">
                  <Checkbox id={`push-${g.id}`} checked={groups.includes(g.id)} onCheckedChange={(on) => toggle(g.id, on === true)} />
                  <FieldContent>
                    <FieldLabel htmlFor={`push-${g.id}`}>{g.label}</FieldLabel>
                    <FieldDescription>{g.hint}</FieldDescription>
                  </FieldContent>
                </Field>
              ))}
            </FieldGroup>
          </FieldSet>
          <Field orientation="horizontal" className="flex-wrap">
            <Button type="button" onClick={save} disabled={saving}>{saving && <Spinner />} Save</Button>
            <Button type="button" variant="outline" onClick={test} disabled={testing}>{testing && <Spinner />} Send a test notification</Button>
          </Field>
        </>
      )}
    </FieldGroup>
  );
}
