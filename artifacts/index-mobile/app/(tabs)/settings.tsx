import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, Switch, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useAuth, useUser } from '@clerk/expo';
import { useQueryClient } from '@tanstack/react-query';
import { useGetSettings, useUpdateSettings, getGetSettingsQueryKey, type SettingsUpdate } from '@workspace/api-client-react';
import { Page, Copy, Skeleton, Failure, Button, Field, Sheet, Confirm, s, c, errorMessage } from '@/components/ui';
import { deviceZone } from '@/lib/session';

export default function Settings() {
  const q = useGetSettings();
  const update = useUpdateSettings();
  const qc = useQueryClient();
  const { signOut } = useAuth();
  const { user } = useUser();
  const [zoneSheet, setZoneSheet] = useState(false);
  const [search, setSearch] = useState('');
  const [timezone, setTimezone] = useState('');
  const [model, setModel] = useState('');
  const [custom, setCustom] = useState(false);
  const [modelSheet, setModelSheet] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [error, setError] = useState('');
  const [providerError, setProviderError] = useState('');
  const [notice, setNotice] = useState('');
  const initialized = useRef(false);
  const settings = q.data;
  useEffect(() => { if (settings && !initialized.current) { initialized.current = true; setTimezone(settings.timezone ?? deviceZone()); setModel(settings.aiModel); } }, [settings]);
  const zones = useMemo(() => {
    const supported = (Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.('timeZone') ?? [];
    return [...new Set([deviceZone(), 'UTC', ...supported, 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London', 'Europe/Paris', 'Asia/Tokyo', 'Asia/Kolkata', 'Australia/Sydney'])];
  }, []);
  function save(data: SettingsUpdate, done?: () => void) {
    setError(''); setNotice(''); if (data.aiProvider) setProviderError('');
    update.mutate({ data }, { onSuccess: next => { qc.setQueryData(getGetSettingsQueryKey(), next); if (data.aiProvider) { setModel(next.aiModel); setCustom(false); } if (data.timezone) setTimezone(next.timezone ?? deviceZone()); setNotice('Saved'); done?.(); }, onError: e => data.aiProvider ? setProviderError(errorMessage(e)) : setError(errorMessage(e)) });
  }
  if (q.isLoading) return <Page title="Settings"><Skeleton /></Page>;
  if (!settings || q.isError) return <Page title="Settings"><Failure error={q.error} retry={() => void q.refetch()} /></Page>;
  const choices = settings.availableModels ?? [];
  return <Page title="Settings" eyebrow="Index 0.1 / Account">
    <View style={[s.row, { marginVertical: 6 }]}><View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: c.secondary, alignItems: 'center', justifyContent: 'center' }}><Text style={[s.subheading, { fontSize: 25 }]}>{(user?.firstName ?? user?.primaryEmailAddress?.emailAddress ?? 'I').slice(0, 1).toUpperCase()}</Text></View><View style={{ flex: 1 }}><Copy>{user?.fullName ?? 'Your account'}</Copy><Text numberOfLines={1} style={s.muted}>{user?.primaryEmailAddress?.emailAddress}</Text></View>{settings.isOwner && <Text style={[s.label, { color: c.accent }]}>Owner</Text>}</View>
    {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}{!!notice && <Text accessibilityRole="alert" style={s.muted}>{notice}</Text>}
    <Text style={s.label}>Dates & time</Text><View style={s.card}><Copy>Timezone</Copy><Text style={s.muted}>Task dates use this zone.</Text><Button quiet label={(settings.timezone ?? deviceZone()).replaceAll('_', ' ')} disabled={update.isPending} onPress={() => { setSearch(''); setTimezone(settings.timezone ?? deviceZone()); setZoneSheet(true); }} /></View>
    <Text style={s.label}>Extraction</Text><Pressable testID="link-prompts" accessibilityRole="button" onPress={() => router.push('/settings-prompts')} style={({ pressed }) => [s.card, s.between, { opacity: pressed ? 0.6 : 1 }]}><Copy>Prompts</Copy><Text style={s.muted}>Edit</Text></Pressable>
    {settings.isOwner && <>
      <Text style={s.label}>Access</Text><View style={s.card}><View style={s.between}><Copy style={{ flex: 1 }}>Allow additional users</Copy><Switch accessibilityLabel="Allow additional users" value={settings.allowSignups} disabled={update.isPending} trackColor={{ false: c.border, true: c.accent }} thumbColor={c.card} onValueChange={value => save({ allowSignups: value })} /></View><Text style={s.muted}>Each account keeps a private inbox.</Text></View>
      <Text style={s.label}>Understanding</Text><View style={s.card}><Copy>Provider</Copy><View style={{ gap: 8 }}>{(['replit', 'openai'] as const).map(provider => <Button key={provider} label={`${settings.aiProvider === provider ? 'Selected · ' : ''}${provider === 'replit' ? 'Replit managed' : 'OpenAI direct'}`} quiet disabled={update.isPending} onPress={() => { if (provider !== settings.aiProvider) save({ aiProvider: provider, aiModel: 'gpt-5-mini' }); }} />)}</View>
        {(providerError || (settings.aiProvider === 'openai' && !settings.directKeyConfigured) || (settings.aiProvider === 'replit' && !settings.managedConfigured)) ? <Text accessibilityRole="alert" style={s.error}>{providerError || (settings.aiProvider === 'openai' ? 'Set OPENAI_API_KEY in server secrets first.' : 'Replit AI Integrations is not configured on the server.')}</Text> : <Text style={s.muted}>{settings.aiProvider === 'openai' ? 'Server key is configured.' : 'Managed integration is configured.'}</Text>}
        <View style={s.divider} /><Copy>Model</Copy><Button label={settings.aiModel} quiet disabled={update.isPending} onPress={() => { setModel(settings.aiModel); setCustom(settings.aiProvider === 'openai' && !choices.includes(settings.aiModel)); setModelSheet(true); }} />
      </View>
    </>}
    <Button label="Sign out" quiet onPress={() => { setError(''); setConfirmSignOut(true); }} /><Text style={[s.muted, { textAlign: 'center' }]}>Index 0.1</Text>
    {zoneSheet && <Sheet visible title="Timezone" onClose={() => { if (!update.isPending) setZoneSheet(false); }}><Field accessibilityLabel="Search timezones" placeholder="Search timezones" value={search} onChangeText={setSearch} autoCapitalize="none" /><Field accessibilityLabel="IANA timezone" value={timezone} onChangeText={setTimezone} autoCapitalize="none" placeholder="America/New_York" /><Button label={update.isPending ? 'Saving…' : 'Save timezone'} disabled={update.isPending || !timezone.trim()} onPress={() => { try { new Intl.DateTimeFormat('en', { timeZone: timezone.trim() }).format(); save({ timezone: timezone.trim() }, () => setZoneSheet(false)); } catch { setError('Enter a valid IANA timezone.'); } }} />{!!error && <Text style={s.error}>{error}</Text>}<Button label={`Use device · ${deviceZone()}`} quiet disabled={update.isPending} onPress={() => save({ timezone: deviceZone() }, () => setZoneSheet(false))} />{zones.filter(z => z.toLowerCase().includes(search.toLowerCase().replaceAll(' ', '_'))).map(z => <Pressable key={z} accessibilityRole="button" onPress={() => setTimezone(z)} style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: c.border }}><Copy style={{ color: z === timezone ? c.accent : c.foreground }}>{z.replaceAll('_', ' ')}</Copy></Pressable>)}</Sheet>}
    {modelSheet && <Sheet visible title="Model" onClose={() => { if (!update.isPending) setModelSheet(false); }}>{choices.map(choice => <Button key={choice} label={`${!custom && choice === model ? 'Selected · ' : ''}${choice}`} quiet onPress={() => { setModel(choice); setCustom(false); }} disabled={update.isPending} />)}{settings.aiProvider === 'openai' && <><Button label="Custom model" quiet onPress={() => { setCustom(true); setModel(''); }} />{custom && <Field accessibilityLabel="Custom OpenAI model" placeholder="OpenAI model ID" autoCapitalize="none" autoCorrect={false} maxLength={100} value={model} onChangeText={setModel} />}</>}{!!error && <Text style={s.error}>{error}</Text>}<Button label={update.isPending ? 'Saving…' : 'Save model'} disabled={update.isPending || !model.trim() || (settings.aiProvider === 'replit' && !choices.includes(model))} onPress={() => save({ aiModel: model.trim() }, () => setModelSheet(false))} /></Sheet>}
    {confirmSignOut && <Confirm title="Sign out" message="Your messages stay in your account. Any one-time webhook credentials on this device will be forgotten." pending={signingOut} error={error || undefined} onClose={() => setConfirmSignOut(false)} onConfirm={() => { setSigningOut(true); void signOut().catch(e => { setError(errorMessage(e)); setSigningOut(false); }); }} />}
  </Page>;
}
