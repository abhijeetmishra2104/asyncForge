import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Badge, Button, Card } from '@/components/ui';
import { submitPrompt } from '@/lib/api';
import { API_BASE_URL } from '@/lib/config';
import { PROMPT_MAX_LENGTH, PROMPT_MIN_LENGTH } from '@/lib/types';
import { borderWidth, colors, spacing } from '@/theme';

const STAGES = [
  { label: 'Accepted', color: colors.teal },
  { label: 'Queued', color: colors.orange },
  { label: 'Processing', color: colors.pink },
  { label: 'Completed', color: colors.purple },
];

export default function SubmitScreen() {
  const [prompt, setPrompt] = useState('');
  const router = useRouter();

  const submit = useMutation({
    mutationFn: submitPrompt,
    onSuccess: (jobId) => {
      setPrompt('');
      router.push({ pathname: '/jobs/[jobId]', params: { jobId } });
    },
  });

  const tooShort = prompt.trim().length < PROMPT_MIN_LENGTH;

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Submit AI Task</Text>
        <Text style={styles.subtitle}>
          Heavy LLM work, queued and processed off the request path.
        </Text>

        <View style={styles.stages}>
          {STAGES.map((stage, index) => (
            <View key={stage.label} style={styles.stageRow}>
              <Badge label={stage.label} color={stage.color} />
              {index < STAGES.length - 1 ? (
                <Text style={styles.arrow}>{'›'}</Text>
              ) : null}
            </View>
          ))}
        </View>

        <Card>
          <TextInput
            value={prompt}
            onChangeText={setPrompt}
            editable={!submit.isPending}
            multiline
            textAlignVertical="top"
            maxLength={PROMPT_MAX_LENGTH}
            placeholder="e.g. Plan the backend architecture for a highly concurrent competitive programming platform..."
            placeholderTextColor={colors.muted}
            style={styles.input}
          />
          <View style={styles.counterRow}>
            <Text style={styles.counter}>
              {tooShort
                ? `${PROMPT_MIN_LENGTH - prompt.trim().length} more characters needed`
                : `${prompt.length} / ${PROMPT_MAX_LENGTH}`}
            </Text>
          </View>
        </Card>

        <Button
          label={submit.isPending ? 'Forging...' : 'Execute'}
          disabled={tooShort || submit.isPending}
          onPress={() => submit.mutate(prompt.trim())}
        />

        {submit.isError ? (
          <Card color={colors.red}>
            <Text style={styles.errorTitle}>Submit failed</Text>
            <Text style={styles.errorBody}>{submit.error.message}</Text>
          </Card>
        ) : null}

        <Text style={styles.endpoint}>API · {API_BASE_URL}</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xl * 2,
    gap: spacing.md,
  },
  title: {
    fontSize: 38,
    fontWeight: '900',
    color: colors.text,
    textTransform: 'uppercase',
    letterSpacing: -1,
  },
  subtitle: {
    fontSize: 16,
    fontWeight: '500',
    color: colors.muted,
    marginTop: -spacing.sm,
  },
  stages: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.xs,
  },
  stageRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  arrow: { fontSize: 18, fontWeight: '900', color: colors.text },
  input: {
    minHeight: 160,
    padding: spacing.md,
    fontSize: 16,
    fontWeight: '500',
    color: colors.text,
  },
  counterRow: {
    borderTopWidth: borderWidth,
    borderTopColor: colors.border,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.yellow,
  },
  counter: { fontSize: 13, fontWeight: '900', color: colors.text },
  errorTitle: {
    fontSize: 16,
    fontWeight: '900',
    color: colors.surface,
    padding: spacing.md,
    paddingBottom: spacing.xs,
    textTransform: 'uppercase',
  },
  errorBody: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.surface,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  endpoint: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.muted,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
});
