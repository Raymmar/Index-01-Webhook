import { Text, View } from 'react-native';
import { reloadAppAsync } from 'expo';
import { Page, Empty, Button, s } from './ui';

export type ErrorFallbackProps = { error: Error; resetError: () => void };

export function ErrorFallback({ error, resetError }: ErrorFallbackProps) {
  return <Page title="A brief interruption." eyebrow="Index 0.1"><Empty title="Your thoughts are safe." text="Something interrupted the app. Reload to return to your work." icon="refresh-cw" /><Button label="Reload Index" onPress={() => { void reloadAppAsync().catch(() => resetError()); }} /><Button label="Try this screen again" quiet onPress={resetError} />{__DEV__ && <View style={s.card}><Text selectable style={s.muted}>{error.message}</Text></View>}</Page>;
}
