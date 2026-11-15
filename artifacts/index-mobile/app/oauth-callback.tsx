import { useAuth } from '@clerk/expo';
import { Redirect } from 'expo-router';
import { Page, Skeleton } from '@/components/ui';

export default function OAuthCallback() {
  const { isSignedIn } = useAuth();
  if (isSignedIn) return <Redirect href="/" />;
  return <Page title="Signing in"><Skeleton /></Page>;
}
