/** @file Ranking-policy and analysis-provider settings dialogs. */

import { HugeiconsIcon } from "@hugeicons/react";
import {
  BotIcon,
  InformationCircleIcon,
  Refresh01Icon,
  Settings01Icon,
  SlidersHorizontalIcon,
} from "@hugeicons/core-free-icons";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import type { ProviderId, ProviderStatus } from "@/lib/providers/types";
import { WEIGHT_PRESETS } from "@/lib/ranking/scenarios";
import type { SignalKey, SignalWeights } from "@/lib/ranking/types";
import { cn } from "@/lib/utils";
import { SIGNAL_KEYS, SIGNAL_META } from "./model";
import { WeightStrip } from "./signal-display";

/** Allows users to choose a documented policy preset or tune each signal weight. */
export function WeightSettings({
  weights,
  preset,
  onPresetChange,
  onWeightChange,
  onReset,
}: {
  weights: SignalWeights;
  preset: string;
  onPresetChange: (value: string) => void;
  onWeightChange: (key: SignalKey, value: number) => void;
  onReset: () => void;
}) {
  return (
    <Dialog>
      <DialogTrigger
        render={<Button variant="outline" size="sm" className="rounded-full bg-background" />}
      >
        <HugeiconsIcon icon={SlidersHorizontalIcon} className="size-4" strokeWidth={2} />
        Weights
      </DialogTrigger>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="font-heading">Ranking policy</DialogTitle>
          <DialogDescription>
            Tune influence without removing any of the three required evidence axes.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 pt-2">
          <div>
            <label className="mb-2 block text-xs font-semibold" htmlFor="weight-profile">
              Preset
            </label>
            <Select value={preset} onValueChange={(value) => onPresetChange(String(value))}>
              <SelectTrigger
                id="weight-profile"
                aria-label="Weight preset"
                className="w-full rounded-xl bg-muted/60"
              >
                <SelectValue>{WEIGHT_PRESETS[preset]?.label ?? "Custom"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {Object.entries(WEIGHT_PRESETS).map(([key, item]) => (
                  <SelectItem key={key} value={key}>
                    {item.label}
                  </SelectItem>
                ))}
                <SelectItem value="custom">Custom</SelectItem>
              </SelectContent>
            </Select>
            <p className="mt-2 text-[11px] text-muted-foreground">
              {WEIGHT_PRESETS[preset]?.description ??
                "A custom profile is active. Values are normalised at scoring time."}
            </p>
          </div>

          <WeightStrip weights={weights} />

          <div className="space-y-5">
            {SIGNAL_KEYS.map((key) => (
              <div key={key}>
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={cn("size-2 rounded-full", SIGNAL_META[key].dot)} />
                    <span className="text-xs font-semibold">{SIGNAL_META[key].label}</span>
                  </div>
                  <span className="font-mono text-xs font-semibold tabular-nums">
                    {weights[key]}%
                  </span>
                </div>
                <Slider
                  aria-label={`${SIGNAL_META[key].label} weight`}
                  min={10}
                  max={70}
                  step={5}
                  value={[weights[key]]}
                  onValueChange={(value) => {
                    const nextValue = Array.isArray(value) ? value[0] : value;
                    onWeightChange(key, Number(nextValue));
                  }}
                />
              </div>
            ))}
          </div>

          <Alert className="rounded-xl bg-muted/35">
            <HugeiconsIcon icon={InformationCircleIcon} className="size-4" strokeWidth={2} />
            <AlertTitle className="text-xs">Confidence remains guarded</AlertTitle>
            <AlertDescription className="text-[11px] leading-4">
              Editing weights changes ranking influence, but explicit conflicts remain visible and
              close outcomes still trigger human review.
            </AlertDescription>
          </Alert>

          <Button variant="outline" className="w-full rounded-xl" onClick={onReset}>
            <HugeiconsIcon icon={Refresh01Icon} className="size-4" strokeWidth={2} />
            Restore system defaults
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Explains the adapter boundary and reports configured providers. */
export function ProviderSettings({
  providers,
  selectedProvider,
}: {
  providers: ProviderStatus[];
  selectedProvider: ProviderId;
}) {
  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full"
            aria-label="Provider settings"
          />
        }
      >
        <HugeiconsIcon icon={Settings01Icon} className="size-4" strokeWidth={2} />
      </DialogTrigger>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="font-heading">Analysis providers</DialogTitle>
          <DialogDescription>
            Candidate extraction is swappable; scoring and abstention remain application-owned.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 pt-2">
          {providers.map((provider) => (
            <div
              key={provider.id}
              className="flex items-center gap-3 rounded-xl border bg-muted/20 p-3.5"
            >
              <div
                className={cn(
                  "flex size-9 items-center justify-center rounded-lg",
                  provider.operational
                    ? "bg-primary/10 text-primary"
                    : "bg-muted text-muted-foreground",
                )}
              >
                <HugeiconsIcon
                  icon={BotIcon}
                  className="size-4"
                  strokeWidth={2}
                />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-xs font-semibold">{provider.name}</p>
                  {provider.id === selectedProvider && (
                    <Badge className="h-5 rounded-full bg-primary/10 text-[9px] text-primary shadow-none">
                      Selected
                    </Badge>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {provider.detail}
                </p>
              </div>
              <span
                className={cn(
                  "size-2 rounded-full",
                  provider.operational
                    ? "bg-emerald-500"
                    : provider.configured
                      ? "bg-amber-500"
                      : "bg-muted-foreground/40",
                )}
              />
            </div>
          ))}
        </div>
        <p className="text-[11px] leading-5 text-muted-foreground">
          Green means a bounded readiness check succeeded. Amber means configuration exists but
          the provider did not answer the check. Credentials never enter the browser.
        </p>
      </DialogContent>
    </Dialog>
  );
}
