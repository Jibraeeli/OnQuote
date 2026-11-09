import React from 'react';
import { Pressable, Text, View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, shadow, type } from '../theme/colors';
import { formatCurrency, formatRelativeDate } from '../utils/formatters';

export default function QuoteCard({ quote, onPress }) {
  const total = quote.edits?.total ?? quote.ai?.total ?? 0;
  const customerName = quote.customer?.name || quote.ai?.customer_summary || 'Untitled job';
  const status = quote.status || 'draft';

  return (
    <Pressable
      onPress={() => onPress?.(quote)}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
      hitSlop={4}
    >
      <View style={styles.row}>
        <View style={styles.icon}>
          <Ionicons name="document-text-outline" size={24} color={colors.blue} />
        </View>
        <View style={styles.main}>
          <Text style={styles.title} numberOfLines={1}>
            {customerName}
          </Text>
          <Text style={styles.meta}>
            {formatRelativeDate(quote.createdAt)}
          </Text>
        </View>
        <View style={styles.right}>
          <Text style={styles.total}>{formatCurrency(total)}</Text>
          <StatusPill status={status} />
        </View>
      </View>
    </Pressable>
  );
}

function StatusPill({ status }) {
  const map = {
    draft:  { bg: colors.grey200, fg: colors.grey700, label: 'Draft' },
    sent:   { bg: '#DCEFE3',      fg: colors.success, label: 'Sent'  },
  };
  const s = map[status] || map.draft;
  return (
    <View style={[styles.pill, { backgroundColor: s.bg }]}>
      <Text style={[styles.pillText, { color: s.fg }]}>{s.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm + 4,
    ...shadow.card,
  },
  pressed: { backgroundColor: colors.grey100 },
  row: { flexDirection: 'row', alignItems: 'center' },
  icon: {
    width: 44, height: 44, borderRadius: radius.sm,
    backgroundColor: colors.blueLight,
    alignItems: 'center', justifyContent: 'center',
    marginRight: spacing.md,
  },
  main: { flex: 1, marginRight: spacing.sm },
  title: { ...type.body, color: colors.navy, fontWeight: '700' },
  meta: { ...type.small, marginTop: 2 },
  right: { alignItems: 'flex-end' },
  total: { ...type.h2, fontSize: 20, color: colors.navy },
  pill: {
    marginTop: 4,
    paddingHorizontal: 10, paddingVertical: 3,
    borderRadius: radius.pill,
  },
  pillText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.3 },
});
