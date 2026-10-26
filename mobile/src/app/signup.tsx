import { Link } from 'expo-router';

import { useAuth } from '@/auth/auth-provider';
import { AuthForm } from '@/components/auth-form';
import { ThemedText } from '@/components/themed-text';

// signup() also logs in, so success lands on the home screen.
export default function SignupScreen() {
  const { signup } = useAuth();

  return (
    <AuthForm
      submitLabel="Create account"
      passwordAutoComplete="new-password"
      onSubmit={signup}
      footer={
        // dismissTo goes back to the login screen underneath instead of pushing a second copy.
        <Link href="/login" dismissTo>
          <ThemedText type="linkPrimary">Already have an account? Log in</ThemedText>
        </Link>
      }
    />
  );
}
