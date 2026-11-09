import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, Image, Modal, Alert, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import * as Haptics from 'expo-haptics';

import BigButton from '../components/BigButton';
import ErrorBanner from '../components/ErrorBanner';
import { colors, spacing, type, radius, shadow } from '../theme/colors';
import { formatDuration } from '../utils/formatters';

const MAX_PHOTOS = 3;
const MIN_VOICE_SEC = 3;
const MAX_VOICE_SEC = 30;

export default function CaptureScreen({ navigation }) {
  const [photos, setPhotos] = useState([]);              // array of { uri, size }
  const [cameraOpen, setCameraOpen] = useState(false);

  const [recording, setRecording] = useState(null);      // Audio.Recording instance
  const [isRecording, setIsRecording] = useState(false);
  const [recordSecs, setRecordSecs] = useState(0);
  const [voiceUri, setVoiceUri] = useState(null);
  const [voiceDuration, setVoiceDuration] = useState(0);

  const [playbackSound, setPlaybackSound] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const [error, setError] = useState(null);
  const [camPermission, requestCamPermission] = useCameraPermissions();
  const recTimerRef = useRef(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recTimerRef.current) clearInterval(recTimerRef.current);
      if (recording) recording.stopAndUnloadAsync().catch(() => {});
      if (playbackSound) playbackSound.unloadAsync().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* =================================================================== */
  /* Photos                                                              */
  /* =================================================================== */

  const openCamera = async () => {
    setError(null);
    if (photos.length >= MAX_PHOTOS) {
      setError(`Max ${MAX_PHOTOS} photos - delete one to add another.`);
      return;
    }
    if (!camPermission?.granted) {
      const res = await requestCamPermission();
      if (!res.granted) {
        setError('Camera permission needed - enable it in Settings to take photos.');
        return;
      }
    }
    setCameraOpen(true);
  };

  const cameraRef = useRef(null);
  const takePicture = async () => {
    if (!cameraRef.current) return;
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
      const pic = await cameraRef.current.takePictureAsync({
        quality: 0.6,
        skipProcessing: false,
      });
      // Cheap validation - if size is absurdly small, likely a bad frame
      let size = 0;
      try {
        const info = await FileSystem.getInfoAsync(pic.uri);
        size = info.size || 0;
      } catch (_) {}
      if (size > 0 && size < 50_000) {
        setError('Photo looks blank - retake?');
        return;
      }
      setPhotos((prev) => [...prev, { uri: pic.uri, size }]);
      if (photos.length + 1 >= MAX_PHOTOS) {
        setCameraOpen(false);
      }
    } catch (e) {
      console.warn('takePicture failed', e);
      setError('Camera hiccup - try again.');
    }
  };

  const removePhoto = (idx) => {
    Haptics.selectionAsync().catch(() => {});
    setPhotos((prev) => prev.filter((_, i) => i !== idx));
  };

  /* =================================================================== */
  /* Voice                                                               */
  /* =================================================================== */

  const startRecording = async () => {
    setError(null);
    try {
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) {
        setError('Mic permission needed - enable it in Settings to record a voice note.');
        return;
      }
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      // Ditch any prior recording/playback
      if (playbackSound) {
        await playbackSound.unloadAsync().catch(() => {});
        setPlaybackSound(null);
      }
      setVoiceUri(null);
      setVoiceDuration(0);

      const { recording: rec } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      setRecording(rec);
      setIsRecording(true);
      setRecordSecs(0);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});

      recTimerRef.current = setInterval(() => {
        setRecordSecs((s) => {
          const next = s + 1;
          if (next >= MAX_VOICE_SEC) {
            // Auto-stop at the cap
            stopRecording();
          }
          return next;
        });
      }, 1000);
    } catch (e) {
      console.warn('startRecording failed', e);
      setError('Mic unavailable - try again.');
    }
  };

  const stopRecording = async () => {
    try {
      if (recTimerRef.current) {
        clearInterval(recTimerRef.current);
        recTimerRef.current = null;
      }
      if (!recording) {
        setIsRecording(false);
        return;
      }
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      // Capture status BEFORE unloading - after unload, status is gone.
      const preStopStatus = await recording.getStatusAsync().catch(() => null);
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();

      // Prefer the wall-clock timer (recordSecs) - it's always reliable.
      // Fall back to the reported durationMillis only if the timer somehow didn't tick.
      const reportedMs = preStopStatus?.durationMillis ?? 0;
      const timerMs = recordSecs * 1000;
      const durMs = Math.max(timerMs, reportedMs);
      const durSec = Math.round(durMs / 1000);

      setIsRecording(false);
      setRecording(null);

      if (durSec < MIN_VOICE_SEC) {
        setError(`Voice too short - try again (at least ${MIN_VOICE_SEC} seconds).`);
        setVoiceUri(null);
        setVoiceDuration(0);
        return;
      }
      setVoiceUri(uri);
      setVoiceDuration(durSec);
    } catch (e) {
      console.warn('stopRecording failed', e);
      setIsRecording(false);
      setRecording(null);
      setError('Recording hiccup - try again.');
    }
  };

  const togglePlayback = async () => {
    if (!voiceUri) return;
    try {
      if (isPlaying && playbackSound) {
        await playbackSound.pauseAsync();
        setIsPlaying(false);
        return;
      }
      if (playbackSound) {
        await playbackSound.playFromPositionAsync(0);
        setIsPlaying(true);
        return;
      }
      const { sound } = await Audio.Sound.createAsync({ uri: voiceUri });
      sound.setOnPlaybackStatusUpdate((st) => {
        if (st.didJustFinish) {
          setIsPlaying(false);
          sound.setPositionAsync(0).catch(() => {});
        }
      });
      setPlaybackSound(sound);
      await sound.playAsync();
      setIsPlaying(true);
    } catch (e) {
      console.warn('playback failed', e);
    }
  };

  const deleteVoice = async () => {
    if (playbackSound) {
      await playbackSound.unloadAsync().catch(() => {});
      setPlaybackSound(null);
    }
    setVoiceUri(null);
    setVoiceDuration(0);
    setIsPlaying(false);
    Haptics.selectionAsync().catch(() => {});
  };

  /* =================================================================== */
  /* Generate                                                            */
  /* =================================================================== */

  const canGenerate = photos.length > 0 && !!voiceUri && !isRecording;

  const handleGenerate = () => {
    if (!canGenerate) return;
    // Wired to Review in Step 2. Alert confirms the inputs for now.
    const payload = {
      photos: photos.map((p) => p.uri),
      voiceUri,
      voiceDuration,
    };
    if (navigation.getState()?.routeNames.includes('Review')) {
      navigation.navigate('Review', payload);
    } else {
      Alert.alert(
        'Ready to generate',
        `${photos.length} photo(s) + ${voiceDuration}s voice note.\n\nThe Review screen lands in Step 2.`,
      );
    }
  };

  /* =================================================================== */
  /* Render                                                              */
  /* =================================================================== */

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {error ? (
          <ErrorBanner
            message={error}
            actionLabel="Dismiss"
            onAction={() => setError(null)}
          />
        ) : null}

        {/* Step 1: Photos */}
        <StepHeader
          num="1"
          title="Photos of the issue"
          hint={`Up to ${MAX_PHOTOS} photos. Get close and clear.`}
        />

        <View style={styles.photoRow}>
          {photos.map((p, i) => (
            <View key={p.uri} style={styles.thumbWrap}>
              <Image source={{ uri: p.uri }} style={styles.thumb} />
              <Pressable
                onPress={() => removePhoto(i)}
                style={styles.thumbRemove}
                hitSlop={10}
                accessibilityLabel="Remove photo"
              >
                <Ionicons name="close" size={18} color={colors.white} />
              </Pressable>
            </View>
          ))}
          {photos.length < MAX_PHOTOS ? (
            <Pressable onPress={openCamera} style={styles.thumbAdd}>
              <Ionicons name="add" size={36} color={colors.blue} />
              <Text style={styles.thumbAddLabel}>
                {photos.length === 0 ? 'Add' : 'More'}
              </Text>
            </Pressable>
          ) : null}
        </View>

        <BigButton
          label={photos.length === 0 ? 'Take Photos' : 'Add Another Photo'}
          icon="camera"
          onPress={openCamera}
          variant={photos.length === 0 ? 'primary' : 'secondary'}
          disabled={photos.length >= MAX_PHOTOS}
          style={{ marginTop: spacing.md }}
        />

        {/* Step 2: Voice */}
        <View style={{ height: spacing.xl }} />
        <StepHeader
          num="2"
          title="Voice note"
          hint={`${MIN_VOICE_SEC}–${MAX_VOICE_SEC} sec. Speak naturally - e.g. "leaking 3/4 copper pipe under kitchen sink, fix today".`}
        />

        {isRecording ? (
          <View style={styles.recordingCard}>
            <View style={styles.pulseDot} />
            <Text style={styles.recordingText}>Recording…</Text>
            <Text style={styles.recordingTime}>{formatDuration(recordSecs)}</Text>
            <Text style={styles.recordingHint}>
              Tap stop when you're done (auto-stops at {MAX_VOICE_SEC}s)
            </Text>
          </View>
        ) : voiceUri ? (
          <View style={styles.voiceCard}>
            <Pressable
              onPress={togglePlayback}
              style={styles.playBtn}
              hitSlop={10}
              accessibilityLabel={isPlaying ? 'Pause voice note' : 'Play voice note'}
            >
              <Ionicons
                name={isPlaying ? 'pause' : 'play'}
                size={26}
                color={colors.white}
              />
            </Pressable>
            <View style={styles.voiceMeta}>
              <Text style={styles.voiceTitle}>Voice note saved</Text>
              <Text style={styles.voiceDur}>{formatDuration(voiceDuration)}</Text>
            </View>
            <Pressable onPress={deleteVoice} hitSlop={10} style={styles.voiceDelete}>
              <Ionicons name="trash-outline" size={22} color={colors.danger} />
            </Pressable>
          </View>
        ) : null}

        {isRecording ? (
          <BigButton
            label="Stop Recording"
            icon="stop-circle"
            variant="danger"
            onPress={stopRecording}
            style={{ marginTop: spacing.md }}
          />
        ) : (
          <BigButton
            label={voiceUri ? 'Re-record Voice Note' : 'Record Voice Note'}
            icon="mic"
            variant={voiceUri ? 'secondary' : 'primary'}
            onPress={startRecording}
            style={{ marginTop: spacing.md }}
          />
        )}

        {/* Step 3: Generate */}
        <View style={{ height: spacing.xxl }} />
        <BigButton
          label="Generate Quote"
          icon="sparkles"
          onPress={handleGenerate}
          disabled={!canGenerate}
          style={styles.generateBtn}
        />
        <Text style={styles.generateHint}>
          {canGenerate
            ? 'Takes about 10 seconds. You can edit before sending.'
            : photos.length === 0
            ? 'Add at least 1 photo to continue.'
            : !voiceUri
            ? 'Record a voice note to continue.'
            : ''}
        </Text>
      </ScrollView>

      {/* Camera modal */}
      <Modal
        visible={cameraOpen}
        animationType="slide"
        onRequestClose={() => setCameraOpen(false)}
      >
        <View style={styles.camContainer}>
          {cameraOpen && camPermission?.granted ? (
            <CameraView
              ref={cameraRef}
              style={StyleSheet.absoluteFill}
              facing="back"
            />
          ) : null}

          {/* Top bar */}
          <SafeAreaView edges={['top']} style={styles.camTopBar}>
            <Pressable
              onPress={() => setCameraOpen(false)}
              style={styles.camClose}
              hitSlop={14}
            >
              <Ionicons name="close" size={28} color={colors.white} />
            </Pressable>
            <View style={styles.camCounter}>
              <Text style={styles.camCounterText}>
                {photos.length} / {MAX_PHOTOS}
              </Text>
            </View>
            <View style={{ width: 48 }} />
          </SafeAreaView>

          {/* Shutter */}
          <SafeAreaView edges={['bottom']} style={styles.camBottomBar}>
            <Pressable
              onPress={takePicture}
              style={({ pressed }) => [styles.shutter, pressed && { transform: [{ scale: 0.94 }] }]}
              accessibilityLabel="Take photo"
              accessibilityRole="button"
            >
              <View style={styles.shutterInner} />
            </Pressable>
          </SafeAreaView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// Sub-components

