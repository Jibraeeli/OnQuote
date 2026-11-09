import React, { useEffect, useRef } from 'react';
import { View, Text, ActivityIndicator, StyleSheet, Animated, Easing } from 'react-native';
import { colors, spacing, radius, type, shadow } from '../theme/colors';

/**
 * Full-screen-ish loader shown during the AI call. The `stage` prop
 * lets the caller rotate the copy as the pipeline progresses so the
 * tradesperson knows something's actually happening.
 */
export default function LoadingMate({ stage = 'Working on it…' }) {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.out(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.in(Easing.ease),  useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] });
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] });

  return (
    <View style={styles.wrap} accessibilityLiveRegion="polite">
      <Animated.View style={[styles.badge, { transform: [{ scale }], opacity }]}>
        <ActivityIndicator color={colors.white} size="large" />
      </Animated.View>
      <Text style={styles.title}>Hang tight</Text>
      <Text style={styles.stage}>{stage}</Text>
      <Text style={styles.hint}>Usually takes about 10 seconds.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
    padding: spacing.xl,
  },
  badge: {
    width: 96, height: 96, borderRadius: 48,
    backgroundColor: colors.blue,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: spacing.lg,
    ...shadow.button,
  },
  title: { ...type.h1, marginBottom: spacing.xs },
  stage: { ...type.body, color: colors.blue, fontWeight: '700', textAlign: 'center' },
  hint: { ...type.small, marginTop: spacing.sm, textAlign: 'center' },
});
