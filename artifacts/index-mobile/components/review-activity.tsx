import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import type { ReviewRule, ReviewRun, ReviewSource } from '@workspace/api-client-react';
import { useReviewRuleActivity, RUN_LABEL, SOURCE_LABEL, OVERVIEW_MAX } from '@workspace/api-client-react';
import { Copy, Button, s, c } from '@/components/ui';
import { TaskTitleField as GrowingTextField } from '@/components/task-title-field';

const when = (v: string) => new Date(v).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

function SourceRef({ src, rules }: { src: ReviewSource; rules: ReviewRule[] }) {
  const text = `${SOURCE_LABEL[src.kind]}: ${src.label}`;
  const open = src.kind === 'message' ? () => router.push({ pathname: '/inbox', params: { focus: src.id } })
    : src.kind === 'review' && rules.some(r => r.id === src.id) ? () => router.push({ pathname: '/settings-rule', params: { id: src.id } }) : null;
  if (!open) return <Text style={s.muted}>{text}</Text>;
  return <Pressable accessibilityRole="link" onPress={open}><Text style={[s.muted, { color: c.foreground }]}>{text}</Text></Pressable>;
}

function Run({ run, rule, rules, onUndo, undoing }: { run: ReviewRun; rule: ReviewRule; rules: ReviewRule[]; onUndo: (id: string) => void; undoing: boolean }) {
  return <View style={[s.card, { gap: 8 }]} testID={`run-${run.id}`}>
    <Text style={[s.muted, run.status === 'failed' && { color: c.destructive }]}>{RUN_LABEL[run.status]} · {when(run.createdAt)}{run.ruleRevision !== rule.revision ? ' · earlier version' : ''}</Text>
    <Text style={s.muted}>Window {when(run.windowStart)} to {when(run.windowEnd)}</Text>
    {!!run.error && <Text style={s.error}>{run.error}</Text>}
    {!!run.report && <Copy selectable>{run.report}</Copy>}
    {run.changedTaskIds.length > 0 && <View style={s.between}>
      <Text style={s.muted}>{run.changedTaskIds.length} task{run.changedTaskIds.length > 1 ? 's' : ''} changed{run.undoneAt ? ` · undone ${when(run.undoneAt)}` : ''}</Text>
      {!run.undoneAt && <Button label="Undo" quiet disabled={undoing} testID={`button-undo-${run.id}`} onPress={() => onUndo(run.id)} />}
    </View>}
    {run.sources.length > 0 && <View style={{ gap: 2 }}>{run.sources.map(x => <SourceRef key={`${x.kind}-${x.id}`} src={x} rules={rules} />)}</View>}
  </View>;
}

export function ReviewActivity({ accountId, rule, rules, disabled }: { accountId: string; rule: ReviewRule; rules: ReviewRule[]; disabled: boolean }) {
  const a = useReviewRuleActivity(accountId, rule);
  const o = a.overview;
  const latestFailed = a.all[0]?.status === 'failed';
  return <>
    {rule.output === 'overview' && <View style={{ gap: 8 }}>
      <View style={s.between}><Text style={[s.subheading, { fontSize: 22, lineHeight: 28 }]}>Overview</Text><Text style={s.muted}>{o.saving ? 'Saving…' : o.dirty ? 'Unsaved' : o.saved ? 'Saved' : ''}</Text></View>
      {!!o.error && <Text accessibilityRole="alert" style={s.error}>{o.error}</Text>}
      {o.stale && <Text style={s.muted} testID="text-overview-stale">A newer overview arrived while you were editing. Revert to see it, or save to try your version.</Text>}
      <GrowingTextField testID="input-overview" accessibilityLabel="Overview" placeholder="Empty until the first run." value={o.text} onChangeText={o.set} />
      {o.text.length > OVERVIEW_MAX * 0.8 && <Text style={[s.muted, o.text.length > OVERVIEW_MAX && { color: c.destructive }]}>{o.text.length}/{OVERVIEW_MAX}</Text>}
      <Button label="Save overview" testID="button-save-overview" disabled={!o.dirty || o.saving} onPress={() => void o.save()} />
      {o.dirty && <Button label="Revert overview" quiet onPress={o.discard} />}
    </View>}
    <Text style={[s.subheading, { fontSize: 22, lineHeight: 28 }]}>History</Text>
    {!!a.error && <Text accessibilityRole="alert" style={s.error}>{a.error}</Text>}
    <Button label={a.running ? 'Starting…' : disabled ? 'Save changes to run' : latestFailed ? 'Retry' : 'Run now'} testID="button-run-now" quiet disabled={disabled || a.running} onPress={() => void a.runNow()} />
    {a.runs.isLoading && <Text style={s.muted}>Loading history…</Text>}
    {a.runs.isError && <Button label="Could not load history. Retry" quiet onPress={() => void a.runs.refetch()} />}
    {a.runs.isSuccess && a.all.length === 0 && <Text style={s.muted}>No runs yet.</Text>}
    {a.all.map(r => <Run key={r.id} run={r} rule={rule} rules={rules} undoing={a.undoing} onUndo={id => void a.undoRun(id)} />)}
    {a.hasMore && <Button label={a.loadingMore ? 'Loading…' : 'Older runs'} quiet disabled={a.loadingMore} onPress={() => void a.loadMore()} />}
  </>;
}
