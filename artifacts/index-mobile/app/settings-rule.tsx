import { useState } from 'react';
import { Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { useReviewRuleForm, seedNewRuleDraft, TRIGGERS, OUTPUTS, RULE_PROMPT_MAX, RULE_INPUT_MAX, triggerHint } from '@workspace/api-client-react';
import type { ReviewRuleInput } from '@workspace/api-client-react';
import { Page, Field, Skeleton, Failure, Button, Confirm, IconButton, Chips, s, c } from '@/components/ui';
import { TaskTitleField as GrowingTextField } from '@/components/task-title-field';
import { ReviewActivity } from '@/components/review-activity';

const toNum = (t: string) => (t.trim() === '' ? NaN : Math.trunc(Number(t)));

export default function Rule() {
  const params = useLocalSearchParams<{ id?: string }>();
  const id = typeof params.id === 'string' && params.id && params.id !== 'new' ? params.id : null;
  const { userId } = useAuth();
  const f = useReviewRuleForm(userId, id);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { values: v, dirty, rule } = f;

  function leave() { f.discard(); if (router.canGoBack()) router.back(); else router.replace('/settings-prompts'); }
  const back = <IconButton name="chevron-left" label="Back to prompts" onPress={() => (dirty ? setConfirmLeave(true) : leave())} />;
  const title = id ? 'Rule' : 'New rule';

  if (!userId || (id && f.query.isLoading)) return <Page compact title={title} action={back}><Skeleton /></Page>;
  if (id && (f.query.isError || !rule)) return <Page compact title={title} action={back}><Failure error={f.query.error} retry={() => void f.query.refetch()} /></Page>;
  if (!v) return null;
  const set = f.set;

  async function save() {
    const next = await f.save();
    if (next && !id) router.replace({ pathname: '/settings-rule', params: { id: next.id } });
  }
  function duplicate() {
    if (!userId || !v) return;
    seedNewRuleDraft(userId, v);
    router.push('/settings-rule');
  }
  async function destroy() { if (await f.destroy()) { setConfirmDelete(false); leave(); } }

  const usedBy = id ? f.otherRules.filter(r => r.inputRuleIds.includes(id)) : [];
  const trigger = TRIGGERS.find(t => t.value === v.trigger)!;
  const output = OUTPUTS.find(o => o.value === v.output)!;

  return <Page compact title={title} eyebrow="Settings / Prompts" action={back} keyboardDismissMode="none">
    <Text accessibilityRole="alert" style={f.error || (dirty && f.invalid) ? s.error : s.muted}>{f.error || (dirty && f.invalid) || (f.saving ? 'Saving…' : dirty ? 'Unsaved' : f.saved ? 'Saved' : ' ')}</Text>
    <Field testID="input-rule-name" accessibilityLabel="Rule name" placeholder="Rule name" maxLength={120} value={v.name} onChangeText={t => set('name', t)} />
    <View style={s.between}><Text style={s.label}>Status</Text><Chips values={['off', 'on'] as const} value={v.enabled ? 'on' : 'off'} onChange={x => set('enabled', x === 'on')} /></View>

    <View style={{ gap: 8 }}>
      <View style={s.between}><Text style={s.label}>Prompt</Text>{v.prompt.length > RULE_PROMPT_MAX * 0.8 && <Text style={[s.muted, v.prompt.length > RULE_PROMPT_MAX && { color: c.destructive }]}>{v.prompt.length}/{RULE_PROMPT_MAX}</Text>}</View>
      <GrowingTextField testID="input-rule-prompt" accessibilityLabel="Prompt" placeholder="What should this rule look for, and what should it write?" value={v.prompt} onChangeText={t => set('prompt', t)} />
    </View>

    <View style={{ gap: 8 }}>
      <Text style={s.label}>When</Text>
      <Chips values={TRIGGERS.map(t => t.label)} value={trigger.label} onChange={l => set('trigger', TRIGGERS.find(t => t.label === l)!.value)} />
      {v.trigger === 'quiet' && <Field testID="input-quiet-minutes" accessibilityLabel="Quiet minutes" keyboardType="number-pad" value={Number.isFinite(v.quietMinutes) ? String(v.quietMinutes) : ''} onChangeText={t => set('quietMinutes', toNum(t))} />}
      {v.trigger === 'hourly' && <Field testID="input-interval-hours" accessibilityLabel="Interval hours" keyboardType="number-pad" value={Number.isFinite(v.intervalHours) ? String(v.intervalHours) : ''} onChangeText={t => set('intervalHours', toNum(t))} />}
      {v.trigger === 'daily' && <View style={s.row}>
        <Field style={{ flex: 1 }} testID="input-daily-time" accessibilityLabel="Daily time HH:mm" placeholder="HH:mm" value={v.dailyTime} onChangeText={t => set('dailyTime', t)} />
        <Field style={{ flex: 2 }} testID="input-timezone" accessibilityLabel="Timezone" autoCapitalize="none" value={v.timezone} onChangeText={t => set('timezone', t)} />
      </View>}
      <Text style={s.muted}>{triggerHint(v.trigger)}{v.trigger === 'quiet' ? ' Minutes shown above.' : v.trigger === 'hourly' ? ' Hours shown above.' : ''}</Text>
    </View>

    <View style={{ gap: 8 }}>
      <Text style={s.label}>Reads · look back hours</Text>
      <Field testID="input-lookback" accessibilityLabel="Look back hours" keyboardType="number-pad" value={Number.isFinite(v.lookbackHours) ? String(v.lookbackHours) : ''} onChangeText={t => set('lookbackHours', toNum(t))} />
      <View style={s.between}><Text style={s.muted}>Messages</Text><Chips values={['off', 'on'] as const} value={v.includeMessages ? 'on' : 'off'} onChange={x => set('includeMessages', x === 'on')} /></View>
      <View style={s.between}><Text style={s.muted}>Tasks</Text><Chips values={['off', 'on'] as const} value={v.includeTasks ? 'on' : 'off'} onChange={x => set('includeTasks', x === 'on')} /></View>
      {f.otherRules.length > 0 && <>
        <Text style={s.muted}>Plus output from other rules (max {RULE_INPUT_MAX}). Loops are rejected on save.</Text>
        {f.otherRules.map(r => { const on = v.inputRuleIds.includes(r.id); return <View key={r.id} style={s.between}>
          <Text style={[s.muted, { flex: 1 }]} numberOfLines={1}>{r.name}</Text>
          <Chips values={['off', 'on'] as const} value={on ? 'on' : 'off'} onChange={x => { if ((x === 'on') === on) return; if (x === 'on' && v.inputRuleIds.length >= RULE_INPUT_MAX) return; set('inputRuleIds', on ? v.inputRuleIds.filter(i => i !== r.id) : [...v.inputRuleIds, r.id]); }} />
        </View>; })}
      </>}
    </View>

    <View style={{ gap: 8 }}>
      <Text style={s.label}>Writes</Text>
      <Chips values={OUTPUTS.map(o => o.label)} value={output.label} onChange={l => set('output', OUTPUTS.find(o => o.label === l)!.value as ReviewRuleInput['output'])} />
      <Text style={v.output === 'tasks' ? s.text : s.muted} testID="text-output-hint">{output.hint}</Text>
    </View>

    <Button label={f.saving ? 'Saving…' : id ? 'Save' : 'Create'} testID="button-save-rule" disabled={!f.canSave} onPress={() => void save()} />
    {id && dirty && <Button label="Revert changes" quiet onPress={f.discard} />}
    {id && <Button label="Duplicate" quiet testID="button-duplicate-rule" onPress={duplicate} />}
    {id && <Button label="Delete rule" quiet danger testID="button-delete-rule" onPress={() => setConfirmDelete(true)} />}

    {rule && <ReviewActivity accountId={userId} rule={rule} rules={f.rules.data ?? []} disabled={dirty} />}

    {confirmLeave && <Confirm title="Discard changes" message="Your unsaved rule edits will be lost." onClose={() => setConfirmLeave(false)} onConfirm={() => { setConfirmLeave(false); leave(); }} />}
    {confirmDelete && <Confirm title="Delete rule" pending={f.deleting} error={f.error || undefined}
      message={`Its reports, overview, and run history are deleted. Your messages and tasks are not touched.${usedBy.length ? ` This rule is an input to ${usedBy.map(r => r.name).join(', ')}; remove it there first.` : ''}`}
      onClose={() => setConfirmDelete(false)} onConfirm={destroy} />}
  </Page>;
}
