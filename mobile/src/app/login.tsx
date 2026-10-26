import { Link } from 'expo-router';

import { useAuth } from '@/auth/auth-provider';
import { AuthForm } from '@/components/auth-form';
import { ThemedText } from '@/components/themed-text';

export default function LoginScreen() {
  const { login } = useAuth();

  return (
    <AuthForm
      submitLabel="Log in"
      passwordAutoComplete="current-password"
      onSubmit={login}
      footer={
        <Link href="/signup">
          <ThemedText type="linkPrimary">New here? Create an account</ThemedText>
        </Link>
      }
    />
  );
}
