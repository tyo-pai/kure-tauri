import { Modal, ScrollView, Text, TextInput, TouchableOpacity, useColorScheme, View } from 'react-native';
import { useMobileAppContext } from '../mobileAppContext';
import { createMobileStyles } from '../mobileStyles';
import { getTheme } from '../theme';

export default function SettingsScreen() {
  const colorScheme = useColorScheme();
  const theme = getTheme(colorScheme);
  const styles = createMobileStyles(theme);
  const {
    vaultUri,
    vaultLabel,
    vaultStatus,
    vaultModalVisible,
    status,
    shareError,
    openAiKeyDraft,
    setOpenAiKeyDraft,
    saveOpenAiKey,
    openVaultModal,
    closeVaultModal,
    pickVault,
    forgetVault,
  } = useMobileAppContext();

  const vaultDisplay = vaultUri ? `/${vaultLabel || 'Stash'}` : '/Choose vault';

  return (
    <View style={styles.screen}>
      <Modal
        visible={vaultModalVisible}
        transparent
        animationType="fade"
        onRequestClose={closeVaultModal}
      >
        <View style={styles.vaultModalBackdrop}>
          <View style={styles.vaultModalCard}>
            <Text style={styles.vaultModalTitle}>Choose vault folder</Text>
            <Text style={styles.vaultModalCopy}>
              Select the folder you want Stash to keep bookmarked for bookmark saves and iCloud sync.
            </Text>
            <View style={styles.vaultModalSection}>
              <Text style={styles.vaultModalLabel}>Current folder</Text>
              <Text style={styles.vaultModalValue}>{vaultDisplay}</Text>
            </View>
            {vaultStatus ? <Text style={styles.vaultModalStatus}>{vaultStatus}</Text> : null}
            <TouchableOpacity style={styles.button} onPress={() => void pickVault()}>
              <Text style={styles.buttonText}>{vaultUri ? 'Choose different folder' : 'Choose folder'}</Text>
            </TouchableOpacity>
            {vaultUri ? (
              <TouchableOpacity style={[styles.button, styles.secondary]} onPress={() => void forgetVault()}>
                <Text style={styles.buttonTextSecondary}>Forget saved vault</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity style={styles.vaultModalClose} onPress={closeVaultModal}>
              <Text style={styles.vaultModalCloseText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <ScrollView contentContainerStyle={styles.settingsScroll}>
        <Text style={styles.settingsTitle}>Settings</Text>

        <View style={styles.settingsCard}>
          <TouchableOpacity style={styles.settingsSection} onPress={openVaultModal} activeOpacity={0.8}>
            <Text style={styles.settingsSectionTitle}>Vault folder</Text>
            <Text style={styles.settingsSectionValue}>{vaultDisplay}</Text>
          </TouchableOpacity>

          <View style={styles.settingsDivider} />

          <View style={styles.settingsSection}>
            <Text style={styles.settingsSectionTitle}>AI API Key(optional)</Text>
            <Text style={styles.settingsDescription}>
              AI used to getting rich information from the bookmarked link, select a proper tagging,
              image recognitions as well summaries.
            </Text>
            <Text style={styles.settingsDescriptionStrong}>**only for non apple intelligence device</Text>
            <TextInput
              style={styles.settingsInput}
              placeholder="sk-"
              placeholderTextColor={theme.colors.textPrimary}
              value={openAiKeyDraft}
              onChangeText={setOpenAiKeyDraft}
              onEndEditing={() => void saveOpenAiKey()}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
            />
          </View>
        </View>

        {shareError ? <Text style={styles.error}>Share intent: {shareError}</Text> : null}
        {status ? <Text style={styles.status}>{status}</Text> : null}
      </ScrollView>
    </View>
  );
}
