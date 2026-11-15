import { useEffect, useRef, useState, createContext, useContext, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { useAuth } from '@clerk/expo';
import { useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import { fetch as streamFetch } from 'expo/fetch';
import { withStreamDeadline } from './stream-deadline';
import { setAuthTokenGetter, listEvents, getListEventsQueryKey, getGetOrganizerQueryKey, getGetSettingsQueryKey, getListWebhooksQueryKey } from '@workspace/api-client-react';

export const origin = `https://${process.env.EXPO_PUBLIC_DOMAIN}`;
export const deviceZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const LiveContext = createContext('connecting');
export const useLive = () => useContext(LiveContext);

// Children cannot mount queries until this exact identity has a bearer getter.
export function BearerBinding({ children }: { children: ReactNode }) {
  const { userId, getToken } = useAuth();
  const queryClient = useQueryClient();
  const tokenRef = useRef(getToken);
  tokenRef.current = getToken;
  const [bound, setBound] = useState<string | null>(null);
  useEffect(() => {
    queryClient.clear();
    let active = true;
    setAuthTokenGetter(async () => active ? tokenRef.current() : null);
    setBound(userId ?? null);
    return () => { active = false; setAuthTokenGetter(null); void queryClient.cancelQueries(); queryClient.clear(); };
  }, [userId, queryClient]);
  return bound && bound === userId ? children : null;
}

export function LiveProvider({ children }: { children: ReactNode }) {
  const { getToken, userId } = useAuth();
  const qc = useQueryClient();
  const tokenRef = useRef(getToken); tokenRef.current = getToken;
  const [status, setStatus] = useState('connecting');
  useEffect(() => {
    let disposed = false;
    let controller: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let generation = 0;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const refresh = () => {
      void qc.invalidateQueries({ queryKey: getListEventsQueryKey() });
      void qc.invalidateQueries({ queryKey: getGetOrganizerQueryKey() });
      void qc.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
      void qc.invalidateQueries({ queryKey: getListWebhooksQueryKey() });
      void qc.invalidateQueries({ predicate: query => typeof query.queryKey[0] === 'string' && query.queryKey[0].startsWith('/api/events/') });
    };
    const stop = () => { generation++; controller?.abort(); void reader?.cancel().catch(() => {}); if (timer) clearTimeout(timer); };
    async function connect() {
      if (disposed || AppState.currentState === 'background' || AppState.currentState === 'inactive') return;
      const ownGeneration = ++generation;
      const connection = new AbortController();
      controller = connection;
      try {
        setStatus(attempt ? 'reconnecting' : 'connecting');
        const token = await withStreamDeadline(tokenRef.current({ skipCache: true }), () => connection.abort());
        if (disposed || generation !== ownGeneration) return;
        if (!token) throw new Error('A session token is not available');
        const response = await withStreamDeadline(streamFetch(`${origin}/api/events/stream`, { headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' }, signal: connection.signal, credentials: 'omit' }), () => connection.abort());
        if (disposed || generation !== ownGeneration) { connection.abort(); return; }
        if (!response.ok) throw new Error(`Connection failed (${response.status})`);
        const streamReader = response.body?.getReader();
        if (!streamReader) throw new Error('Streaming is unavailable');
        reader = streamReader;
        const decoder = new TextDecoder();
        let buffer = '';
        while (!disposed && generation === ownGeneration) {
          const result = await withStreamDeadline(streamReader.read(), () => connection.abort());
          if (disposed || generation !== ownGeneration) break;
          if (result.done) break;
          buffer = (buffer + decoder.decode(result.value, { stream: true })).replace(/\r\n/g, '\n');
          let end: number;
          while ((end = buffer.indexOf('\n\n')) >= 0) {
            const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
            const event = frame.split('\n').find(l => l.startsWith('event:'))?.slice(6).trim();
            if (event === 'ready') { attempt = 0; setStatus('live'); refresh(); }
            if (event === 'inbox-changed') refresh();
          }
        }
      } catch {
        // No payloads, tokens, or account information in connection diagnostics.
        if (!disposed && generation === ownGeneration) console.warn('Live sync disconnected; reconnecting.');
      } finally {
        connection.abort();
      }
      if (!disposed && generation === ownGeneration) {
        setStatus('reconnecting');
        timer = setTimeout(connect, Math.min(30000, 1000 * 2 ** Math.min(attempt++, 5)) + Math.random() * 400);
      }
    }
    refresh();
    void connect();
    const sub = AppState.addEventListener('change', state => { stop(); if (state === 'active') { attempt = 0; refresh(); void connect(); } else setStatus('paused'); });
    return () => { disposed = true; stop(); sub.remove(); };
  }, [qc, userId]);
  return <LiveContext.Provider value={status}>{children}</LiveContext.Provider>;
}

export function useInboxPages() {
  return useInfiniteQuery({
    queryKey: [...getListEventsQueryKey(), 'mobile-pages'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => listEvents(pageParam ? { before: pageParam } : undefined, { signal, credentials: 'omit' }),
    getNextPageParam: page => page.nextCursor ?? undefined,
  });
}
