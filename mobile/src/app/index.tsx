import { Redirect } from 'expo-router';
import { useMobileAppContext } from '../mobileAppContext';

export default function IndexRedirect() {
  const { vaultUri } = useMobileAppContext();

  return <Redirect href={vaultUri ? '/logs' : '/settings'} />;
}
