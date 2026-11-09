import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, type } from '../theme/colors';

/**
 * Friendly inline error. Never a modal. Always explains what to do next.
 * Example: "Photo unclear - retake?" with a retry action.
 */
export default function ErrorBanner({ message, actionLabel, onAction }) {
  if (!message) return null;
  return (
    <View style={styles.wrap}>
      <Ionicons name="alert-circle" size={22} color={colors.danger} style={{ marginRight: spacing.sm }} />
      <Text style={styles.msg}>{message}</Text>
      {actionLabel && onAction ? (
        <Pressable onPress={onAction} hitSlop={10} style={styles.action}>
          <Text style={styles.actionText}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FCE9E9',
    borderRadius: radius.md,
    padding: spacing.md,
    borderLeftWidth: 4,
    borderLeftColor: colors.danger,
  },
  msg: { ...type.body, fontSize: 16, color: colors.grey900, flex: 1 },
  action: { marginLeft: spacing.sm, paddingHorizontal: spacing.sm, paddingVertical: 4 },
  actionText: { ...type.label, color: colors.danger, fontWeight: '700' },
});
