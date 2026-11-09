import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, Pressable, Switch,
  KeyboardAvoidingView, Platform, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import BigButton from '../components/BigButton';
import { colors, spacing, type, radius, shadow } from '../theme/colors';
import { getSettings, saveSettings } from '../services/storage';
import { TRADES, getDefaultRatesForTrade } from '../services/pricing';

export default function SettingsScreen({ navigation }) {
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    getSettings().then(setForm);
  }, []);

  const update = useCallback((patch) => {
    setForm((prev) => ({ ...prev, ...patch }));
    setDirty(true);
  }, []);

  const handleTradeChange = (trade) => {
    const defaults = getDefaultRatesForTrade(trade);
    update({ trade, labourHourly: defaults.labourHourly, calloutFee: defaults.calloutFee });
  };

  const handleSave = async () => {
    if (!form) return;
    setSaving(true);
    try {
      await saveSettings(form);
      setDirty(false);
      Alert.alert('Saved', 'Settings updated.', [{ text: 'OK' }]);
    } catch (e) {
      Alert.alert('Could not save', e.message);
    } finally {
      setSaving(false);
    }
  };

  if (!form) {
    return <SafeAreaView style={styles.safe} />;
  }

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Business */}
          <Section title="Your business">
            <Field
              label="Business name"
              value={form.businessName}
              onChange={(v) => update({ businessName: v })}
              placeholder="e.g. Dave's Plumbing Ltd"
              autoCapitalize="words"
            />

            <Label>Trade</Label>
            <View style={styles.chipRow}>
              {TRADES.map((t) => {
                const active = form.trade === t.key;
                return (
                  <Pressable
                    key={t.key}
                    onPress={() => handleTradeChange(t.key)}
                    style={[styles.chip, active && styles.chipActive]}
                    hitSlop={6}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>
                      {t.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </Section>

          {/* Rates */}
          <Section title="Rates">
            <MoneyField
              label="Labour (per hour)"
              value={form.labourHourly}
              onChange={(v) => update({ labourHourly: v })}
            />
            <MoneyField
              label="Call-out fee"
              value={form.calloutFee}
              onChange={(v) => update({ calloutFee: v })}
            />

            <View style={styles.switchRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.switchLabel}>VAT registered</Text>
                <Text style={styles.switchHint}>Adds 20% VAT to every quote</Text>
              </View>
              <Switch
                value={!!form.vatRegistered}
                onValueChange={(v) => update({ vatRegistered: v })}
                trackColor={{ false: colors.grey300, true: colors.blue }}
                thumbColor={colors.white}
              />
            </View>
          </Section>

          {/* API keys */}
          <Section title="AI keys" hint="Needed to generate quotes. Stored on this device only.">
            <Field
              label="Anthropic API key (primary - Claude)"
              value={form.anthropicKey}
              onChange={(v) => update({ anthropicKey: v })}
              placeholder="sk-ant-..."
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Field
              label="OpenAI API key (for voice transcription + fallback)"
              value={form.openaiKey}
              onChange={(v) => update({ openaiKey: v })}
              placeholder="sk-..."
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
            />
          </Section>

          {/* Disclaimer */}
          <View style={styles.disclaimer}>
            <Ionicons name="shield-checkmark-outline" size={20} color={colors.grey700} style={{ marginRight: spacing.sm, marginTop: 1 }} />
            <Text style={styles.disclaimerText}>
              OnQuote generates suggestions based on your photos, voice note and rates.
              Always double-check every quote before sending it to a customer.
            </Text>
          </View>

          <View style={{ height: spacing.xl }} />
          <BigButton
            label={dirty ? 'Save Settings' : 'Saved'}
            icon={dirty ? 'save' : 'checkmark-circle'}
            onPress={handleSave}
            disabled={!dirty}
            loading={saving}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// Sub-components

function Section({ title, hint, children }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {hint ? <Text style={styles.sectionHint}>{hint}</Text> : null}
      <View style={styles.card}>{children}</View>
    </View>
  );
}

function Label({ children }) {
  return <Text style={styles.label}>{children}</Text>;
}

function Field({ label, value, onChange, ...rest }) {
  return (
    <View style={{ marginBottom: spacing.md }}>
      <Label>{label}</Label>
      <TextInput
        value={value ?? ''}
        onChangeText={onChange}
        style={styles.input}
        placeholderTextColor={colors.grey500}
        {...rest}
      />
    </View>
  );
}

function MoneyField({ label, value, onChange }) {
  return (
    <View style={{ marginBottom: spacing.md }}>
      <Label>{label}</Label>
      <View style={styles.moneyWrap}>
        <Text style={styles.moneyPrefix}>£</Text>
        <TextInput
          value={String(value ?? '')}
          onChangeText={(txt) => {
            const clean = txt.replace(/[^0-9.]/g, '');
            const n = clean === '' ? '' : Number(clean);
            onChange(n);
          }}
          keyboardType="decimal-pad"
          style={styles.moneyInput}
          placeholder="0"
          placeholderTextColor={colors.grey500}
        />
      </View>
    </View>
  );
}

// Styles

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },

  section: { marginBottom: spacing.lg },
  sectionTitle: {
    ...type.label,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    fontSize: 13,
    color: colors.grey500,
    marginBottom: spacing.xs,
  },
  sectionHint: {
    ...type.small, marginBottom: spacing.sm,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.md,
    ...shadow.card,
  },

  label: {
    ...type.label,
    fontSize: 14,
    marginBottom: 6,
    color: colors.grey700,
  },
  input: {
    minHeight: 52,
    backgroundColor: colors.white,
    borderWidth: 1.5,
    borderColor: colors.grey200,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    fontSize: 18,
    color: colors.grey900,
    fontWeight: '500',
  },

  moneyWrap: {
    flexDirection: 'row', alignItems: 'center',
    minHeight: 52,
    backgroundColor: colors.white,
    borderWidth: 1.5, borderColor: colors.grey200,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
  },
  moneyPrefix: { ...type.body, color: colors.grey500, marginRight: 6, fontSize: 20 },
  moneyInput: { flex: 1, fontSize: 20, fontWeight: '600', color: colors.grey900, paddingVertical: 0 },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 2 },
  chip: {
    paddingHorizontal: spacing.md, paddingVertical: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.grey100,
    marginRight: spacing.sm, marginBottom: spacing.sm,
    borderWidth: 1.5, borderColor: 'transparent',
  },
  chipActive: {
    backgroundColor: colors.blueLight,
    borderColor: colors.blue,
  },
  chipText: { ...type.body, fontSize: 16, fontWeight: '600', color: colors.grey700 },
  chipTextActive: { color: colors.blue },

  switchRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  switchLabel: { ...type.body, color: colors.navy, fontWeight: '600' },
  switchHint: { ...type.small, marginTop: 2 },

  disclaimer: {
    flexDirection: 'row', alignItems: 'flex-start',
    backgroundColor: colors.grey100,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  disclaimerText: {
    ...type.small, fontSize: 13, color: colors.grey700, lineHeight: 18, flex: 1,
  },
});
