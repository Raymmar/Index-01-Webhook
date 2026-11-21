import { useState } from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { usePromptForm, PROMPT_FIELDS, PROMPT_MAX } from '@workspace/api-client-react';
import { Page, Copy, Skeleton, Failure, Button, Confirm, IconButton, s, c } from '@/components/ui';
import { TaskTitleField as GrowingTextField } from '@/components/task-title-field';

export default function Prompts() {
  const { userId } = useAuth();
  const f = usePromptForm(userId);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [skill, setSkill] = useState(false);
  const { query: q, data, values, dirty } = f;

  function leave() { f.discard(); if (router.canGoBack()) router.back(); else router.replace('/settings'); }
  const back = <IconButton name="chevron-left" label="Back to settings" onPress={() => dirty ? setConfirmLeave(true) : leave()} />;

  if (q.isLoading || !userId) return <Page compact title="Prompts" action={back}><Skeleton /></Page>;
  if (q.isError || !data || !values) return <Page compact title="Prompts" action={back}><Failure error={q.error} retry={() => void q.refetch()} /></Page>;

  return <Page compact title="Prompts" eyebrow="Settings / Extraction" action={back} keyboardDismissMode="none">
    <Text accessibilityRole="alert" style={f.error ? s.error : s.muted}>{f.error || (f.saving ? 'Saving…' : dirty ? 'Unsaved' : f.saved ? 'Saved' : ' ')}</Text>
    {PROMPT_FIELDS.map(field => { const v = values[field.key]; return <View key={field.key} style={{ gap: 8 }}>
      <View style={s.between}><Text style={[s.subheading, { fontSize: 22, lineHeight: 28 }]}>{field.label}…</Text>{v.length > PROMPT_MAX * 0.8 && <Text style={[s.muted, v.length > PROMPT_MAX && { color: c.destructive }]}>{v.length}/{PROMPT_MAX}</Text>}</View>
      <GrowingTextField testID={`input-${field.key}`} accessibilityLabel={field.label} placeholder="(blank)" value={v} onChangeText={t => f.setField(field.key, t)} />
    </View>; })}
    <Button label={f.saving ? 'Saving…' : 'Save'} disabled={!f.canSave} onPress={() => void f.save()} />
    <Button label="Reset to defaults" quiet disabled={f.atDefaults || f.saving} onPress={f.resetToDefaults} />
    <Button label={skill ? 'Hide compiled skill' : 'Show compiled skill'} quiet onPress={() => setSkill(v => !v)} />
    {skill && <View style={s.card}>{dirty && <Text style={s.muted}>Reflects last save</Text>}<Copy selectable testID="text-skill" style={{ fontSize: 12, lineHeight: 18 }}>{data.skill}</Copy></View>}
    {confirmLeave && <Confirm title="Discard changes" message="Your unsaved prompt edits will be lost." onClose={() => setConfirmLeave(false)} onConfirm={() => { setConfirmLeave(false); leave(); }} />}
  </Page>;
}
