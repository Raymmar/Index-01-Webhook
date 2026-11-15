import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { useAuth } from '@clerk/expo';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { IconButton, s, c, errorMessage } from './ui';
import { origin } from '@/lib/session';

const time = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
export function Recording({ url }: { url: string }) {
  const { getToken } = useAuth();
  const player = useAudioPlayer(null);
  const status = useAudioPlayerStatus(player);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const blob = useRef<string | null>(null);
  const loaded = useRef(false);
  const bearer = useRef<string | null>(null);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; if (blob.current) URL.revokeObjectURL(blob.current); }; }, []);
  async function toggle() {
    if (status.playing) { player.pause(); return; }
    setBusy(true); setError('');
    try {
      if (Platform.OS !== 'web') {
        // Expo Go shares the device audio session. Configure media playback
        // explicitly so the iPhone silent switch does not mute voice notes.
        await setAudioModeAsync({
          playsInSilentMode: true,
          allowsRecording: false,
          shouldRouteThroughEarpiece: false,
          interruptionMode: 'doNotMix',
        });
      }
      const uri = new URL(url, origin).href;
      if (new URL(uri).origin !== origin) throw new Error('This recording is not hosted by your Index server.');
      const token = await getToken({ skipCache: true });
      if (!token) throw new Error('Sign in again to play this recording.');
      if (!active.current) return;
      if (!loaded.current || !!status.error || (Platform.OS !== 'web' && bearer.current !== token)) {
        const position = player.currentTime;
        if (Platform.OS === 'web') {
          // HTMLAudioElement cannot send Authorization. Fetch the authenticated bytes,
          // then play an in-memory object URL. Never put a bearer in the URL.
          const response = await fetch(uri, { headers: { Authorization: `Bearer ${token}` }, credentials: 'omit' });
          if (!response.ok) throw new Error(`Could not load recording (${response.status}).`);
          const bytes = await response.blob();
          if (!active.current) return;
          if (blob.current) URL.revokeObjectURL(blob.current);
          blob.current = URL.createObjectURL(bytes);
          player.replace({ uri: blob.current });
        } else player.replace({ uri, headers: { Authorization: `Bearer ${token}` } });
        loaded.current = true; bearer.current = token;
        if (position > 0) await player.seekTo(position);
      }
      if (!active.current) return;
      if (status.didJustFinish || (status.duration > 0 && status.currentTime >= status.duration)) await player.seekTo(0);
      player.play();
    } catch (e) { if (active.current) { loaded.current = false; setError(errorMessage(e)); } }
    finally { if (active.current) setBusy(false); }
  }
  const ratio = status.duration ? Math.max(0, Math.min(1, status.currentTime / status.duration)) : 0;
  return <View style={{ gap: 6 }}><View style={[s.row, { backgroundColor: c.secondary, borderRadius: 8, padding: 7, gap: 8 }]}>
    <IconButton name={status.playing ? 'pause' : 'play'} label={status.playing ? 'Pause recording' : 'Play recording'} disabled={busy} onPress={() => void toggle()} />
    <Pressable accessibilityRole="adjustable" accessibilityLabel="Restart recording" onPress={() => { if (loaded.current) void player.seekTo(0); }} style={{ flex: 1, height: 35, justifyContent: 'center' }}><View style={{ height: 3, backgroundColor: c.border, borderRadius: 2 }}><View style={{ width: `${ratio * 100}%`, height: 3, backgroundColor: c.accent }} /></View></Pressable>
    <Text style={[s.muted, { fontVariant: ['tabular-nums'], minWidth: 68, textAlign: 'right' }]}>{busy ? 'Loading…' : `${time(status.currentTime)} / ${time(status.duration)}`}</Text>
  </View>{!!(error || status.error) && <Text accessibilityRole="alert" style={s.error}>{error || status.error} Tap play to retry.</Text>}</View>;
}
