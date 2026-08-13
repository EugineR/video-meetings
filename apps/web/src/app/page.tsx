'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Card, Spinner } from '@heroui/react';
import { clearAccessToken, getStoredUser, type StoredUser } from '@/lib/auth';

export default function Home() {
  const router = useRouter();
  const [user, setUser] = useState<StoredUser | null>(null);

  useEffect(() => {
    const storedUser = getStoredUser();
    if (!storedUser) {
      router.replace('/register');
      return;
    }
    setUser(storedUser);
  }, [router]);

  const handleSignOut = () => {
    clearAccessToken();
    router.replace('/register');
  };

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner aria-label="Loading" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-linear-to-br from-accent/10 via-background to-background px-4 py-12">
      <Card className="w-full max-w-md">
        <Card.Header>
          <Card.Title>Welcome back</Card.Title>
          <Card.Description>{user.email}</Card.Description>
        </Card.Header>
        <Card.Footer>
          <Button
            className="w-full"
            variant="secondary"
            onPress={handleSignOut}
          >
            Sign out
          </Button>
        </Card.Footer>
      </Card>
    </div>
  );
}
