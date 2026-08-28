import type { ReactNode } from 'react';
import { AuthShell } from '@/components/layout/AuthShell';

/**
 * Layout of the unauthenticated route group (`/login`, `/register`): the shared
 * background and brand-only header, plus the centered card slot the pages fill.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return <AuthShell>{children}</AuthShell>;
}
