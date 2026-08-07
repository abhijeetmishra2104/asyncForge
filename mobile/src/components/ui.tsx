import { type ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { borderWidth, colors, shadowOffset, spacing } from '@/theme';

/**
 * The web app's `shadow-[8px_8px_0px_0px_#000]` look. React Native's shadow
 * primitives are blurred and platform-divergent, so the offset is drawn as a
 * plain black View sitting behind the content instead.
 */
export function Card({
  children,
  color = colors.surface,
  offset = shadowOffset,
  style,
}: {
  children: ReactNode;
  color?: string;
  offset?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={{ marginRight: offset, marginBottom: offset }}>
      <View
        style={[
          styles.shadow,
          { top: offset, left: offset, right: -offset, bottom: -offset },
        ]}
      />
      <View style={[styles.bordered, { backgroundColor: color }, style]}>
        {children}
      </View>
    </View>
  );
}

export function Button({
  label,
  onPress,
  disabled = false,
  color = colors.teal,
  offset = shadowOffset,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  color?: string;
  offset?: number;
}) {
  return (
    <View
      style={{
        marginRight: offset,
        marginBottom: offset,
        opacity: disabled ? 0.45 : 1,
      }}>
      <View
        style={[
          styles.shadow,
          { top: offset, left: offset, right: -offset, bottom: -offset },
        ]}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onPress}
        // Pressing collapses the card onto its shadow, the native equivalent of
        // the web build's active:translate-y-1 treatment.
        style={({ pressed }) => [
          styles.bordered,
          styles.button,
          { backgroundColor: color },
          pressed && !disabled
            ? { transform: [{ translateX: offset }, { translateY: offset }] }
            : null,
        ]}>
        <Text style={styles.buttonLabel}>{label}</Text>
      </Pressable>
    </View>
  );
}

export function Badge({
  label,
  color,
  style,
}: {
  label: string;
  color: string;
  style?: StyleProp<TextStyle>;
}) {
  return (
    <Text style={[styles.badge, { backgroundColor: color }, style]}>{label}</Text>
  );
}

export function SectionHeading({ children }: { children: ReactNode }) {
  return <Text style={styles.sectionHeading}>{children}</Text>;
}

const styles = StyleSheet.create({
  shadow: {
    position: 'absolute',
    backgroundColor: colors.border,
  },
  bordered: {
    borderWidth,
    borderColor: colors.border,
  },
  button: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
  },
  buttonLabel: {
    fontSize: 20,
    fontWeight: '900',
    color: colors.text,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  badge: {
    borderWidth: 2,
    borderColor: colors.border,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    fontSize: 12,
    fontWeight: '900',
    color: colors.text,
    textTransform: 'uppercase',
    overflow: 'hidden',
    alignSelf: 'flex-start',
  },
  sectionHeading: {
    fontSize: 22,
    fontWeight: '900',
    color: colors.text,
    marginBottom: spacing.sm,
    textTransform: 'uppercase',
  },
});
