import { Link } from "wouter";
import { Logo } from "@/components/shell";

export default function Home() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-6">
      <div className="ri-in w-full max-w-sm">
        <Logo className="h-10 w-10" />
        <h1 className="mt-6 font-display text-5xl leading-none">Index 0.1</h1>
        <p className="mt-4 text-muted-foreground">A private place where what you say into your Pebble Index ring lands as raw, inspectable events.</p>
        <div className="mt-8 flex gap-2">
          <Link href="/sign-in" data-testid="link-sign-in" className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:opacity-90">Sign in</Link>
          <Link href="/sign-up" data-testid="link-sign-up" className="rounded-md border border-border px-4 py-2 text-sm hover:bg-secondary">Create account</Link>
        </div>
      </div>
    </div>
  );
}
