import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { MoreVertical, RotateCw, Trash2 } from "lucide-react";
import { useListWebhooks, getListWebhooksQueryKey, useCreateWebhook, useRotateWebhook, useRevokeWebhook, type WebhookCredentials, type Webhook } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { CopyField } from "@/components/shell";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";

const url = (w: Webhook) => window.location.origin + w.path;
const urlLabel = import.meta.env.DEV ? "Preview URL (dev)" : "Webhook URL";

function Instructions({ creds }: { creds: WebhookCredentials }) {
  return (
    <div className="ri-in rounded-lg border border-accent/50 bg-card p-5" data-testid="panel-credentials">
      <p className="text-sm"><span className="font-medium text-accent">Shown once.</span> This header value lives only in this tab. Copy it now; if lost, rotate to get a new one.</p>
      <ol className="mt-5 space-y-4 text-sm">
        <li><div className="mb-2 text-muted-foreground">1. Webhook URL</div><CopyField label={urlLabel} value={url(creds.webhook)} testId="url" masked /></li>
        <li className="text-muted-foreground">2. Payload (optional) can stay empty.</li>
        <li><div className="mb-2 text-muted-foreground">3. Headers</div>
          <div className="grid gap-3"><CopyField label="Name" value={creds.headerName} testId="header-name" /><CopyField label="Value" value={creds.headerValue} testId="header-value" secret /></div></li>
        <li className="text-muted-foreground">4. Sign requests: leave off.</li>
        <li className="text-muted-foreground">5. Press Send test event, then check the Inbox.</li>
      </ol>
      <p className="mt-5 border-t border-border pt-4 text-xs leading-relaxed text-muted-foreground">
        The setup screen sends click JSON. Voice recordings need a recording webhook set to send both audio and transcription; a click test does not guarantee recordings arrive. {import.meta.env.DEV && "This preview URL only works while the dev environment runs; for always-on delivery, create a webhook from the published app."}
      </p>
    </div>
  );
}

export default function Webhooks() {
  const qc = useQueryClient();
  const list = useListWebhooks({ query: { queryKey: getListWebhooksQueryKey() } });
  const create = useCreateWebhook();
  const rotate = useRotateWebhook();
  const revoke = useRevokeWebhook();
  const [name, setName] = useState("Pebble Index");
  const [creds, setCreds] = useState<WebhookCredentials | null>(null);
  const [confirm, setConfirm] = useState<{ kind: "rotate" | "revoke"; webhook: Webhook } | null>(null);
  const [notice, setNotice] = useState("");
  const pending = rotate.isPending || revoke.isPending;
  const done = { onSuccess: (c: WebhookCredentials) => { setCreds(c); qc.invalidateQueries({ queryKey: getListWebhooksQueryKey() }); } };

  return (
    <div className="space-y-8">
      <h1 className="font-display text-3xl">Webhooks</h1>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) create.mutate({ data: { name: name.trim() } }, done); }}>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Webhook name" data-testid="input-name"
          className="flex-1 rounded-md border border-input bg-card px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
        <button disabled={create.isPending || !name.trim()} data-testid="button-create" className="rounded-md bg-primary px-4 text-sm text-primary-foreground disabled:opacity-50">
          {create.isPending ? "Creating..." : "Create webhook"}
        </button>
      </form>
      {(create.isError || rotate.isError) && <p className="text-sm text-destructive">Request failed. Try again.</p>}
      {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
      {creds && <Instructions creds={creds} />}
      <section>
        <h2 className="mb-3 text-xs uppercase tracking-wider text-muted-foreground">Your webhooks</h2>
        {list.isLoading ? <Skeleton className="h-20 w-full" /> : list.isError ? (
          <div className="text-sm">Could not load webhooks. <button className="underline" data-testid="button-retry" onClick={() => list.refetch()}>Retry</button></div>
        ) : !list.data?.length ? (
          <p className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">None yet. Create one above to get a URL and header for the ring app.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-card">
            {list.data.map((w) => (
              <li key={w.id} className="p-4" data-testid={`row-webhook-${w.id}`}>
                <div className="flex items-center gap-3">
                  <span className="font-medium">{w.name}</span>
                  <span className="text-xs text-muted-foreground">{w.eventCount} events · {w.lastReceivedAt ? `last ${formatDistanceToNow(new Date(w.lastReceivedAt), { addSuffix: true })}` : "nothing received"}</span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button type="button" disabled={pending} aria-label={`Actions for ${w.name}`} data-testid={`button-actions-${w.id}`} className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
                        <MoreVertical className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="border-border">
                      <DropdownMenuItem data-testid={`button-delete-${w.id}`} className="text-destructive focus:bg-destructive/10 focus:text-destructive" onSelect={() => { rotate.reset(); revoke.reset(); setNotice(""); setConfirm({ kind: "revoke", webhook: w }); }}>
                        <Trash2 className="h-4 w-4" aria-hidden="true" />Delete
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem data-testid={`button-rotate-${w.id}`} className="focus:bg-secondary focus:text-foreground" onSelect={() => { rotate.reset(); revoke.reset(); setNotice(""); setConfirm({ kind: "rotate", webhook: w }); }}>
                        <RotateCw className="h-4 w-4" aria-hidden="true" />Rotate
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <div className="mt-3"><CopyField label={urlLabel} value={url(w)} testId={`url-${w.id}`} masked /></div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && !pending && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm?.kind === "revoke" ? "Delete webhook" : "Rotate token"} for {confirm?.webhook.name}?</AlertDialogTitle>
            <AlertDialogDescription>{confirm?.kind === "revoke"
              ? "This removes the webhook from this list and permanently revokes its URL and token. Future ring deliveries to it will be rejected. Existing recordings and transcripts stay in your inbox. To receive new events afterward, create a new webhook and update the ring app."
              : "The previous Authorization value stops working immediately. You will need to paste the new value into the ring app."}</AlertDialogDescription>
          </AlertDialogHeader>
          {(revoke.isError || rotate.isError) && <p role="alert" className="text-sm text-destructive">Could not {confirm?.kind === "revoke" ? "revoke the webhook" : "rotate the token"}. Nothing was removed from your inbox. Please try again.</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={pending} data-testid={confirm?.kind === "revoke" ? "button-confirm-revoke" : "button-confirm-rotate"}
              className={confirm?.kind === "revoke" ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : ""}
              onClick={(event) => {
                event.preventDefault();
                if (!confirm || pending) return;
                const { webhook, kind } = confirm;
                if (kind === "revoke") {
                  revoke.mutate({ id: webhook.id }, { onSuccess: () => {
                    setCreds((current) => current?.webhook.id === webhook.id ? null : current);
                    setConfirm(null);
                    setNotice("Webhook revoked. Existing recordings and transcripts are still in your inbox.");
                    qc.invalidateQueries({ queryKey: getListWebhooksQueryKey() });
                  } });
                } else {
                  rotate.mutate({ id: webhook.id }, { onSuccess: (credentials) => { done.onSuccess(credentials); setConfirm(null); } });
                }
              }}>{pending ? (confirm?.kind === "revoke" ? "Deleting…" : "Rotating…") : confirm?.kind === "revoke" ? "Delete webhook" : "Rotate"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
