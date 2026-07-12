// components/ui/index.tsx — Primitives RN du Design System v2 « Sérénité Premium ».
// StyleSheet fidèle aux tokens (fond papier, or & forêt, ombres chaudes,
// cibles généreuses au pouce). Aucune valeur hex en dur : tout vient de `@/tokens`.
import React from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  type ViewStyle,
  type TextStyle,
  type StyleProp,
  type TextInputProps,
} from 'react-native';
import { tokens } from '@/tokens';

/* -------------------------------------------------------------------------- */
/*  Button — primary (fond brand + ombre brand) / secondary (contour) / ghost */
/* -------------------------------------------------------------------------- */

export interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
  disabled?: boolean;
  testID?: string;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  testID,
  accessibilityLabel,
  style,
}: ButtonProps): React.JSX.Element {
  const isPrimary = variant === 'primary';
  const isSecondary = variant === 'secondary';
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.85}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      style={[
        btn.base,
        isPrimary && btn.primary,
        isSecondary && btn.secondary,
        variant === 'ghost' && btn.ghost,
        disabled && btn.disabled,
        style,
      ]}
    >
      <Text
        style={[
          btn.label,
          isPrimary && btn.labelPrimary,
          (isSecondary || variant === 'ghost') && btn.labelInk,
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const btn = StyleSheet.create({
  base: {
    minHeight: tokens.minTouchTarget + 8, // cibles généreuses au pouce
    borderRadius: tokens.radius.button,
    paddingHorizontal: tokens.spacing.xl,
    paddingVertical: tokens.spacing.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  primary: {
    backgroundColor: tokens.colors.brand,
    ...tokens.shadow.brand,
  },
  secondary: {
    backgroundColor: tokens.colors.surface1,
    borderWidth: 1.5,
    borderColor: tokens.colors.inkStrong,
  },
  ghost: {
    backgroundColor: 'transparent',
  },
  disabled: {
    backgroundColor: tokens.colors.surface2,
    opacity: 0.6,
  },
  label: {
    fontSize: tokens.fontSize.md,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  labelPrimary: { color: tokens.colors.brandContrast },
  labelInk: { color: tokens.colors.inkStrong },
});

/* -------------------------------------------------------------------------- */
/*  Card — surface-1, rayon lg, ombre chaude douce                            */
/* -------------------------------------------------------------------------- */

export interface CardProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  tone?: 'paper' | 'night';
}

export function Card({ children, style, testID, tone = 'paper' }: CardProps): React.JSX.Element {
  return (
    <View
      testID={testID}
      style={[card.base, tone === 'night' ? card.night : card.paper, style]}
    >
      {children}
    </View>
  );
}

const card = StyleSheet.create({
  base: {
    borderRadius: tokens.radius.lg,
    padding: tokens.spacing.xl,
    ...tokens.shadow.card,
  },
  paper: { backgroundColor: tokens.colors.surface1 },
  night: { backgroundColor: tokens.colors.night },
});

/* -------------------------------------------------------------------------- */
/*  Field — surface-2 au repos, label discret, erreur inline sous le champ    */
/* -------------------------------------------------------------------------- */

export interface FieldProps extends TextInputProps {
  label?: string;
  error?: string;
  containerStyle?: StyleProp<ViewStyle>;
  labelStyle?: StyleProp<TextStyle>;
}

export function Field({
  label,
  error,
  containerStyle,
  labelStyle,
  style,
  ...rest
}: FieldProps): React.JSX.Element {
  return (
    <View style={[field.container, containerStyle]}>
      {label ? <Text style={[field.label, labelStyle]}>{label}</Text> : null}
      <TextInput
        placeholderTextColor={tokens.colors.inkFaint}
        style={[field.input, !!error && field.inputError, style]}
        {...rest}
      />
      {error ? <Text style={field.error}>{error}</Text> : null}
    </View>
  );
}

const field = StyleSheet.create({
  container: {
    marginBottom: tokens.spacing.lg,
  },
  label: {
    fontSize: tokens.fontSize.sm,
    color: tokens.colors.inkSoft,
    marginBottom: tokens.spacing.sm,
    fontWeight: '600',
  },
  input: {
    minHeight: tokens.minTouchTarget + 6,
    backgroundColor: tokens.colors.surface2,
    borderWidth: 1,
    borderColor: tokens.colors.hairline,
    borderRadius: tokens.radius.md,
    paddingHorizontal: tokens.spacing.lg,
    paddingVertical: tokens.spacing.md,
    fontSize: tokens.fontSize.md,
    color: tokens.colors.inkStrong,
  },
  inputError: {
    borderColor: tokens.colors.danger,
    borderWidth: 1.5,
  },
  error: {
    fontSize: tokens.fontSize.sm,
    color: tokens.colors.danger,
    marginTop: tokens.spacing.sm,
  },
});

/* -------------------------------------------------------------------------- */
/*  Screen — conteneur d'écran (fond papier, padding généreux)                */
/* -------------------------------------------------------------------------- */

export interface ScreenTitleProps {
  children: React.ReactNode;
  style?: StyleProp<TextStyle>;
  testID?: string;
}

export function ScreenTitle({ children, style, testID }: ScreenTitleProps): React.JSX.Element {
  return (
    <Text testID={testID} style={[title.text, style]}>
      {children}
    </Text>
  );
}

const title = StyleSheet.create({
  text: {
    fontSize: tokens.fontSize.xl,
    fontWeight: '700',
    color: tokens.colors.inkStrong,
    letterSpacing: -0.3,
    marginBottom: tokens.spacing.xl,
  },
});

export const screenBg = tokens.colors.surface0;
