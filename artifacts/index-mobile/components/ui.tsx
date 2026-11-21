import { forwardRef, useEffect, useRef, useState, type ElementRef, type ReactNode } from 'react';
import { useConfirmationPreferences, type ConfirmationPreference } from '@workspace/api-client-react';
import { Animated, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View, type GestureResponderHandlers, type TextInputProps, type TextProps, type ViewProps } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollViewCompat } from './KeyboardAwareScrollViewCompat';
import colors from '@/constants/colors';

export const c = colors.light;
export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.background },
  content: { paddingHorizontal: 22, gap: 20, paddingBottom: 28, maxWidth: 720, width: '100%', alignSelf: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  card: { backgroundColor: c.card, borderColor: c.border, borderWidth: 1, borderRadius: 8, padding: 17, gap: 12 },
  text: { fontFamily: 'Geist_400Regular', color: c.foreground, fontSize: 15, lineHeight: 23 },
  muted: { fontFamily: 'Geist_400Regular', color: c.mutedForeground, fontSize: 12, lineHeight: 18 },
  label: { fontFamily: 'Geist_500Medium', color: c.mutedForeground, fontSize: 11, letterSpacing: 1.1, textTransform: 'uppercase' },
  heading: { fontFamily: 'InstrumentSerif_400Regular', fontSize: 42, lineHeight: 47, color: c.foreground, letterSpacing: -0.5 },
  subheading: { fontFamily: 'InstrumentSerif_400Regular', fontSize: 28, lineHeight: 34, color: c.foreground },
  input: { backgroundColor: c.card, color: c.foreground, borderWidth: 1, borderColor: c.border, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 13, fontFamily: 'Geist_400Regular', fontSize: 16, minHeight: 48 },
  divider: { height: 1, backgroundColor: c.border },
  error: { color: c.destructive, fontFamily: 'Geist_400Regular', fontSize: 13, lineHeight: 20 },
  chip: { paddingVertical: 9, paddingHorizontal: 12, minHeight: 38, borderRadius: 8 },
});
export function Copy({ children, style, ...rest }: TextProps) { return <Text {...rest} style={[s.text, style]}>{children}</Text>; }
export const Field = forwardRef<ElementRef<typeof TextInput>, TextInputProps>(function Field(props, ref) { return <TextInput ref={ref} placeholderTextColor={c.mutedForeground} selectionColor={c.accent} {...props} testID={props.testID ?? `input-${(props.accessibilityLabel ?? props.placeholder ?? 'field').replaceAll(' ', '-').toLowerCase()}`} style={[s.input, props.style]} />; });
export function Button({ label, onPress, disabled, quiet, danger, testID }: { label: string; onPress: () => void; disabled?: boolean; quiet?: boolean; danger?: boolean; testID?: string }) {
  return <Pressable accessibilityRole="button" testID={testID ?? `button-${label.replaceAll(' ', '-').toLowerCase()}`} disabled={disabled} onPress={onPress} style={({ pressed }) => ({ minHeight: 46, paddingHorizontal: 16, paddingVertical: 11, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: quiet ? c.secondary : danger ? c.destructive : c.primary, opacity: disabled ? 0.4 : pressed ? 0.65 : 1 })}><Copy style={{ fontFamily: 'Geist_500Medium', fontSize: 14, color: quiet ? c.foreground : c.primaryForeground }}>{label}</Copy></Pressable>;
}
export function IconButton({ name, label, onPress, disabled, color }: { name: React.ComponentProps<typeof Feather>['name']; label: string; onPress: () => void; disabled?: boolean; color?: string }) {
  return <Pressable testID={`button-${label.replaceAll(' ', '-').toLowerCase()}`} accessibilityLabel={label} accessibilityRole="button" disabled={disabled} onPress={onPress} style={({ pressed }) => ({ minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.3 : pressed ? 0.5 : 1 })}><Feather name={name} size={21} color={color ?? c.foreground} /></Pressable>;
}
export function Page({ title, eyebrow, action, children, compact = false }: { title: string; eyebrow?: string; action?: ReactNode; children: ReactNode; compact?: boolean }) {
  const insets = useSafeAreaInsets();
  return <View style={s.screen}><KeyboardAwareScrollViewCompat contentInsetAdjustmentBehavior="never" automaticallyAdjustContentInsets={false} keyboardDismissMode="on-drag" bottomOffset={28} contentContainerStyle={[s.content, compact && { gap: 12 }, { paddingTop: (Platform.OS === 'web' ? 67 : insets.top) + (compact ? 8 : 18), paddingBottom: Platform.OS === 'web' ? 116 : 100 + insets.bottom }]}>
    <View style={{ gap: compact ? 6 : 12 }}>{eyebrow && <Text style={s.label}>{eyebrow}</Text>}<View style={s.between}><Text accessibilityRole="header" style={[s.heading, compact && { fontSize: 30, lineHeight: 36 }]}>{title}</Text>{action}</View></View>{children}
  </KeyboardAwareScrollViewCompat></View>;
}
export function Skeleton() {
  const opacity = useRef(new Animated.Value(0.35)).current;
  useEffect(() => { const loop = Animated.loop(Animated.sequence([Animated.timing(opacity, { toValue: 0.8, duration: 850, useNativeDriver: true }), Animated.timing(opacity, { toValue: 0.35, duration: 850, useNativeDriver: true })])); loop.start(); return () => loop.stop(); }, [opacity]);
  return <View accessibilityLabel="Loading" style={{ gap: 16 }}>{[90, 135, 110].map((height, i) => <Animated.View key={i} style={{ height, borderRadius: 8, backgroundColor: c.secondary, opacity }} />)}</View>;
}
export function Empty({ title, text, icon = 'inbox' }: { title: string; text?: string; icon?: React.ComponentProps<typeof Feather>['name'] }) {
  return <View style={[s.card, { paddingVertical: 38, alignItems: 'center', borderStyle: 'dashed' }]}><Feather name={icon} size={29} color={c.accent} /><Text style={[s.subheading, { textAlign: 'center' }]}>{title}</Text>{text && <Text style={[s.muted, { textAlign: 'center', maxWidth: 260 }]}>{text}</Text>}</View>;
}
export function Failure({ error, retry }: { error?: unknown; retry: () => void }) { return <View style={s.card}><Text accessibilityRole="alert" style={s.error}>{errorMessage(error)}</Text><Button label="Try again" quiet onPress={retry} /></View>; }
export function errorMessage(error: unknown): string {
  if (typeof error === 'string') return error;
  const e = error as { data?: { error?: string; message?: string }; errors?: { longMessage?: string; message?: string }[]; message?: string } | null;
  return e?.errors?.[0]?.longMessage || e?.errors?.[0]?.message || e?.data?.error || e?.data?.message || e?.message || 'Could not load. Please try again.';
}
export function Sheet({ visible, title, onClose, children, panHandlers }: { visible: boolean; title: string; onClose: () => void; children: ReactNode; panHandlers?: GestureResponderHandlers & Pick<ViewProps, 'onTouchStart' | 'onTouchMove' | 'onTouchEnd' | 'onTouchCancel'> }) {
  const insets = useSafeAreaInsets();
  return <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}><View style={s.screen}><KeyboardAwareScrollViewCompat {...panHandlers} directionalLockEnabled bottomOffset={30} contentContainerStyle={[s.content, { paddingTop: 22 + (Platform.OS === 'android' ? insets.top : Platform.OS === 'web' ? 67 : 0), paddingBottom: 32 + insets.bottom }]}><View style={s.between}><Text style={s.subheading}>{title}</Text><IconButton name="x" label="Close" onPress={onClose} /></View>{children}</KeyboardAwareScrollViewCompat></View></Modal>;
}
export function Confirm({ title, message, onConfirm, onClose, pending, error, preference }: { title: string; message: string; onConfirm: () => void | Promise<void>; onClose: () => void; pending?: boolean; error?: unknown; preference?: ConfirmationPreference | ConfirmationPreference[] }) {
  const [skip, setSkip] = useState(false);
  const [saveError, setSaveError] = useState('');
  const confirmations = useConfirmationPreferences();
  const saving = pending || confirmations.pending;
  async function submit() {
    setSaveError('');
    try {
      if (skip && preference) await confirmations.remember(preference);
      await onConfirm();
    } catch (e) { setSaveError(errorMessage(e)); }
  }
  return <Sheet visible title={title} onClose={() => { if (!saving) onClose(); }}><Copy>{message}</Copy>
    {preference && <Pressable testID="checkbox-skip-confirmation" accessibilityRole="checkbox" accessibilityState={{ checked: skip }} disabled={saving} onPress={() => setSkip(value => !value)} style={[s.row, { minHeight: 44 }]}><Feather name={skip ? 'check-square' : 'square'} size={20} color={c.foreground} /><Copy>Don't show this again</Copy></Pressable>}
    {!!(saveError || error) && <Text style={s.error}>{saveError || errorMessage(error)}</Text>}<Button label={saving ? 'Saving…' : title} danger disabled={saving} onPress={() => void submit()} /><Button label="Cancel" quiet disabled={saving} onPress={onClose} /></Sheet>;
}
export function Chips<T extends string>({ values, value, onChange }: { values: readonly T[]; value: T; onChange: (v: T) => void }) { return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 3 }}>{values.map(v => <Pressable key={v} testID={`filter-${v}`} accessibilityRole="button" accessibilityState={{ selected: v === value }} onPress={() => onChange(v)} style={[s.chip, { backgroundColor: v === value ? c.secondary : 'transparent' }]}><Copy style={{ fontSize: 12, textTransform: 'capitalize', color: v === value ? c.foreground : c.mutedForeground }}>{v}</Copy></Pressable>)}</View>; }
