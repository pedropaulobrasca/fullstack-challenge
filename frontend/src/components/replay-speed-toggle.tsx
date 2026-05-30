import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

type ReplaySpeedToggleProps = {
  speeds: readonly number[];
  currentSpeed: number;
  onChange: (speed: number) => void;
  disabled?: boolean;
};

export function ReplaySpeedToggle({
  speeds,
  currentSpeed,
  onChange,
  disabled,
}: ReplaySpeedToggleProps) {
  return (
    <ToggleGroup
      type="single"
      value={String(currentSpeed)}
      onValueChange={(value) => {
        if (!value) return;
        const next = Number(value);
        if (Number.isFinite(next) && next > 0) {
          onChange(next);
        }
      }}
      aria-label="Replay speed"
      data-slot="replay-speed-toggle"
      variant="outline"
      size="default"
      spacing={2}
      disabled={disabled}
    >
      {speeds.map((speed) => (
        <ToggleGroupItem
          key={speed}
          value={String(speed)}
          aria-label={`Replay at ${speed}x speed`}
          className="min-h-11 min-w-11 px-3 font-sans text-sm font-semibold"
        >
          {`${speed}x`}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
