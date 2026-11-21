import { useEffect, useRef, type ReactNode } from "react";
import { ClerkProvider, SignIn, SignUp, Show, useClerk } from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { shadcn } from "@clerk/themes";
import { Switch, Route, Redirect, useLocation, useSearch, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { ErrorBoundary } from "@/components/error-boundary";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Home from "@/pages/home";
import Webhooks from "@/pages/webhooks";
import SettingsPage from "@/pages/settings";
import PromptsPage from "@/pages/settings-prompts";
import ExtractionPage from "@/pages/settings-extraction";
import RulePage from "@/pages/settings-rule";
import Dashboard from "@/pages/dashboard";
import { Shell } from "@/components/shell";

const queryClient = new QueryClient();

const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);

const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

if (!clerkPubKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY in .env file");
}

const ink = "hsl(var(--foreground))";
const clerkAppearance = {
  theme: shadcn,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: ink,
    colorForeground: ink,
    colorMutedForeground: "hsl(var(--muted-foreground))",
    colorDanger: "hsl(var(--destructive))",
    colorBackground: "hsl(var(--card))",
    colorInput: "hsl(var(--card))",
    colorInputForeground: ink,
    colorNeutral: ink,
    colorMuted: "hsl(var(--muted))",
    colorPrimaryForeground: "hsl(var(--primary-foreground))",
    colorRing: "hsl(var(--ring))",
    fontFamily: "var(--app-font-sans)",
    borderRadius: "var(--radius)",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "bg-card border border-border rounded-xl w-[420px] max-w-full overflow-hidden",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "font-display text-3xl text-foreground",
    headerSubtitle: "text-muted-foreground",
    socialButtonsBlockButtonText: "text-foreground",
    formFieldLabel: "text-foreground",
    footerActionLink: "text-accent hover:text-accent",
    footerActionText: "text-muted-foreground",
    dividerText: "text-muted-foreground",
    identityPreviewEditButton: "text-accent",
    formFieldSuccessText: "text-foreground",
    alertText: "text-foreground",
    logoBox: "justify-start",
    logoImage: "h-9 w-9",
    socialButtonsBlockButton: "border border-border bg-card",
    formButtonPrimary: "bg-primary text-primary-foreground",
    formFieldInput: "border border-input bg-card",
    footerAction: "justify-center",
    dividerLine: "bg-border",
    alert: "border border-border",
    otpCodeFieldInput: "border border-input",
    formFieldRow: "",
    main: "",
  },
};

function SignInPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
    </div>
  );
}

function SignUpPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
    </div>
  );
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const queryClient = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (
        prevUserIdRef.current !== undefined &&
        prevUserIdRef.current !== userId
      ) {
        queryClient.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, queryClient]);

  return null;
}

function HomeRedirect() {
  return (
    <>
      <Show when="signed-in"><Redirect to="/dashboard" /></Show>
      <Show when="signed-out"><Home /></Show>
    </>
  );
}

const PRIVATE = ["/dashboard", "/inbox", "/notes", "/tasks", "/reminders", "/webhooks", "/settings", "/settings/prompts"];

function LegacyInboxRedirect() {
  const id = new URLSearchParams(useSearch()).get("event");
  return <Redirect to={id ? `/dashboard?note=${encodeURIComponent(id)}` : "/dashboard?inbox=1"} />;
}

function LegacyTasksRedirect() {
  const schedule = new URLSearchParams(useSearch()).get("schedule");
  return <Redirect to={schedule === "scheduled" || schedule === "unscheduled" ? `/dashboard?schedule=${schedule}` : "/dashboard"} />;
}

function PrivateRoutes() {
  return (
    <Switch>
      <Route path="/dashboard" component={Dashboard} />
      <Route path="/notes" component={LegacyInboxRedirect} />
      <Route path="/inbox" component={LegacyInboxRedirect} />
      <Route path="/tasks" component={LegacyTasksRedirect} />
      <Route path="/reminders">{() => <Redirect to="/dashboard?schedule=scheduled" />}</Route>
      <Route path="/webhooks" component={Webhooks} />
      <Route path="/settings/prompts/extraction" component={ExtractionPage} />
      <Route path="/settings/prompts/new" component={RulePage} />
      <Route path="/settings/prompts/:id" component={RulePage} />
      <Route path="/settings/prompts" component={PromptsPage} />
      <Route path="/settings" component={SettingsPage} />
    </Switch>
  );
}

function Fallback() {
  const [loc] = useLocation();
  if (!PRIVATE.includes(loc) && !loc.startsWith("/settings/prompts/")) return <NotFound />;
  return <Private><PrivateRoutes /></Private>;
}

function Private({ children }: { children: ReactNode }) {
  return (
    <>
      <Show when="signed-in"><Shell>{children}</Shell></Show>
      <Show when="signed-out"><Redirect to="/" /></Show>
    </>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: { start: { title: "Index 0.1", subtitle: "Sign in to read what your ring heard" } },
        signUp: { start: { title: "Index 0.1", subtitle: "Create a private inbox for your ring" } },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <TooltipProvider>
          <RoutedErrorBoundary>
            <Switch>
              <Route path="/" component={HomeRedirect} />
              <Route path="/sign-in/*?" component={SignInPage} />
              <Route path="/sign-up/*?" component={SignUpPage} />
              <Route component={Fallback} />
            </Switch>
          </RoutedErrorBoundary>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}

export default App;
