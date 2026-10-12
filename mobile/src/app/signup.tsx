import { Link } from 'expo-router';

import { useAuth } from '@/auth/auth-provider';
import { AuthForm } from '@/components/auth-form';
import { ThemedText } from '@/components/themed-text';

// Only reachable while signed out (see Stack.Protected in _layout.tsx). signup() creates the
// account and logs straight in, so success lands on the home screen.
export default function SignupScreen() {
  const { signup } = useAuth();

  return (
    <AuthForm
      submitLabel="Create account"
      passwordAutoComplete="new-password"
      onSubmit={signup}
      footer={
        // dismissTo goes back to the login screen already in the stack, instead of pushing a
        // second copy on top.
        <Link href="/login" dismissTo>
          <ThemedText type="linkPrimary">Already have an account? Log in</ThemedText>
        </Link>
      }
    />
  );
}
