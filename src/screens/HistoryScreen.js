import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, FlatList, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';

import QuoteCard from '../components/QuoteCard';
import { colors, spacing, type, radius } from '../theme/colors';
import { getQuotes } from '../services/storage';

export default function HistoryScreen({ navigation }) {
  const [quotes, setQuotes] = useState([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setQuotes(await getQuotes());
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
      <FlatList
        data={quotes}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <QuoteCard
            quote={item}
            onPress={(q) => navigation.navigate('Review', { quoteId: q.id })}
          />
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <View style={styles.emptyIcon}>
              <Ionicons name="document-outline" size={44} color={colors.blue} />
            </View>
            <Text style={styles.emptyTitle}>Nothing here yet</Text>
            <Text style={styles.emptyText}>
              Your past quotes will show up here once you've sent a few.
            </Text>
          </View>
        }
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.blue} />
        }
        showsVerticalScrollIndicator={false}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  listContent: { padding: spacing.lg, paddingBottom: spacing.xxl, flexGrow: 1 },
  empty: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingVertical: spacing.xxl,
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
    textAlign: 'center', maxWidth: 280,
  },
});
