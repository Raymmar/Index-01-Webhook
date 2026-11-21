import { useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ClerkProvider, useAuth } from '@clerk/expo';
import { tokenCache } from '@clerk/expo/token-cache';
import { Geist_400Regular, Geist_500Medium, Geist_600SemiBold, useFonts } from '@expo-google-fonts/geist';
import { InstrumentSerif_400Regular } from '@expo-google-fonts/instrument-serif';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { setBaseUrl } from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { AuthScreen } from '@/components/auth';
import { AccessGate } from '@/components/access';
import { BearerBinding } from '@/lib/session';
import { Page, Skeleton, Empty, c } from '@/components/ui';

void SplashScreen.preventAutoHideAsync();
setBaseUrl(`https://${process.env.EXPO_PUBLIC_DOMAIN}`);
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 20000, refetchOnWindowFocus: false }, mutations: { retry: false } } });
const clerkPubKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? '';
const clerkProxyUrl = process.env.EXPO_PUBLIC_CLERK_PROXY_URL;

function PrivateWorkspace() {
  // A separate cache per mounted account also isolates late mutation callbacks.
  // Clearing a singleton alone would let an old in-flight settings save populate
  // the next account's cache after a user switch.
  const [privateClient] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 20000, refetchOnWindowFocus: false }, mutations: { retry: false } } }));
  return <QueryClientProvider client={privateClient}><BearerBinding><AccessGate><Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.background } }}><Stack.Screen name="(tabs)" /><Stack.Screen name="settings-prompts" /><Stack.Screen name="settings-extraction" /><Stack.Screen name="settings-rule" /><Stack.Screen name="oauth-callback" /><Stack.Screen name="+not-found" /></Stack></AccessGate></BearerBinding></QueryClientProvider>;
}
function SessionRouter() {
  const { isLoaded, isSignedIn, userId } = useAuth();
  if (!isLoaded) return <Page title="Index 0.1"><Skeleton /></Page>;
  if (!isSignedIn) return <AuthScreen />;
  return <PrivateWorkspace key={userId} />;
}
export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({ Geist_400Regular, Geist_500Medium, Geist_600SemiBold, InstrumentSerif_400Regular });
  useEffect(() => { if (fontsLoaded || fontError) void SplashScreen.hideAsync(); }, [fontsLoaded, fontError]);
  if (!fontsLoaded && !fontError) return null;
  return <QueryClientProvider client={queryClient}><SafeAreaProvider><GestureHandlerRootView style={{ flex: 1 }}><KeyboardProvider><ErrorBoundary><StatusBar style="dark" />{!clerkPubKey || !process.env.EXPO_PUBLIC_DOMAIN ? <Page title="Index 0.1"><Empty title="Connection not configured" text="The app needs its Clerk publishable key and backend domain. Contact the app owner." icon="link" /></Page> : <ClerkProvider publishableKey={clerkPubKey} proxyUrl={clerkProxyUrl} tokenCache={tokenCache}><SessionRouter /></ClerkProvider>}</ErrorBoundary></KeyboardProvider></GestureHandlerRootView></SafeAreaProvider></QueryClientProvider>;
}
