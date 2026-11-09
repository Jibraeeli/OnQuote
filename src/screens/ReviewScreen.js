import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, Pressable,
  KeyboardAvoidingView, Platform, Alert, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import * as Calendar from 'expo-calendar';
import * as Haptics from 'expo-haptics';

import BigButton from '../components/BigButton';
import LoadingMate from '../components/LoadingMate';
import ErrorBanner from '../components/ErrorBanner';
import Disclaimer from '../components/Disclaimer';
import { colors, spacing, type, radius, shadow } from '../theme/colors';
import { generateQuote } from '../services/ai';
import { getQuotes, saveQuote, getSettings } from '../services/storage';
import { enqueueJob } from '../services/queue';
import { shareQuotePdf } from '../services/pdf';
import { formatCurrency } from '../utils/formatters';

/**
 * Route params can arrive in two ways:
 *   - From Capture: { photos: [uri,...], voiceUri, voiceDuration } → runs AI
 *   - From History: { quoteId } → loads existing quote read-ish
 */
export default function ReviewScreen({ route, navigation }) {
  const params = route.params || {};
  const isFromHistory = !!params.quoteId;

  const [loading, setLoading] = useState(!isFromHistory);
  const [stage, setStage] = useState('Warming up…');
  const [error, setError] = useState(null);

  const [quote, setQuote] = useState(null);   // saved shape
  const [edits, setEdits] = useState({});     // { total?, notes? }
  const [sendModalOpen, setSendModalOpen] = useState(false);
  const [sent, setSent] = useState(false);

  const ranRef = useRef(false);

  // Load or generate

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    if (isFromHistory) {
      getQuotes().then((all) => {
        const q = all.find((x) => x.id === params.quoteId);
        if (!q) {
          setError('Quote not found.');
          setLoading(false);
          return;
        }
        setQuote(q);
        setEdits(q.edits || {});
        setSent(q.status === 'sent');
        setLoading(false);
      });
      return;
    }

    runGeneration();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runGeneration = async () => {
    setLoading(true);
    setError(null);
    try {
      const { transcript, ai, usedModel, compressedPhotos } = await generateQuote({
        photoUris: params.photos || [],
        voiceUri: params.voiceUri,
        onStage: ({ note }) => setStage(note),
      });

      const settings = await getSettings();
      const newQuote = {
        id: `q_${Date.now()}`,
        createdAt: new Date().toISOString(),
        customer: { name: '', phone: '', email: '' },
        photos: compressedPhotos || params.photos || [],
        voiceUri: params.voiceUri,
        voiceDuration: params.voiceDuration,
        transcript,
        ai,
        edits: {},
        status: 'draft',
        trade: settings.trade,
        businessName: settings.businessName,
        usedModel,
      };
      // Save immediately so the draft survives if the user backs out
      await saveQuote(newQuote);
      setQuote(newQuote);
      setEdits({});
    } catch (e) {
      // Offline? Queue it and let the user carry on.
      if (e.code === 'OFFLINE') {
        try {
          await enqueueJob({
            photoUris: params.photos || [],
            voiceUri: params.voiceUri,
            voiceDuration: params.voiceDuration,
          });
          Alert.alert(
            'Queued for later',
            "You're offline. This quote will generate automatically when you're back on signal.",
            [{ text: 'OK', onPress: () => navigation.popToTop() }]
          );
          return;
        } catch (qErr) {
          setError('Offline and couldn\'t save for later. Try again with signal.');
          return;
        }
      }
      setError(e.message || 'Something went wrong - try again.');
    } finally {
      setLoading(false);
    }
  };

  // Edits

  const currentTotal = edits.total ?? quote?.ai?.total ?? 0;
  const currentNotes = edits.notes ?? '';

  const updateEdit = useCallback(
    (patch) => {
      setEdits((prev) => {
        const next = { ...prev, ...patch };
        if (quote) {
          saveQuote({ ...quote, edits: next }).catch(() => {});
        }
        return next;
      });
    },
    [quote]
  );

  // Send

  const buildQuoteText = () => {
    if (!quote) return '';
    const ai = quote.ai;
    const biz = quote.businessName || 'Your tradesperson';
    const lines = [];
    lines.push(`Quote from ${biz}`);
    lines.push('');
    lines.push(ai.customer_summary || '');
    lines.push('');
    (ai.line_items || []).forEach((li) => {
      lines.push(`• ${li.description} - ${formatCurrency(li.total)}`);
    });
    lines.push('');
    if (ai.vat && ai.vat > 0) lines.push(`Subtotal: ${formatCurrency(ai.subtotal)}`);
    if (ai.vat && ai.vat > 0) lines.push(`VAT: ${formatCurrency(ai.vat)}`);
    lines.push(`Total: ${formatCurrency(currentTotal)}`);
    if (ai.estimated_duration) lines.push(`Estimated time: ${ai.estimated_duration}`);
    if (currentNotes) {
      lines.push('');
      lines.push(`Notes: ${currentNotes}`);
    }
    return lines.join('\n');
  };

  const sendViaSMS = async (phone) => {
    const body = encodeURIComponent(buildQuoteText());
    const sep = Platform.OS === 'ios' ? '&' : '?';
    const url = `sms:${phone || ''}${sep}body=${body}`;
    const ok = await Linking.canOpenURL(url);
    if (!ok) {
      Alert.alert('Can\'t open Messages', 'SMS not available on this device.');
      return;
    }
    await Linking.openURL(url);
    await markSent();
  };

  const sendViaEmail = async (email) => {
    const subject = encodeURIComponent(`Quote from ${quote.businessName || 'OnQuote'}`);
    const body = encodeURIComponent(buildQuoteText());
    const url = `mailto:${email || ''}?subject=${subject}&body=${body}`;
    const ok = await Linking.canOpenURL(url);
    if (!ok) {
      Alert.alert('Can\'t open Mail', 'No email app available.');
      return;
    }
    await Linking.openURL(url);
    await markSent();
  };

  const sendAsPdf = async () => {
    try {
      // Pass the quote with current edits merged in, so the PDF reflects what
      // the tradesperson sees on screen, not the stale saved copy.
      await shareQuotePdf({ ...quote, edits });
      await markSent();
    } catch (e) {
      Alert.alert('PDF failed', e.message || 'Could not create PDF - try again.');
    }
  };

  const markSent = async () => {
    if (!quote) return;
    const next = { ...quote, status: 'sent', edits, sentAt: new Date().toISOString() };
    await saveQuote(next);
    setQuote(next);
    setSent(true);
    setSendModalOpen(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  };

  const addCalendarEntry = async () => {
    try {
      const { status } = await Calendar.requestCalendarPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Calendar permission', 'Enable calendar access to add a job reminder.');
        return;
      }
      const cals = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
      const writable = cals.find((c) => c.allowsModifications) || cals[0];
      if (!writable) {
        Alert.alert('No calendar', 'No calendar available to write to.');
        return;
      }
      const start = new Date();
      start.setHours(start.getHours() + 24); // default: tomorrow same time
      const end = new Date(start);
      end.setHours(end.getHours() + Math.max(1, Math.round(quote.ai.labour_hours || 1)));

      await Calendar.createEventAsync(writable.id, {
        title: `${quote.ai.customer_summary || 'OnQuote job'}`,
        startDate: start,
        endDate: end,
        notes: buildQuoteText(),
      });
      Alert.alert('Added to calendar', 'Job scheduled for tomorrow - edit the time in your calendar app.');
    } catch (e) {
      Alert.alert('Calendar error', e.message || 'Could not add calendar entry.');
    }
  };

  // Render branches

  if (loading) {
    return <LoadingMate stage={stage} />;
  }

  if (error && !quote) {
    return (
      <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
        <View style={styles.errorWrap}>
          <ErrorBanner message={error} />
          <View style={{ height: spacing.lg }} />
          <BigButton
            label="Try Again"
            icon="refresh"
            onPress={runGeneration}
          />
          <View style={{ height: spacing.sm }} />
          <BigButton
            label="Back to Capture"
            icon="arrow-back"
            variant="secondary"
            onPress={() => navigation.goBack()}
          />
        </View>
      </SafeAreaView>
    );
  }

  if (!quote) return <SafeAreaView style={styles.safe} />;

  const ai = quote.ai;

  // Main render

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
          {/* Status ribbon */}
          {sent ? (
            <View style={styles.sentBanner}>
              <Ionicons name="checkmark-circle" size={22} color={colors.success} />
              <Text style={styles.sentText}>Sent to customer</Text>
            </View>
          ) : null}

          {/* Summary */}
          <View style={styles.card}>
            <Text style={styles.sectionLabel}>Summary</Text>
            <Text style={styles.summary}>{ai.customer_summary}</Text>

            <View style={styles.metaRow}>
              <MetaItem icon="time-outline" label={ai.estimated_duration || '-'} />
              {ai.labour_hours ? (
                <MetaItem icon="construct-outline" label={`${ai.labour_hours}h labour`} />
              ) : null}
            </View>

            <View style={styles.diagnosisBox}>
              <Text style={styles.diagnosisLabel}>On-site diagnosis</Text>
              <Text style={styles.diagnosisText}>{ai.diagnosis}</Text>
            </View>
          </View>

          {/* Line items */}
          <View style={styles.card}>
            <Text style={styles.sectionLabel}>Line items</Text>
            {(ai.line_items || []).map((li, idx) => (
              <View key={idx} style={[styles.lineItem, idx === 0 && { borderTopWidth: 0 }]}>
                <View style={{ flex: 1, paddingRight: spacing.sm }}>
                  <Text style={styles.lineDesc}>{li.description}</Text>
                  <Text style={styles.lineMeta}>
                    {li.qty} {li.unit} × {formatCurrency(li.unit_price)}
                  </Text>
                </View>
                <Text style={styles.lineTotal}>{formatCurrency(li.total)}</Text>
              </View>
            ))}

            {ai.vat && ai.vat > 0 ? (
              <View style={styles.totalsRow}>
                <Text style={styles.totalsLabel}>Subtotal</Text>
                <Text style={styles.totalsValue}>{formatCurrency(ai.subtotal)}</Text>
              </View>
            ) : null}
            {ai.vat && ai.vat > 0 ? (
              <View style={styles.totalsRow}>
                <Text style={styles.totalsLabel}>VAT</Text>
                <Text style={styles.totalsValue}>{formatCurrency(ai.vat)}</Text>
              </View>
            ) : null}

            {/* Editable total */}
            <View style={styles.totalEditRow}>
              <Text style={styles.grandTotalLabel}>Total</Text>
              <View style={styles.moneyEditWrap}>
                <Text style={styles.moneyEditPrefix}>£</Text>
                <TextInput
                  value={String(currentTotal)}
                  onChangeText={(txt) => {
                    const clean = txt.replace(/[^0-9.]/g, '');
                    updateEdit({ total: clean === '' ? 0 : Number(clean) });
                  }}
                  keyboardType="decimal-pad"
                  style={styles.moneyEditInput}
                  selectTextOnFocus
                />
              </View>
            </View>
            <Text style={styles.editHint}>Tap the total to adjust.</Text>
          </View>

          {/* Upsells */}
          {ai.upsells && ai.upsells.length > 0 ? (
            <View style={styles.card}>
              <Text style={styles.sectionLabel}>Suggested upsells</Text>
              {ai.upsells.map((up, idx) => (
                <View key={idx} style={styles.upsell}>
                  <View style={styles.upsellIcon}>
                    <Ionicons name="add-circle" size={22} color={colors.blue} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.upsellTitle}>{up.title}</Text>
                    <Text style={styles.upsellWhy}>{up.why}</Text>
                  </View>
                  <Text style={styles.upsellPrice}>{formatCurrency(up.price)}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {/* Notes to tradesperson */}
          {ai.notes_for_tradesperson ? (
            <View style={[styles.card, styles.tradieNotes]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
                <Ionicons name="bulb-outline" size={20} color={colors.warning} style={{ marginRight: 6 }} />
                <Text style={[styles.sectionLabel, { color: colors.warning, marginBottom: 0 }]}>
                  Heads up for you
                </Text>
              </View>
              <Text style={styles.tradieNotesText}>{ai.notes_for_tradesperson}</Text>
            </View>
          ) : null}

          {/* Custom notes */}
          <View style={styles.card}>
            <Text style={styles.sectionLabel}>Your notes (optional)</Text>
            <TextInput
              value={currentNotes}
              onChangeText={(v) => updateEdit({ notes: v })}
              placeholder="Anything to add for the customer?"
              placeholderTextColor={colors.grey500}
              multiline
              style={styles.notesInput}
            />
          </View>

          <Disclaimer />

          <View style={{ height: spacing.xl }} />

          {/* Primary action */}
          <BigButton
            label={sent ? 'Send Again' : 'Send to Customer'}
            icon="send"
            onPress={() => setSendModalOpen(true)}
          />

          <View style={{ height: spacing.sm }} />
          <BigButton
            label="Add to Calendar"
            icon="calendar-outline"
            variant="secondary"
            onPress={addCalendarEntry}
          />

          {sent ? (
            <>
              <View style={{ height: spacing.sm }} />
              <BigButton
                label="Done"
                icon="checkmark"
                variant="ghost"
                onPress={() => navigation.popToTop()}
              />
            </>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Send modal */}
      <SendModal
        visible={sendModalOpen}
        onClose={() => setSendModalOpen(false)}
        quote={quote}
        onSendSMS={sendViaSMS}
        onSendEmail={sendViaEmail}
        onSendPdf={sendAsPdf}
      />
    </SafeAreaView>
  );
}

/* ================================================================== */
/* Sub-components                                                     */
/* ================================================================== */

function MetaItem({ icon, label }) {
  return (
    <View style={styles.metaItem}>
      <Ionicons name={icon} size={16} color={colors.grey700} style={{ marginRight: 4 }} />
      <Text style={styles.metaText}>{label}</Text>
    </View>
  );
}

function SendModal({ visible, onClose, onSendSMS, onSendEmail, onSendPdf, quote }) {
  const [phone, setPhone] = useState(quote?.customer?.phone || '');
  const [email, setEmail] = useState(quote?.customer?.email || '');

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable style={styles.modalSheet} onPress={() => {}}>
          <View style={styles.modalHandle} />
          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: spacing.md }}
          >
            <Text style={styles.modalTitle}>Send quote</Text>
            <Text style={styles.modalHint}>
              Pick how you want it to reach the customer.
            </Text>

            <View style={{ height: spacing.md }} />
            <Text style={styles.modalLabel}>Phone number (optional)</Text>
            <TextInput
              value={phone}
              onChangeText={setPhone}
              placeholder="07…"
              placeholderTextColor={colors.grey500}
              keyboardType="phone-pad"
              style={styles.modalInput}
            />
            <View style={{ height: spacing.sm }} />
            <BigButton
              label="Send by Text"
              icon="chatbubble"
              onPress={() => onSendSMS(phone)}
            />

            <View style={{ height: spacing.lg }} />
            <Text style={styles.modalLabel}>Email (optional)</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="name@example.com"
              placeholderTextColor={colors.grey500}
              keyboardType="email-address"
              autoCapitalize="none"
              style={styles.modalInput}
            />
            <View style={{ height: spacing.sm }} />
            <BigButton
              label="Send by Email"
              icon="mail"
              variant="secondary"
              onPress={() => onSendEmail(email)}
            />

            {/* Divider + PDF option - separate because it's a different kind of send */}
            <View style={styles.modalDivider}>
              <View style={styles.modalDividerLine} />
              <Text style={styles.modalDividerText}>or</Text>
              <View style={styles.modalDividerLine} />
            </View>

            <BigButton
              label="Save as PDF"
              icon="document-text"
              variant="secondary"
              onPress={onSendPdf}
            />
            <Text style={styles.modalPdfHint}>
              Share via WhatsApp, AirDrop, or anywhere else.
            </Text>

            <View style={{ height: spacing.md }} />
            <Pressable onPress={onClose} style={styles.modalCancel} hitSlop={10}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </Pressable>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/* ================================================================== */
/* Styles                                                             */
/* ================================================================== */

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },

  errorWrap: { flex: 1, padding: spacing.lg, justifyContent: 'center' },

  sentBanner: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#DCEFE3',
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.md,
  },
  sentText: {
    ...type.body, color: colors.success, fontWeight: '700', marginLeft: spacing.sm,
  },

  card: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    ...shadow.card,
  },
  sectionLabel: {
    ...type.label,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    fontSize: 12,
    color: colors.grey500,
    marginBottom: spacing.sm,
  },

  summary: { ...type.h2, fontSize: 20, color: colors.navy, lineHeight: 28 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.sm },
  metaItem: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.grey100,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: radius.pill,
    marginRight: spacing.sm, marginBottom: spacing.xs,
  },
  metaText: { ...type.small, fontSize: 14, color: colors.grey700, fontWeight: '600' },

  diagnosisBox: {
    marginTop: spacing.md,
    padding: spacing.sm + 4,
    backgroundColor: colors.blueLight,
    borderRadius: radius.sm,
  },
  diagnosisLabel: { ...type.small, fontSize: 12, color: colors.blueDark, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 },
  diagnosisText: { ...type.body, fontSize: 16, marginTop: 4, lineHeight: 22, color: colors.navy },

  lineItem: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: spacing.sm + 2,
    borderTopWidth: 1, borderTopColor: colors.grey100,
  },
  lineDesc: { ...type.body, fontSize: 17, color: colors.grey900, fontWeight: '600' },
  lineMeta: { ...type.small, marginTop: 2 },
  lineTotal: { ...type.body, fontSize: 17, color: colors.navy, fontWeight: '700', fontVariant: ['tabular-nums'] },

  totalsRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: 4, marginTop: 2,
  },
  totalsLabel: { ...type.body, fontSize: 16, color: colors.grey500 },
  totalsValue: { ...type.body, fontSize: 16, color: colors.grey700, fontVariant: ['tabular-nums'] },

  totalEditRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 2, borderTopColor: colors.navy,
  },
  grandTotalLabel: { ...type.h2, fontSize: 20, color: colors.navy },
  moneyEditWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.blueLight,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm + 2,
    minHeight: 48,
    borderWidth: 1.5, borderColor: colors.blue,
  },
  moneyEditPrefix: { fontSize: 20, fontWeight: '700', color: colors.navy },
  moneyEditInput: {
    fontSize: 22, fontWeight: '800', color: colors.navy,
    minWidth: 80, textAlign: 'right',
    fontVariant: ['tabular-nums'],
    paddingVertical: 0,
  },
  editHint: { ...type.small, fontSize: 13, marginTop: 6, textAlign: 'right' },

  upsell: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: spacing.sm,
    borderTopWidth: 1, borderTopColor: colors.grey100,
  },
  upsellIcon: { marginRight: spacing.sm },
  upsellTitle: { ...type.body, fontSize: 16, color: colors.navy, fontWeight: '700' },
  upsellWhy: { ...type.small, marginTop: 2 },
  upsellPrice: { ...type.body, fontSize: 16, color: colors.blue, fontWeight: '700', fontVariant: ['tabular-nums'] },

  tradieNotes: { backgroundColor: '#FFF8E9' },
  tradieNotesText: { ...type.body, fontSize: 15, color: colors.grey900, lineHeight: 22 },

  notesInput: {
    minHeight: 80,
    backgroundColor: colors.white,
    borderWidth: 1.5, borderColor: colors.grey200,
    borderRadius: radius.sm,
    padding: spacing.sm + 2,
    fontSize: 17, color: colors.grey900, fontWeight: '500',
    textAlignVertical: 'top',
  },

  /* Send modal */
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,44,74,0.55)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
    maxHeight: '90%',
  },
  modalHandle: {
    width: 44, height: 5, borderRadius: 3,
    backgroundColor: colors.grey300,
    alignSelf: 'center',
    marginBottom: spacing.md,
  },
  modalTitle: { ...type.h1, fontSize: 24 },
  modalHint: { ...type.small, marginTop: 4 },
  modalLabel: { ...type.label, fontSize: 14, marginBottom: 6, color: colors.grey700 },
  modalInput: {
    minHeight: 52,
    backgroundColor: colors.white,
    borderWidth: 1.5, borderColor: colors.grey200,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    fontSize: 18, color: colors.grey900, fontWeight: '500',
  },
  modalCancel: { alignSelf: 'center', padding: spacing.sm },
  modalCancelText: { ...type.label, color: colors.grey500, fontSize: 16 },
  modalDivider: {
    flexDirection: 'row', alignItems: 'center',
    marginVertical: spacing.lg,
  },
  modalDividerLine: { flex: 1, height: 1, backgroundColor: colors.grey200 },
  modalDividerText: {
    ...type.small, fontSize: 13, color: colors.grey500,
    marginHorizontal: spacing.md, textTransform: 'uppercase', letterSpacing: 1,
  },
  modalPdfHint: { ...type.small, fontSize: 13, textAlign: 'center', marginTop: spacing.sm },
});
