'use client';

import type { ReactNode } from 'react';
import {
  Description,
  FieldError,
  Input,
  InputGroup,
  Label,
  TextField,
} from '@heroui/react';
import { touchTarget } from '@/lib/touchTarget';

interface TextInputFieldProps {
  autoComplete?: string;
  /** Hint shown under the input, above any error message. */
  description?: string;
  /** Leading icon shown inside the field, e.g. `<EnvelopeIcon className="size-4" />`. */
  icon?: ReactNode;
  isRequired?: boolean;
  label: string;
  maxLength?: number;
  /**
   * The field's form name — also the key a field-level API error arrives under, through the
   * enclosing `Form`'s `validationErrors` (see `src/lib/formErrors.ts`).
   */
  name: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** The `<input>` type. Left off `TextField` on purpose: it types only text-like inputs, and `datetime-local` is not one of them. */
  type?: string;
  /** Returns the message for an invalid value, or `null` when it is acceptable. Runs on submit. */
  validate?: (value: string) => string | null;
  value: string;
}

/**
 * The app's one single-line text field: label, input, optional hint, and the error slot that
 * shows both the client-side `validate` result and any field-level API error the form routed
 * here. Controlled, because the forms using it need the value during render (a create-meeting
 * modal that resets on close, a Save button that disables itself once the value matches what
 * was saved).
 *
 * Prop-less beyond these — no `className` escape hatch — so every field in the app carries the
 * same 44px/40px touch target and the same `variant="secondary"` treatment. Anything needing a
 * password's show/hide toggle uses `PasswordField` instead.
 */
export function TextInputField({
  autoComplete,
  description,
  icon,
  isRequired,
  label,
  maxLength,
  name,
  onChange,
  placeholder,
  type,
  validate,
  value,
}: TextInputFieldProps) {
  return (
    <TextField
      isRequired={isRequired}
      maxLength={maxLength}
      name={name}
      onChange={onChange}
      validate={validate}
      value={value}
    >
      <Label>{label}</Label>
      {icon ? (
        <InputGroup className={touchTarget()} variant="secondary">
          <InputGroup.Prefix>{icon}</InputGroup.Prefix>
          <InputGroup.Input
            autoComplete={autoComplete}
            placeholder={placeholder}
            type={type}
          />
        </InputGroup>
      ) : (
        <Input
          autoComplete={autoComplete}
          className={touchTarget()}
          placeholder={placeholder}
          type={type}
          variant="secondary"
        />
      )}
      {description ? <Description>{description}</Description> : null}
      <FieldError />
    </TextField>
  );
}