function StepHeader({ num, title, hint }) {
  return (
    <View style={styles.stepHeader}>
      <View style={styles.stepBadge}>
        <Text style={styles.stepBadgeText}>{num}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.stepTitle}>{title}</Text>
        <Text style={styles.stepHint}>{hint}</Text>
      </View>
    </View>
  );
}

// Styles

const THUMB_SIZE = 96;

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },

  /* Step header */
  stepHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: spacing.md,
  },
  stepBadge: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: colors.navy,
    alignItems: 'center', justifyContent: 'center',
    marginRight: spacing.md,
    marginTop: 2,
  },
  stepBadgeText: { color: colors.white, fontSize: 16, fontWeight: '800' },
  stepTitle: { ...type.h2, fontSize: 20 },
  stepHint: { ...type.small, fontSize: 15, marginTop: 2, lineHeight: 20 },

  /* Photos */
  photoRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm + 2,
  },
  thumbWrap: {
    width: THUMB_SIZE, height: THUMB_SIZE,
    borderRadius: radius.md,
    overflow: 'visible',
  },
  thumb: {
    width: THUMB_SIZE, height: THUMB_SIZE,
    borderRadius: radius.md,
    backgroundColor: colors.grey200,
  },
  thumbRemove: {
    position: 'absolute', top: -6, right: -6,
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: colors.grey900,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: colors.bg,
  },
  thumbAdd: {
    width: THUMB_SIZE, height: THUMB_SIZE,
    borderRadius: radius.md,
    borderWidth: 2, borderColor: colors.blue, borderStyle: 'dashed',
    backgroundColor: colors.blueLight,
    alignItems: 'center', justifyContent: 'center',
  },
  thumbAddLabel: {
    ...type.label, color: colors.blue, fontSize: 14, marginTop: 2,
  },

  /* Recording card */
  recordingCard: {
    backgroundColor: colors.white,
    borderRadius: radius.md,
    padding: spacing.lg,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: colors.danger,
    ...shadow.card,
  },
  pulseDot: {
    width: 14, height: 14, borderRadius: 7,
    backgroundColor: colors.danger,
    marginBottom: spacing.sm,
  },
  recordingText: { ...type.h2, fontSize: 18, color: colors.danger },
  recordingTime: {
    fontSize: 48, fontWeight: '800', color: colors.navy,
    marginTop: spacing.xs,
    fontVariant: ['tabular-nums'],
  },
  recordingHint: { ...type.small, marginTop: spacing.xs, textAlign: 'center' },

  /* Voice saved card */
  voiceCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: radius.md,
    padding: spacing.md,
    ...shadow.card,
  },
  playBtn: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: colors.blue,
    alignItems: 'center', justifyContent: 'center',
    marginRight: spacing.md,
  },
  voiceMeta: { flex: 1 },
  voiceTitle: { ...type.body, fontWeight: '700', color: colors.navy },
  voiceDur: { ...type.small, marginTop: 2, fontVariant: ['tabular-nums'] },
  voiceDelete: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center',
  },

  /* Generate */
  generateBtn: {
    minHeight: 84,
    backgroundColor: colors.navy,
  },
  generateHint: {
    ...type.small,
    textAlign: 'center',
    marginTop: spacing.sm,
  },

  /* Camera modal */
  camContainer: { flex: 1, backgroundColor: '#000' },
  camTopBar: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    zIndex: 2,
  },
  camClose: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center', justifyContent: 'center',
  },
  camCounter: {
    flex: 1, alignItems: 'center',
  },
  camCounterText: {
    color: colors.white, fontSize: 17, fontWeight: '700',
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 14, paddingVertical: 6,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  camBottomBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    alignItems: 'center',
    paddingBottom: spacing.lg,
    paddingTop: spacing.md,
  },
  shutter: {
    width: 84, height: 84, borderRadius: 42,
    backgroundColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 4, borderColor: colors.white,
  },
  shutterInner: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: colors.white,
  },
});
