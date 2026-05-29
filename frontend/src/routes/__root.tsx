import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { Toaster } from "sonner";
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
  return (
    <html lang="en" className="dark">
      <head>
        <HeadContent />
      </head>
      <body className="min-h-screen bg-background text-foreground font-sans antialiased">
        <div className="flex min-h-screen flex-col">
          <AppHeader />
          <main className="flex-1">
            <Outlet />
          </main>
        </div>
        <Toaster theme="dark" position="top-center" richColors />
        <Scripts />
      </body>
    </html>
  );
}

function AppHeader() {
  return (
    <header className="flex items-center justify-between border-b border-border bg-card px-6 py-4">
      <div className="flex items-center gap-3">
        <span className="font-mono text-lg font-semibold tracking-tight text-foreground">CRASH</span>
        <div data-slot="fairness-badge" aria-hidden className="h-6" />
      </div>
      <div className="flex items-center gap-4">
        <div data-slot="connection-badge" />
        <div data-slot="balance-pill" />
      </div>
    </header>
  );
}
