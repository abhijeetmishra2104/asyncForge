import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Badge, Card, SectionHeading } from '@/components/ui';
import { ApiError, fetchJob } from '@/lib/api';
import { POLL_INTERVAL_MS } from '@/lib/config';
import { isTerminal, parseOutput, type AIOutput } from '@/lib/types';
import { colors, priorityColors, spacing, statusColors } from '@/theme';

const STAGE_HINT: Record<string, string> = {
  QUEUED: 'Durably stored in PostgreSQL. Waiting for the dispatcher to publish it to RabbitMQ.',
  PROCESSING: 'A worker has claimed the job and is calling Gemini.',
};

export default function JobScreen() {
  const { jobId } = useLocalSearchParams<{ jobId: string }>();

  const { data: job, error, isPending } = useQuery({
    queryKey: ['job', jobId],
    queryFn: () => fetchJob(jobId),
    enabled: Boolean(jobId),
    // Poll until the job reaches a terminal state, then stop. Combined with the
    // AppState wiring in _layout, this also pauses while the app is backgrounded.
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status && isTerminal(status) ? false : POLL_INTERVAL_MS;
    },
    // A missing job will never appear; retrying it is pure waste.
    retry: (failureCount, err) =>
      err instanceof ApiError && err.status === 404 ? false : failureCount < 2,
  });

  if (isPending) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.text} />
        <Text style={styles.centeredText}>Fetching from database...</Text>
      </View>
    );
  }

  if (error) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <ScrollView contentContainerStyle={styles.content}>
        <Card color={colors.red}>
          <View style={styles.cardBody}>
            <Text style={styles.errorTitle}>
              {notFound ? 'Job not found' : 'Something went wrong'}
            </Text>
            <Text style={styles.errorBody}>{error.message}</Text>
          </View>
        </Card>
      </ScrollView>
    );
  }

  const output = parseOutput(job.output);
  const hint = STAGE_HINT[job.status];

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Card color={statusColors[job.status]}>
        <View style={styles.bannerRow}>
          <View style={styles.bannerText}>
            <Text style={styles.bannerLabel}>Status</Text>
            <Text style={styles.bannerStatus}>{job.status}</Text>
          </View>
          {!isTerminal(job.status) ? (
            <ActivityIndicator size="small" color={colors.text} />
          ) : null}
        </View>
      </Card>

      {hint ? <Text style={styles.hint}>{hint}</Text> : null}

      <Text style={styles.meta}>
        Job {job.id}
        {typeof job.attempts === 'number' ? ` · ${job.attempts} attempt(s)` : ''}
      </Text>

      {job.status === 'FAILED' ? (
        <Card color={colors.surface}>
          <View style={styles.cardBody}>
            <SectionHeading>Failure</SectionHeading>
            <Text style={styles.body}>
              {job.error ?? 'The worker reported no error message.'}
            </Text>
          </View>
        </Card>
      ) : null}

      {job.status === 'COMPLETED' ? (
        output ? (
          <Result output={output} />
        ) : (
          <Card color={colors.orange}>
            <View style={styles.cardBody}>
              <SectionHeading>Unreadable result</SectionHeading>
              <Text style={styles.body}>
                The job completed, but the stored output did not match the
                expected schema. This usually means Gemini returned JSON in a shape
                the prompt did not constrain.
              </Text>
            </View>
          </Card>
        )
      ) : null}
    </ScrollView>
  );
}

function Result({ output }: { output: AIOutput }) {
  return (
    <>
      <Card color={colors.cyan}>
        <View style={styles.cardBody}>
          <SectionHeading>Summary</SectionHeading>
          <Text style={styles.body}>{output.summary}</Text>
        </View>
      </Card>

      {output.actionItems.length > 0 ? (
        <>
          <SectionHeading>Action items</SectionHeading>
          {output.actionItems.map((item, index) => (
            <Card key={`${item.title}-${index}`}>
              <View style={styles.cardBody}>
                <Badge
                  label={item.priority}
                  color={priorityColors[item.priority]}
                  style={styles.priorityBadge}
                />
                <Text style={styles.itemTitle}>{item.title}</Text>
                <Text style={styles.body}>{item.description}</Text>
              </View>
            </Card>
          ))}
        </>
      ) : null}

      {output.nextSteps.length > 0 ? (
        <Card color={colors.yellow}>
          <View style={styles.cardBody}>
            <SectionHeading>Next steps</SectionHeading>
            {output.nextSteps.map((step, index) => (
              <Text key={`${step}-${index}`} style={styles.step}>
                {index + 1}. {step}
              </Text>
            ))}
          </View>
        </Card>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xl * 2,
    gap: spacing.md,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    backgroundColor: colors.background,
  },
  centeredText: { fontSize: 18, fontWeight: '900', color: colors.text },
  cardBody: { padding: spacing.md, gap: spacing.sm },
  bannerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
  },
  bannerText: { gap: 2 },
  bannerLabel: {
    fontSize: 12,
    fontWeight: '900',
    color: colors.text,
    textTransform: 'uppercase',
  },
  bannerStatus: { fontSize: 32, fontWeight: '900', color: colors.text },
  hint: { fontSize: 14, fontWeight: '500', color: colors.muted },
  meta: { fontSize: 11, fontWeight: '600', color: colors.muted },
  body: { fontSize: 15, fontWeight: '500', color: colors.text, lineHeight: 22 },
  itemTitle: { fontSize: 18, fontWeight: '900', color: colors.text },
  priorityBadge: { marginBottom: spacing.xs },
  step: { fontSize: 15, fontWeight: '600', color: colors.text, lineHeight: 22 },
  errorTitle: {
    fontSize: 20,
    fontWeight: '900',
    color: colors.surface,
    textTransform: 'uppercase',
  },
  errorBody: { fontSize: 15, fontWeight: '500', color: colors.surface },
});
