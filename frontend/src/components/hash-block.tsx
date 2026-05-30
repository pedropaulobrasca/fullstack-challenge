import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const COPIED_FLASH_MS = 1400;

type HashBlockProps = {
  label: string;
  value: string;
  className?: string;
};

export function HashBlock({ label, value, className }: HashBlockProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const handle = setTimeout(() => setCopied(false), COPIED_FLASH_MS);
    return () => clearTimeout(handle);
  }, [copied]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
  };

  return (
    <div
      data-slot="hash-block"
      className={cn("flex items-start gap-2", className)}
    >
      <code
        data-slot="hash-block-value"
        className="flex-1 break-all rounded-md border border-border bg-popover px-4 py-2 font-mono text-sm font-normal text-foreground"
      >
        {value}
      </code>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={handleCopy}
        aria-label={`Copy ${label}`}
        className="shrink-0"
      >
        {copied ? (
          <>
            <Check aria-hidden="true" />
            <span>Copied</span>
          </>
        ) : (
          <Copy aria-hidden="true" />
        )}
      </Button>
    </div>
  );
}
