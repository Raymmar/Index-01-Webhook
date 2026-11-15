import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { formatDistanceToNow } from 'date-fns';
import { useQueryClient } from '@tanstack/react-query';
import { useListWebhooks, getListWebhooksQueryKey, useCreateWebhook, useRotateWebhook, useRevokeWebhook, type Webhook, type WebhookCredentials } from '@workspace/api-client-react';
import { Page, Copy, Button, Field, IconButton, Skeleton, Failure, Empty, Sheet, Confirm, s, c, errorMessage } from '@/components/ui';
import { origin } from '@/lib/session';

function CopyValue({ label, value, masked = false }: { label: string; value: string; masked?: boolean }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  return <View style={{ gap: 7 }}><Text style={s.label}>{label}</Text><Pressable accessibilityRole="button" accessibilityLabel={`Copy ${label}`} onPress={() => { void Clipboard.setStringAsync(value).then(() => { setCopied(true); setError(''); }).catch(e => setError(errorMessage(e))); }} style={[s.card, { padding: 12, backgroundColor: c.secondary }]}><View style={s.between}><Text style={[s.muted, { color: c.foreground, flex: 1 }]} numberOfLines={2}>{masked ? '•••• •••• •••• ••••' : value}</Text><Text style={[s.muted, { color: c.accent }]}>{copied ? 'Copied' : 'Copy'}</Text></View></Pressable>{!!error && <Text style={s.error}>{error}</Text>}</View>;
}

export default function Webhooks() {
  const list = useListWebhooks();
  const create = useCreateWebhook();
  const rotate = useRotateWebhook();
  const revoke = useRevokeWebhook();
  const qc = useQueryClient();
  const [name, setName] = useState('Pebble Index');
  const [creating, setCreating] = useState(false);
  const [credentials, setCredentials] = useState<WebhookCredentials | null>(null);
  const [confirm, setConfirm] = useState<{ kind: 'rotate' | 'revoke'; webhook: Webhook } | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const refresh = () => { void qc.invalidateQueries({ queryKey: getListWebhooksQueryKey() }); };
  const received = (creds: WebhookCredentials) => { setCredentials(creds); setCreating(false); setConfirm(null); setError(''); refresh(); };
  return <Page title="Webhooks" eyebrow="Index 0.1 / Connections" action={<IconButton name="plus" label="Create webhook" onPress={() => { setError(''); setCreating(true); }} />}>
    <Copy style={{ color: c.mutedForeground }}>Connect your ring. Keep the original.</Copy>
    {!!notice && <Text accessibilityRole="alert" style={s.muted}>{notice}</Text>}
    {credentials && <View style={[s.card, { borderColor: c.accent, gap: 18 }]}>
      <Text style={s.subheading}>Copy before you go.</Text>
      <Text style={s.muted}>Shown once. These credentials stay only in memory. If lost, rotate the token.</Text>
      <CopyValue label="Webhook URL" value={origin + credentials.webhook.path} masked />
      <CopyValue label="Header name" value={credentials.headerName} />
      <CopyValue label="Header value" value={credentials.headerValue} masked />
      <View style={s.divider} /><Text style={s.muted}>In the ring app, leave payload empty and request signing off. Send a test event, then check Inbox.</Text><Text style={s.muted}>For voice notes, configure the recording webhook to send both audio and transcription. A click test only tests JSON delivery.</Text>
      <Button label="I’ve copied the credentials" quiet onPress={() => setCredentials(null)} />
    </View>}
    <View style={s.between}><Text style={s.label}>Your webhooks</Text><Text style={s.muted}>{list.data?.length ?? '—'}</Text></View>
    {list.isLoading ? <Skeleton /> : list.isError ? <Failure error={list.error} retry={() => void list.refetch()} /> : !list.data?.length ? <><Empty title="Give your ring a home." text="Create a webhook to receive recordings and transcripts." icon="link" /><Button label="Create webhook" onPress={() => { setError(''); setCreating(true); }} /></> : list.data.map(webhook => <View key={webhook.id} style={s.card}>
      <View style={s.between}><View style={{ flex: 1, gap: 4 }}><Copy style={{ fontFamily: 'Geist_500Medium' }}>{webhook.name}</Copy><Text style={s.muted}>{webhook.eventCount} events · {webhook.lastReceivedAt ? formatDistanceToNow(new Date(webhook.lastReceivedAt), { addSuffix: true }) : 'Nothing received'}</Text></View><IconButton name="rotate-cw" label={`Rotate ${webhook.name}`} onPress={() => { setError(''); setConfirm({ kind: 'rotate', webhook }); }} /><IconButton name="trash-2" label={`Revoke ${webhook.name}`} color={c.destructive} onPress={() => { setError(''); setConfirm({ kind: 'revoke', webhook }); }} /></View>
      <CopyValue label="Webhook URL" value={origin + webhook.path} masked />
    </View>)}
    {creating && <Sheet visible title="New webhook" onClose={() => { if (!create.isPending) setCreating(false); }}><Field accessibilityLabel="Webhook name" value={name} onChangeText={setName} maxLength={80} placeholder="Webhook name" /><Text style={s.muted}>Your URL and secret header are shown after creation.</Text>{!!error && <Text style={s.error}>{error}</Text>}<Button label={create.isPending ? 'Creating…' : 'Create webhook'} disabled={create.isPending || !name.trim()} onPress={() => { setError(''); create.mutate({ data: { name: name.trim() } }, { onSuccess: received, onError: e => setError(errorMessage(e)) }); }} /></Sheet>}
    {confirm && <Confirm title={confirm.kind === 'rotate' ? 'Rotate token' : 'Revoke webhook'} message={confirm.kind === 'rotate' ? `The previous token for ${confirm.webhook.name} stops working immediately. Copy the replacement into the ring app.` : `Revoke ${confirm.webhook.name}? Future deliveries will be rejected. Existing messages and audio will not be deleted.`} error={error || undefined} pending={rotate.isPending || revoke.isPending} onClose={() => { setConfirm(null); setError(''); }} onConfirm={() => {
      setError('');
      if (confirm.kind === 'rotate') rotate.mutate({ id: confirm.webhook.id }, { onSuccess: received, onError: e => setError(errorMessage(e)) });
      else revoke.mutate({ id: confirm.webhook.id }, { onSuccess: () => { if (credentials?.webhook.id === confirm.webhook.id) setCredentials(null); setConfirm(null); refresh(); setNotice('Webhook revoked. Original messages and audio are unchanged.'); }, onError: e => setError(errorMessage(e)) });
    }} />}
  </Page>;
}
