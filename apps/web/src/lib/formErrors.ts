import { ApiError } from '@/lib/api';

/**
 * Field-level messages keyed by the `name` of the field they belong to — exactly the
 * shape HeroUI's `Form` takes as `validationErrors`, so a form hands this straight to it
 * and the message lands in that field's `FieldError`.
 */
export type FieldErrors = Record<string, string>;

export interface FormErrorState {
  /** Rendered as an `ErrorText` under the fields. `null` once the failure was attributed to a field instead. */
  formError: string | null;
  fieldErrors: FieldErrors;
}

/** The cleared state every form starts from and resets to before a submit. */
export const NO_FORM_ERRORS: FormErrorState = Object.freeze({
  formError: null,
  fieldErrors: Object.freeze({}) as FieldErrors,
});

/**
 * The message a failed request should show: an `ApiError`'s own message, or
 * `fallbackMessage` for anything else — a network failure, or a thrown non-`ApiError`.
 * The one place that unwraps `unknown` into user-facing text outside a form's own
 * field/form-level split (a query's error string, a confirmation dialog's own error
 * state), so a change to how a non-`ApiError` failure reads has one call site to update
 * instead of a copy of this ternary at each.
 */
export function apiErrorMessage(
  error: unknown,
  fallbackMessage: string,
): string {
  return error instanceof ApiError ? error.message : fallbackMessage;
}

/**
 * Turns a rejected request into the two things a form can display: a form-level message,
 * or a message attached to one field.
 *
 * `fieldByStatus` is that attribution, declared at the call site as "on this endpoint, this
 * HTTP status is about this field". It is deliberately keyed by status and nothing else:
 * `apps/api` returns no machine-readable error code, and the previous approach — regex-matching
 * the API's prose (`/current password is incorrect/i` in `PasswordSection`) — silently turned a
 * field error into a form error the day someone reworded the message. A status the map does not
 * name, and any non-`ApiError` failure, falls back to the form-level line.
 */
export function toFormErrorState(
  error: unknown,
  fallbackMessage: string,
  fieldByStatus: Readonly<Record<number, string>> = {},
): FormErrorState {
  if (!(error instanceof ApiError)) {
    return { formError: fallbackMessage, fieldErrors: {} };
  }

  const field = fieldByStatus[error.status];

  return field
    ? { formError: null, fieldErrors: { [field]: error.message } }
    : { formError: error.message, fieldErrors: {} };
}
