import React, { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, Pressable, RefreshControl, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';

import BigButton from '../components/BigButton';
import QuoteCard from '../components/QuoteCard';
import { colors, spacing, type, radius } from '../theme/colors';
import { getQuotes, getSettings } from '../services/storage';
import { getPendingCount, processQueue } from '../services/queue';

export default function HomeScreen({ navigation }) {
  const [quotes, setQuotes] = useState([]);
  const [businessName, setBusinessName] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  // Offline queue state
  const [pendingCount, setPendingCount] = useState(0);
  const [processing, setProcessing] = useState(false);

  const load = useCallback(async () => {
    const [q, s, pc] = await Promise.all([getQuotes(), getSettings(), getPendingCount()]);
    setQuotes(q);
    setBusinessName(s.businessName || '');
    setPendingCount(pc);
  }, []);

  // Auto-process queue once on focus if there are pending jobs
  const maybeProcessQueue = useCallback(async () => {
    const count = await getPendingCount();
    if (count === 0 || processing) return;
    setProcessing(true);
    try {
      const result = await processQueue();
      if (result.processed > 0) {
        // Queue did something - reload list to show the new quotes
        await load();
      } else {
        // Even if nothing processed, refresh count (signal may still be out)
        setPendingCount(result.remaining);
      }
    } catch (e) {
      console.warn('queue process error', e);
    } finally {
      setProcessing(false);
    }
  }, [load, processing]);

  useFocusEffect(
    useCallback(() => {
      load().then(() => {
        // Kick off background queue processing after initial load
        maybeProcessQueue();
      });
    }, [load, maybeProcessQueue])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    await maybeProcessQueue();
    setRefreshing(false);
  };

  const handleNewQuote = () => navigation.navigate('Capture');
  const handleHistory = () => navigation.navigate('History');
  const handleSettings = () => navigation.navigate('Settings');
  const handleQuotePress = (quote) => navigation.navigate('Review', { quoteId: quote.id });

  const recent = quotes.slice(0, 5);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      {/* Header */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.brand}>OnQuote</Text>
          <Text style={styles.greeting} numberOfLines={1}>
            {businessName ? `Afternoon, ${businessName}` : 'Snap it. Say it. Send it.'}
          </Text>
        </View>
        <HeaderIcon name="time-outline" onPress={handleHistory} label="History" />
        <HeaderIcon name="settings-outline" onPress={handleSettings} label="Settings" />
      </View>

      {/* Main list */}
      <FlatList
        data={recent}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <QuoteCard quote={item} onPress={handleQuotePress} />}
        ListHeaderComponent={
          <View style={styles.hero}>
            {pendingCount > 0 ? (
              <QueueBanner count={pendingCount} processing={processing} onTap={maybeProcessQueue} />
            ) : null}

            <BigButton
              label="New Quote"
              icon="add-circle"
              onPress={handleNewQuote}
              style={styles.newQuoteBtn}
            />
            <Text style={styles.heroHint}>
              Photo + 20-second voice note → quote ready to send
            </Text>

            <Text style={styles.sectionTitle}>
              {recent.length ? 'Recent quotes' : ''}
            </Text>
          </View>
        }
        ListEmptyComponent={<EmptyState />}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.blue} />
        }
        showsVerticalScrollIndicator={false}
      />

      {quotes.length > 5 ? (
        <Pressable style={styles.seeAll} onPress={handleHistory} hitSlop={10}>
          <Text style={styles.seeAllText}>See all {quotes.length} quotes</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.blue} />
        </Pressable>
      ) : null}
    </SafeAreaView>
  );
}

// Sub-components

function HeaderIcon({ name, onPress, label }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={12}
      accessibilityLabel={label}
      accessibilityRole="button"
      style={({ pressed }) => [styles.iconBtn, pressed && { backgroundColor: colors.grey200 }]}
    >
      <Ionicons name={name} size={26} color={colors.navy} />
    </Pressable>
  );
}

function QueueBanner({ count, processing, onTap }) {
  return (
    <Pressable
      onPress={processing ? undefined : onTap}
      style={({ pressed }) => [styles.queueBanner, pressed && !processing && { opacity: 0.85 }]}
      hitSlop={6}
    >
      {processing ? (
        <ActivityIndicator color={colors.white} size="small" />
      ) : (
        <Ionicons name="cloud-offline-outline" size={22} color={colors.white} />
      )}
      <View style={{ flex: 1, marginLeft: spacing.sm }}>
        <Text style={styles.queueTitle}>
          {processing
            ? 'Working on queued quotes…'
            : `${count} quote${count === 1 ? '' : 's'} waiting`}
        </Text>
        <Text style={styles.queueHint}>
          {processing
            ? 'Hold on a sec'
            : 'Tap to try again - needs signal'}
        </Text>
      </View>
      {!processing ? <Ionicons name="refresh" size={20} color={colors.white} /> : null}
    </Pressable>
  );
}

function EmptyState() {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Ionicons name="camera-outline" size={44} color={colors.blue} />
      </View>
      <Text style={styles.emptyTitle}>No quotes yet</Text>
      <Text style={styles.emptyText}>
        Tap <Text style={{ fontWeight: '700', color: colors.navy }}>New Quote</Text>, snap the
        problem, tell OnQuote what's up, and you'll have a quote in seconds.
      </Text>
    </View>
  );
}

// Styles

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },

  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  brand: { ...type.display, color: colors.navy },
  greeting: { ...type.bodyMuted, marginTop: 2, fontSize: 15 },
  iconBtn: {
    width: 44, height: 44, borderRadius: radius.pill,
    alignItems: 'center', justifyContent: 'center',
    marginLeft: spacing.xs,
  },

  hero: {
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  newQuoteBtn: {
    minHeight: 84,
  },
  heroHint: {
    ...type.small,
    textAlign: 'center',
    marginTop: spacing.md,
    marginBottom: spacing.xl,
  },
  sectionTitle: {
    ...type.label,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    fontSize: 13,
    marginBottom: spacing.sm,
    color: colors.grey500,
  },

  /* Queue banner */
  queueBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.warning,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  queueTitle: { ...type.body, color: colors.white, fontWeight: '700', fontSize: 16 },
  queueHint: { ...type.small, color: 'rgba(255,255,255,0.92)', fontSize: 13, marginTop: 1 },

  listContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
  },

  empty: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.md,
  },
  emptyIcon: {
    width: 84, height: 84, borderRadius: 42,
    backgroundColor: colors.blueLight,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: spacing.md,
  },
  emptyTitle: { ...type.h2, marginBottom: spacing.xs },
  emptyText: {
    ...type.body, fontSize: 16, color: colors.grey500,
    textAlign: 'center', lineHeight: 24,
    maxWidth: 320,
  },

  seeAll: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: spacing.md,
    borderTopWidth: 1, borderTopColor: colors.grey200,
    backgroundColor: colors.white,
  },
  seeAllText: { ...type.label, color: colors.blue, marginRight: 4 },
});
