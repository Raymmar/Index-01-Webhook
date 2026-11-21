import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { useListReviewRules, listRulesKey, triggerSummary, OUTPUTS } from '@workspace/api-client-react';
import { Page, Copy, Skeleton, Failure, Button, IconButton, s } from '@/components/ui';

export default function Prompts() {
  const { userId } = useAuth();
  const acct = userId ?? '';
  const q = useListReviewRules({ query: { queryKey: listRulesKey(acct), enabled: !!acct } });
  const back = <IconButton name="chevron-left" label="Back to settings" onPress={() => (router.canGoBack() ? router.back() : router.replace('/settings'))} />;
  const rules = q.data ?? [];

  return <Page compact title="Prompts" eyebrow="Settings" action={back}>
    <Text style={s.label}>Always on</Text>
    <Pressable testID="link-extraction" accessibilityRole="button" onPress={() => router.push('/settings-extraction')} style={({ pressed }) => [s.card, s.between, { opacity: pressed ? 0.6 : 1 }]}>
      <View style={{ flex: 1, gap: 2 }}><Copy>Task extraction</Copy><Text style={s.muted}>Runs on every new message. Cannot be disabled.</Text></View>
      <Text style={s.muted}>Edit</Text>
    </Pressable>
    <Text style={s.label}>Additional rules</Text>
    {(q.isLoading || !acct) && <Skeleton />}
    {q.isError && <Failure error={q.error} retry={() => void q.refetch()} />}
    {q.isSuccess && rules.length === 0 && <Text style={s.muted} testID="text-no-rules">No additional rules yet. A rule reads recent messages, tasks, or other rules' output and writes a report, keeps an overview, or tidies open tasks.</Text>}
    {rules.map(r => <Pressable key={r.id} testID={`link-rule-${r.id}`} accessibilityRole="button" onPress={() => router.push({ pathname: '/settings-rule', params: { id: r.id } })} style={({ pressed }) => [s.card, s.between, { opacity: pressed ? 0.6 : 1 }]}>
      <View style={{ flex: 1, gap: 2 }}><Copy numberOfLines={1}>{r.name}</Copy><Text style={s.muted}>{triggerSummary(r)} · {OUTPUTS.find(o => o.value === r.output)?.label}</Text></View>
      <Text style={s.muted}>{r.enabled ? 'On' : 'Off'}</Text>
    </Pressable>)}
    <Button label="New rule" testID="link-new-rule" onPress={() => router.push('/settings-rule')} />
  </Page>;
}
