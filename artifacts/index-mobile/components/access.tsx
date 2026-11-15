import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Text } from 'react-native';
import { useAuth, useSession } from '@clerk/expo';
import { useQueryClient } from '@tanstack/react-query';
import { useGetSettings, useUpdateSettings, getGetSettingsQueryKey } from '@workspace/api-client-react';
import { Page, Skeleton, Failure, Empty, Button, s, errorMessage } from './ui';
import { deviceZone, LiveProvider } from '@/lib/session';

export function AccessGate({ children }: { children: ReactNode }) {
  const q = useGetSettings({ query: { queryKey: getGetSettingsQueryKey() }, request: { credentials: 'omit' } });
  const update = useUpdateSettings();
  const qc = useQueryClient();
  const { signOut } = useAuth();
  const { session } = useSession();
  const attempted = useRef(false);
  const [zoneError, setZoneError] = useState('');
  const saveRef = useRef(update.mutate); saveRef.current = update.mutate;
  useEffect(() => {
    if (q.data?.allowed && q.data.timezone === null && !attempted.current) {
      attempted.current = true;
      saveRef.current({ data: { timezone: deviceZone() } }, { onSuccess: next => qc.setQueryData(getGetSettingsQueryKey(), next), onError: e => setZoneError(errorMessage(e)) });
    }
  }, [q.data?.allowed, q.data?.timezone, qc]);
  if (q.isLoading) return <Page title="Index 0.1"><Skeleton /></Page>;
  if (q.isError || !q.data) return <Page title="Your account"><Failure error={q.error} retry={() => void q.refetch()} /><Button label="Sign out" quiet onPress={() => void signOut()} /></Page>;
  if (session?.currentTask) return <Page title="One more step"><Empty title="Account action required" text={`Complete ${session.currentTask.key} on the website, then sign in again.`} /><Button label="Sign out" onPress={() => void signOut()} /></Page>;
  if (!q.data.allowed) return <Page title="A private space"><Empty title="This account isn’t invited." text="Sign in with the account you use for Index, or ask the owner to allow sign-ups." icon="lock" /><Button label="Check access again" quiet onPress={() => void q.refetch()} /><Button label="Sign out" onPress={() => void signOut()} /></Page>;
  return <LiveProvider>{zoneError ? <Page title="Timezone"><Text style={s.error}>{zoneError}</Text><Button label="Continue with device timezone" onPress={() => setZoneError('')} /></Page> : children}</LiveProvider>;
}
