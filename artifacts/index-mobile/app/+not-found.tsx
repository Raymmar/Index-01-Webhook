import { router } from 'expo-router';
import { Page, Empty, Button } from '@/components/ui';
export default function NotFound() {
  return <Page title="Not here."><Empty title="This page has moved." text="Your work is still on the Dashboard." /><Button label="Go to Dashboard" onPress={() => router.replace('/')} /></Page>;
}
