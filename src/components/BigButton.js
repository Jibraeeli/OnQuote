import React from 'react';
import { Pressable, Text, View, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors, radius, spacing, shadow, type } from '../theme/colors';

/**
 * The app's core CTA. 72pt tall, bold label, optional icon.
 * Variants: 'primary' (blue), 'secondary' (navy outline), 'ghost' (grey text only).
 */
export default function BigButton({
  label,
  icon,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  style,
}) {
  const handlePress = () => {
    if (disabled || loading) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    onPress?.();
  };

  const stateStyles = getVariantStyles(variant, disabled);

  return (
    <Pressable
      onPress={handlePress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.base,
        stateStyles.container,
        pressed && !disabled && stateStyles.pressed,
        variant === 'primary' && !disabled && shadow.button,
        style,
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled || loading }}
      hitSlop={8}
    >
      {loading ? (
        <ActivityIndicator color={stateStyles.label.color} size="small" />
      ) : (
        <View style={styles.inner}>
          {icon ? (
            <Ionicons
              name={icon}
              size={26}
              color={stateStyles.label.color}
              style={styles.icon}
            />
          ) : null}
          <Text style={[type.button, stateStyles.label]} numberOfLines={1}>
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

function getVariantStyles(variant, disabled) {
  if (disabled) {
    return {
      container: { backgroundColor: colors.grey200, borderWidth: 0 },
      pressed: {},
      label: { color: colors.grey500 },
    };
  }
  switch (variant) {
    case 'secondary':
      return {
        container: {
          backgroundColor: colors.white,
          borderWidth: 2,
          borderColor: colors.navy,
        },
        pressed: { backgroundColor: colors.grey100 },
        label: { color: colors.navy },
      };
    case 'ghost':
      return {
        container: { backgroundColor: 'transparent' },
        pressed: { backgroundColor: colors.grey100 },
        label: { color: colors.navy },
      };
    case 'danger':
      return {
        container: { backgroundColor: colors.danger },
        pressed: { backgroundColor: '#B83535' },
        label: { color: colors.white },
      };
    case 'primary':
    default:
      return {
        container: { backgroundColor: colors.blue },
        pressed: { backgroundColor: colors.blueDark },
        label: { color: colors.white },
      };
  }
}

const styles = StyleSheet.create({
  base: {
    minHeight: 72,
    borderRadius: radius.md,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    marginRight: spacing.sm + 4,
  },
});
