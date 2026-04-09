import { Image, ScrollView, Text, useColorScheme, View } from 'react-native';
import { formatSavedAt, createMobileStyles } from '../mobileStyles';
import { useMobileAppContext } from '../mobileAppContext';
import { getTheme } from '../theme';
import type { BookmarkHistoryEntry } from '../historyStorage';

interface HistoryGroup {
  label: string;
  items: BookmarkHistoryEntry[];
}

export default function LogsScreen() {
  const colorScheme = useColorScheme();
  const theme = getTheme(colorScheme);
  const styles = createMobileStyles(theme);
  const { history } = useMobileAppContext();
  const groups = groupHistoryByMonth(history);

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={history.length === 0 ? styles.logsEmptyScroll : styles.logsScroll}>
        {history.length === 0 ? (
          <View style={styles.logsEmptyState}>
            <Image
              source={require('../../assets/empty-log-asset.png')}
              style={styles.logsEmptyAsset}
              resizeMode="contain"
            />
            <Text style={styles.logsEmptyTitle}>No bookmark{'\n'}loged yet</Text>
            <Text style={styles.logsEmptyCopy}>
              You can simply hit share button and select stash and it will be added automatically to
              your stash app
            </Text>
          </View>
        ) : (
          <View style={styles.logsGroups}>
            {groups.map((group) => (
              <View key={group.label} style={styles.logsGroup}>
                <Text style={styles.logsGroupTitle}>{group.label}</Text>
                <View style={styles.logsGroupCard}>
                  {group.items.map((entry, index) => (
                    <View
                      key={entry.id}
                      style={[styles.logsEntry, index !== group.items.length - 1 ? styles.logsEntryBorder : null]}
                    >
                      <View style={styles.logsEntryMetaRow}>
                        <Text style={styles.logsEntrySource} numberOfLines={1}>
                          {entry.source}
                        </Text>
                        <Text style={styles.logsEntryDate}>{formatLogDate(entry.savedAt)}</Text>
                      </View>
                      <Text style={styles.logsEntryTitle}>{entry.title}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function groupHistoryByMonth(history: BookmarkHistoryEntry[]): HistoryGroup[] {
  const formatter = new Intl.DateTimeFormat(undefined, {
    month: 'long',
    year: 'numeric',
  });

  const groups = new Map<string, BookmarkHistoryEntry[]>();

  for (const entry of history) {
    const date = new Date(entry.savedAt);
    if (Number.isNaN(date.getTime())) continue;
    const label = formatter.format(date);
    const items = groups.get(label);
    if (items) {
      items.push(entry);
    } else {
      groups.set(label, [entry]);
    }
  }

  return Array.from(groups, ([label, items]) => ({ label, items }));
}

function formatLogDate(value: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
      .format(new Date(value))
      .replace(',', ' at');
  } catch {
    return formatSavedAt(value);
  }
}
