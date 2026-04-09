import { ActivityIndicator, DynamicColorIOS, Platform, View, useColorScheme } from 'react-native';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { StatusBar } from 'expo-status-bar';
import { MobileAppProvider, useMobileAppContext } from '../mobileAppContext';
import { getTheme } from '../theme';
import { createMobileStyles } from '../mobileStyles';

export default function RootLayout() {
  return (
    <MobileAppProvider>
      <TabsLayout />
    </MobileAppProvider>
  );
}

function TabsLayout() {
  const { loading } = useMobileAppContext();
  const colorScheme = useColorScheme();
  const theme = getTheme(colorScheme);
  const styles = createMobileStyles(theme);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
        <StatusBar style={theme.name === 'dark' ? 'light' : 'dark'} />
      </View>
    );
  }

  const tintColor =
    Platform.OS === 'ios'
      ? DynamicColorIOS({ light: '#0A84FF', dark: '#0A84FF' })
      : theme.colors.link;

  return (
    <>
      <StatusBar style={theme.name === 'dark' ? 'light' : 'dark'} />
      <NativeTabs tintColor={tintColor}>
        <NativeTabs.Trigger name="logs">
          <NativeTabs.Trigger.Icon
            sf={{ default: 'clock', selected: 'clock.fill' }}
            md="history"
          />
          <NativeTabs.Trigger.Label>Logs</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="settings">
          <NativeTabs.Trigger.Icon
            sf={{ default: 'gearshape', selected: 'gearshape.fill' }}
            md="settings"
          />
          <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
      </NativeTabs>
    </>
  );
}
