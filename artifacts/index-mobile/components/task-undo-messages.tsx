import { useEffect } from 'react';
import { AccessibilityInfo, Platform, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, IconButton, s } from './ui';
import type { useTaskUndo } from '../hooks/use-task-undo';

type Undo = ReturnType<typeof useTaskUndo>;
function UndoMessage({ notice, undo }: { notice: Undo['notices'][number]; undo: Undo }) {
  const text = notice.state === 'restored' ? `Restored “${notice.item.title}”.`
    : notice.state === 'expired' ? `Undo expired for “${notice.item.title}”.`
    : notice.state === 'restoring' ? `Restoring “${notice.item.title}”…`
    : `Deleted “${notice.item.title}”. Undo available for 15 seconds.`;
  useEffect(() => {
    if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(notice.error || text);
  }, [text, notice.error]);
  return <View testID={`task-undo-message-${notice.item.id}`} style={s.card}>
    <Text accessibilityLiveRegion="polite" style={s.text}>{text}</Text>
    {!!notice.error && <Text accessibilityRole="alert" style={s.error}>{notice.error}</Text>}
    <View style={s.between}>
      {(notice.state === 'ready' || notice.state === 'restoring') && <Button testID={`undo-task-${notice.item.id}`} label={notice.state === 'restoring' ? 'Restoring…' : 'Undo'} disabled={notice.state === 'restoring'} onPress={() => void undo.undo(notice.item.id)} />}
      <IconButton name="x" label={`Close deletion message for ${notice.item.title}`} disabled={notice.state === 'restoring'} onPress={() => undo.dismiss(notice.item.id)} />
    </View>
  </View>;
}
export function TaskUndoMessages({ undo }: { undo: Undo }) {
  const insets = useSafeAreaInsets();
  if (!undo.notices.length) return null;
  return <View pointerEvents="box-none" style={{ position: 'absolute', left: 16, right: 16, bottom: 90 + insets.bottom, maxHeight: 260 }}>
    <ScrollView contentContainerStyle={{ gap: 8 }} keyboardShouldPersistTaps="handled">
      {undo.notices.map(notice => <UndoMessage key={notice.item.id} notice={notice} undo={undo} />)}
    </ScrollView>
  </View>;
}
