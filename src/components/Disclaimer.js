import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, type } from '../theme/colors';

export default function Disclaimer() {
  return (
    <View style={styles.wrap}>
      <Ionicons name="information-circle-outline" size={20} color={colors.grey700} style={{ marginRight: spacing.sm, marginTop: 1 }} />
      <Text style={styles.text}>
        AI-generated suggestion - always double-check prices, parts and details before sending to customer.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.grey100,
    borderRadius: radius.sm,
    padding: spacing.md,
  },
  text: {
    ...type.small,
    fontSize: 13,
    color: colors.grey700,
    lineHeight: 18,
    flex: 1,
  },
});
