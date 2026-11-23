"use client";

import { SlidersHorizontalIcon } from "lucide-react";
import { setVoicePrefs, useVoicePrefs } from "@/components/assistant/voice-prefs-store";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { DEFAULT_PREFS, LANGUAGES, LENGTHS, PACES, PATIENCE, STYLES, VOICES, VOLUME_MAX, VOLUME_MIN, type VoicePrefs } from "@/lib/ai/voice-prefs";
import { cn } from "cn";

type Choice = { id: string; label: string };

function Pick<K extends keyof VoicePrefs>({ id, label, name, options, hint }: { id: string; label: string; name: K; options: readonly Choice[]; hint?: string }) {
  const value = useVoicePrefs()[name] as string;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={(v) => setVoicePrefs({ [name]: v } as Partial<VoicePrefs>)}>
        <SelectTrigger id={id} size="sm" className="w-full"><SelectValue /></SelectTrigger>
        <SelectContent>{options.map((o) => <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>)}</SelectContent>
      </Select>
      {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
    </div>
  );
}

/** Everything a person can change about how the assistant sounds and listens. Kept in this browser; a running call keeps the settings it started with, except volume. */
export function VoiceSettings({ className, inCall = false }: { className?: string; inCall?: boolean }) {
  const prefs = useVoicePrefs();
  const voice = VOICES.find((v) => v.id === prefs.voice);

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" size="icon-sm" className={cn("rounded-full", className)} aria-label="Voice settings" title={`Voice: ${prefs.voice}`}>
          <SlidersHorizontalIcon aria-hidden />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Voice settings</DialogTitle>
          <DialogDescription>
            {inCall ? "Volume changes now. The rest apply to your next call." : "Used the next time you talk to the assistant."} Saved on this device.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="vs-voice">Voice</Label>
          <Select value={prefs.voice} onValueChange={(v) => setVoicePrefs({ voice: v as VoicePrefs["voice"] })}>
            <SelectTrigger id="vs-voice" size="sm" className="w-full">
              <SelectValue>{voice ? `${voice.id} · ${voice.tone}` : prefs.voice}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {(["female", "male"] as const).map((g) => (
                <SelectGroup key={g}>
                  <SelectLabel>{g === "female" ? "Female voices" : "Male voices"}</SelectLabel>
                  {VOICES.filter((v) => v.gender === g).map((v) => (
                    <SelectItem key={v.id} value={v.id}>{v.id} · {v.tone}</SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Pick id="vs-style" label="Tone" name="style" options={STYLES} />
        <Pick id="vs-pace" label="Speaking pace" name="pace" options={PACES} />
        <Pick id="vs-length" label="Answer length" name="length" options={LENGTHS} />
        <Pick id="vs-language" label="Language" name="language" options={LANGUAGES} />
        <Pick id="vs-patience" label="How long it waits for you" name="patience" options={PATIENCE} />

        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="vs-noisy" className="flex-1">
            Noisy room
            <span className="text-muted-foreground block text-xs font-normal">Ignores background sounds when listening.</span>
          </Label>
          <Switch id="vs-noisy" size="sm" checked={prefs.noisyRoom} onCheckedChange={(v) => setVoicePrefs({ noisyRoom: v })} />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="vs-volume">Volume</Label>
            <span className="text-muted-foreground text-xs tabular-nums">{Math.round(prefs.volume * 100)}%</span>
          </div>
          <Slider
            id="vs-volume" aria-label="Assistant volume" min={VOLUME_MIN} max={VOLUME_MAX} step={0.05} value={[prefs.volume]}
            onValueChange={([v]) => setVoicePrefs({ volume: v ?? 1 })}
          />
        </div>

        <Button type="button" variant="outline" size="sm" onClick={() => setVoicePrefs(DEFAULT_PREFS)}>Reset to defaults</Button>
      </DialogContent>
    </Dialog>
  );
}
