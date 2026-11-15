import { Platform, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { isLiquidGlassAvailable } from 'expo-glass-effect';
import { Tabs } from 'expo-router';
import { NativeTabs } from 'expo-router/native-tabs';
import { c } from '@/components/ui';

function GlassTabs() {
  return <NativeTabs tintColor={c.accent}>
    <NativeTabs.Trigger name="index" disableAutomaticContentInsets><NativeTabs.Trigger.Icon sf={{ default: 'square.grid.2x2', selected: 'square.grid.2x2.fill' }} /><NativeTabs.Trigger.Label>Dashboard</NativeTabs.Trigger.Label></NativeTabs.Trigger>
    <NativeTabs.Trigger name="inbox" disableAutomaticContentInsets><NativeTabs.Trigger.Icon sf={{ default: 'tray', selected: 'tray.fill' }} /><NativeTabs.Trigger.Label>Inbox</NativeTabs.Trigger.Label></NativeTabs.Trigger>
    <NativeTabs.Trigger name="webhooks" disableAutomaticContentInsets><NativeTabs.Trigger.Icon sf="link" /><NativeTabs.Trigger.Label>Webhooks</NativeTabs.Trigger.Label></NativeTabs.Trigger>
    <NativeTabs.Trigger name="settings" disableAutomaticContentInsets><NativeTabs.Trigger.Icon sf={{ default: 'gearshape', selected: 'gearshape.fill' }} /><NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label></NativeTabs.Trigger>
  </NativeTabs>;
}
export default function TabLayout() {
  if (Platform.OS === 'ios' && isLiquidGlassAvailable()) return <GlassTabs />;
  return <Tabs screenOptions={{
    headerShown: false, sceneStyle: { backgroundColor: c.background }, tabBarActiveTintColor: c.accent, tabBarInactiveTintColor: c.mutedForeground,
    tabBarLabelStyle: { fontFamily: 'Geist_500Medium', fontSize: 10 }, tabBarHideOnKeyboard: true,
    tabBarStyle: { position: 'absolute', backgroundColor: Platform.OS === 'ios' ? 'transparent' : c.background, borderTopColor: c.border, borderTopWidth: 1, elevation: 0, ...(Platform.OS === 'web' ? { height: 84 } : {}) },
    tabBarBackground: () => Platform.OS === 'ios' ? <BlurView intensity={95} tint="light" style={StyleSheet.absoluteFill} /> : <View style={[StyleSheet.absoluteFill, { backgroundColor: c.background }]} />,
  }}>
    <Tabs.Screen name="index" options={{ title: 'Dashboard', tabBarIcon: ({ focused }) => <Feather name="grid" size={21} color={focused ? c.accent : c.mutedForeground} /> }} />
    <Tabs.Screen name="inbox" options={{ title: 'Inbox', tabBarIcon: ({ focused }) => <Feather name="inbox" size={22} color={focused ? c.accent : c.mutedForeground} /> }} />
    <Tabs.Screen name="webhooks" options={{ title: 'Webhooks', tabBarIcon: ({ focused }) => <Feather name="link" size={21} color={focused ? c.accent : c.mutedForeground} /> }} />
    <Tabs.Screen name="settings" options={{ title: 'Settings', tabBarIcon: ({ focused }) => <Feather name="settings" size={22} color={focused ? c.accent : c.mutedForeground} /> }} />
  </Tabs>;
}
