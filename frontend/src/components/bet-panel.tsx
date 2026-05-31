import { Bot, Lock } from "lucide-react";
import { Card } from "@/components/ui/card";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { ManualTabContent } from "@/components/manual-tab-content";
import { AutoBetForm } from "@/components/auto-bet-form";
import { useAutoBetStore } from "@/features/auto-bet/auto-bet.store";

export function BetPanel() {
  const autoRunning = useAutoBetStore((state) => state.isRunning);

  return (
    <Card className="flex flex-col gap-4 p-6">
      <Tabs defaultValue="manual" className="w-full">
        <TabsList className="grid h-12 w-full grid-cols-2 p-0.5">
          <TabsTrigger value="manual" className="h-full">
            Manual
            {autoRunning ? (
              <Lock
                aria-hidden="true"
                className="ml-1 size-3 text-muted-foreground"
              />
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="auto" className="h-full">
            <Bot aria-hidden="true" className="size-4" />
            Auto
            {autoRunning ? (
              <span
                aria-hidden="true"
                className="ml-1 size-1.5 rounded-full bg-accent motion-safe:animate-pulse"
              />
            ) : null}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="manual">
          <ManualTabContent />
        </TabsContent>
        <TabsContent value="auto">
          <AutoBetForm />
        </TabsContent>
      </Tabs>
    </Card>
  );
}
