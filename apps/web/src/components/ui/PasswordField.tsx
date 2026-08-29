'use client';

import { useState } from 'react';
import {
  Button,
  Description,
  FieldError,
  InputGroup,
  Label,
  TextField,
} from '@heroui/react';
import { EyeIcon, EyeOffIcon } from '@/components/icons';

interface PasswordFieldProps {
  autoComplete: 'current-password' | 'new-password';
  /** Hint shown under the input, above any error message. */
  description?: string;
  isRequired?: boolean;
  label: string;
  minLength?: number;
  /**
   * The field's form name — also the key a field-level API error arrives under, through the
   * enclosing `Form`'s `validationErrors` (see `src/lib/formErrors.ts`).
   */
  name: string;
  onChange: (value: string) => void;
  /** Returns the message for an invalid value, or `null` when it is acceptable. Runs on submit. */
  validate?: (value: string) => string | null;
  value: string;
}

/**
 * The `TextInputField` counterpart for passwords: the same label/hint/error anatomy plus the
 * show/hide eye toggle, written once here instead of the four hand-rolled copies that used to
 * sit in `/login`, `/register` and three times inside `PasswordSection`.
 *
 * The toggle's `aria-label` is derived from `label` (`"New password"` → `"Show new password"`)
 * rather than passed in, so the five call sites cannot drift into five different wordings — the
 * way they already had. Visibility is local state: which field is currently revealed is nobody
 * else's business, and it resets when the field unmounts.
 */
export function PasswordField({
  autoComplete,
  description,
  isRequired,
  label,
  minLength,
  name,
  onChange,
  validate,
  value,
}: PasswordFieldProps) {
  const [isVisible, setIsVisible] = useState(false);
  const action = isVisible ? 'Hide' : 'Show';

  return (
    <TextField
      isRequired={isRequired}
      minLength={minLength}
      name={name}
      onChange={onChange}
      type="password"
      validate={validate}
      value={value}
    >
      <Label>{label}</Label>
      <InputGroup className="h-11 md:h-10" variant="secondary">
        <InputGroup.Input
          autoComplete={autoComplete}
          placeholder="••••••••"
          type={isVisible ? 'text' : 'password'}
        />
        <InputGroup.Suffix className="px-1">
          <Button
            aria-label={`${action} ${label.toLowerCase()}`}
            isIconOnly
            onPress={() => setIsVisible((visible) => !visible)}
            size="sm"
            type="button"
            variant="ghost"
          >
            {isVisible ? (
              <EyeOffIcon className="size-5" />
            ) : (
              <EyeIcon className="size-5" />
            )}
          </Button>
        </InputGroup.Suffix>
      </InputGroup>
      {description ? <Description>{description}</Description> : null}
      <FieldError />
    </TextField>
  );
}
