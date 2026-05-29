import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import { OidcProvider } from "@/auth/oidc-provider";
import { useGameSocket } from "@/ws/use-game-socket";
import { BalancePill } from "@/components/balance-pill";
import { ConnectionBadge } from "@/components/connection-badge";
import appCss from "@/styles/globals.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Crash" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  component: RootComponent,
});

function RootComponent() {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <html lang="en" className="dark">
      <head>
        <HeadContent />
      </head>
      <body className="min-h-screen bg-background text-foreground font-sans antialiased">
        <QueryClientProvider client={queryClient}>
          <OidcProvider>
            <GameSession />
          </OidcProvider>
          <div className="flex min-h-screen flex-col">
            <AppHeader />
            <main className="flex-1">
              <Outlet />
            </main>
          </div>
        </QueryClientProvider>
        <Toaster position="top-center" richColors />
        <Scripts />
      </body>
    </html>
  );
}

function GameSession() {
  useGameSocket();
  return null;
}

function AppHeader() {
  return (
    <header className="flex items-center justify-between border-b border-border bg-card px-6 py-4">
      <div className="flex items-center gap-3">
        <span className="font-mono text-lg font-semibold tracking-tight text-foreground">CRASH</span>
        <div data-slot="fairness-badge" aria-hidden className="h-6" />
      </div>
      <div className="flex items-center gap-4">
        <ConnectionBadge />
        <BalancePill />
      </div>
    </header>
  );
}
