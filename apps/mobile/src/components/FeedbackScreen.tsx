// FeedbackScreen.tsx — MOB-005
// Écran feedback post-service : note 1-5 étoiles + commentaire optionnel ≤ 500 chars
// Registre de copie SIGFA : "Donner mon avis", "Merci pour votre retour !", "Un mot à ajouter ? (facultatif)"
import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { tokens } from '@/tokens';
import { i18n } from '@/i18n';

export type FeedbackScreenState = 'nominal' | 'loading' | 'success' | 'error' | 'empty';

export interface FeedbackSubmitParams {
  rating: number;
  comment?: string;
}

export interface FeedbackScreenProps {
  trackingId: string;
  onSubmit: (params: FeedbackSubmitParams) => void;
  screenState: FeedbackScreenState;
  errorMessage?: string;
  initialRating?: number;
  initialComment?: string;
}

/**
 * FeedbackScreen — écran de feedback post-service.
 * Copie SIGFA:
 *   - Bouton: "Donner mon avis"
 *   - Confirmation: "Merci pour votre retour !"
 *   - Label commentaire: "Un mot à ajouter ? (facultatif)"
 */
export function FeedbackScreen({
  onSubmit,
  screenState,
  errorMessage,
  initialRating = 0,
  initialComment = '',
}: FeedbackScreenProps): React.JSX.Element {
  const [rating, setRating] = useState<number>(initialRating);
  const [comment, setComment] = useState<string>(initialComment);

  // === État SUCCESS ===
  if (screenState === 'success') {
    return (
      <View style={styles.center} testID="feedback-success">
        <Text style={styles.successLabel}>{i18n.t('feedback.success')}</Text>
      </View>
    );
  }

  // === État LOADING ===
  if (screenState === 'loading') {
    return (
      <View style={styles.center} testID="feedback-loading">
        <ActivityIndicator size="large" color={tokens.colors.brand} />
        <Text style={styles.loadingLabel}>{i18n.t('screen.loading')}</Text>
      </View>
    );
  }

  // === État EMPTY (aucun feedback à donner) ===
  if (screenState === 'empty') {
    return (
      <View style={styles.center} testID="feedback-empty">
        <Text style={styles.emptyLabel}>{i18n.t('screen.empty')}</Text>
      </View>
    );
  }

  // === État ERROR ===
  const showError = screenState === 'error' && errorMessage;

  // === Formulaire (nominal + error) ===
  return (
    <View style={styles.container} testID="feedback-form">
      {showError && (
        <View style={styles.errorBanner} testID="feedback-error">
          <Text style={styles.errorLabel}>{errorMessage}</Text>
        </View>
      )}

      {/* Étoiles 1-5 */}
      <Text style={styles.sectionLabel}>{i18n.t('feedback.stars')}</Text>
      <View style={styles.starsRow} testID="feedback-stars">
        {[1, 2, 3, 4, 5].map(star => (
          <TouchableOpacity
            key={star}
            onPress={() => setRating(star)}
            testID={`feedback-star-${star}`}
            style={styles.starButton}
          >
            <Text style={[styles.star, rating >= star && styles.starFilled]}>
              {rating >= star ? '★' : '☆'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Commentaire optionnel ≤ 500 chars */}
      <Text style={styles.sectionLabel}>{i18n.t('feedback.commentLabel')}</Text>
      <TextInput
        testID="feedback-comment"
        style={styles.commentInput}
        value={comment}
        onChangeText={text => setComment(text.slice(0, 500))}
        placeholder={i18n.t('feedback.commentPlaceholder')}
        multiline
        maxLength={500}
        placeholderTextColor={tokens.colors.inkFaint}
      />

      {/* Bouton "Donner mon avis" */}
      <TouchableOpacity
        testID="feedback-submit"
        onPress={() => onSubmit({ rating, comment: comment || undefined })}
        style={styles.submitButton}
      >
        <Text style={styles.submitText}>{i18n.t('feedback.submit')}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: tokens.colors.surface0,
    padding: tokens.spacing.xl,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: tokens.colors.surface0,
    padding: tokens.spacing.xl,
  },

  // Section labels
  sectionLabel: {
    fontSize: tokens.fontSize.md,
    color: tokens.colors.inkStrong,
    fontWeight: '700',
    marginBottom: tokens.spacing.md,
    marginTop: tokens.spacing.lg,
  },

  // Stars
  starsRow: {
    flexDirection: 'row',
    marginBottom: tokens.spacing.lg,
  },
  starButton: {
    minHeight: tokens.minTouchTarget + 8,
    minWidth: tokens.minTouchTarget + 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  star: {
    fontSize: 40,
    color: tokens.colors.inkFaint,
  },
  starFilled: {
    color: tokens.colors.gold,
  },

  // Comment
  commentInput: {
    backgroundColor: tokens.colors.surface2,
    borderWidth: 1,
    borderColor: tokens.colors.hairline,
    borderRadius: tokens.radius.md,
    padding: tokens.spacing.lg,
    minHeight: 120,
    fontSize: tokens.fontSize.md,
    color: tokens.colors.inkStrong,
    textAlignVertical: 'top',
    marginBottom: tokens.spacing.xl,
  },

  // Submit button
  submitButton: {
    backgroundColor: tokens.colors.brand,
    paddingHorizontal: tokens.spacing.xl,
    paddingVertical: tokens.spacing.md,
    borderRadius: tokens.radius.button,
    minHeight: tokens.minTouchTarget + 8,
    justifyContent: 'center',
    alignItems: 'center',
    ...tokens.shadow.brand,
  },
  submitText: {
    color: tokens.colors.brandContrast,
    fontSize: tokens.fontSize.md,
    fontWeight: '700',
  },

  // States
  successLabel: {
    fontSize: tokens.fontSize.xl,
    fontWeight: '700',
    color: tokens.colors.forest,
    textAlign: 'center',
  },
  loadingLabel: {
    fontSize: tokens.fontSize.md,
    color: tokens.colors.inkSoft,
    marginTop: tokens.spacing.md,
  },
  emptyLabel: {
    fontSize: tokens.fontSize.md,
    color: tokens.colors.inkSoft,
    textAlign: 'center',
  },

  // Error
  errorBanner: {
    backgroundColor: tokens.colors.dangerSoft,
    borderRadius: tokens.radius.md,
    padding: tokens.spacing.lg,
    marginBottom: tokens.spacing.md,
  },
  errorLabel: {
    color: tokens.colors.danger,
    fontSize: tokens.fontSize.md,
    textAlign: 'center',
  },
});
