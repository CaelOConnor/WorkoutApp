import { useState } from 'react';
import { View, TextInput, Text, Pressable, StyleSheet, useColorScheme } from 'react-native';
import { Colors, Spacing } from '@/constants/theme';

const API_URL = 'http://YOUR_COMPUTER_IP:3000';

export default function SignupScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');

  const scheme = useColorScheme();
  const colors = scheme === 'dark' ? Colors.dark : Colors.light;

  const handleSignup = async () => {
    try {
      const response = await fetch(`${API_URL}/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        setMessage(data.error || 'Something went wrong');
        return;
      }

      setMessage(`Signed up as ${data.email}`);
    } catch (err) {
      setMessage('Could not reach server');
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Text style={[styles.title, { color: colors.text }]}>Sign Up</Text>
      <TextInput
        style={[
          styles.input,
          { backgroundColor: colors.backgroundElement, color: colors.text },
        ]}
        placeholder="Email"
        placeholderTextColor={colors.textSecondary}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
      />
      <TextInput
        style={[
          styles.input,
          { backgroundColor: colors.backgroundElement, color: colors.text },
        ]}
        placeholder="Password"
        placeholderTextColor={colors.textSecondary}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />
      <Pressable style={[styles.button, { backgroundColor: colors.text }]} onPress={handleSignup}>
        <Text style={[styles.buttonText, { color: colors.background }]}>Create Account</Text>
      </Pressable>
      {message ? (
        <Text style={[styles.message, { color: colors.textSecondary }]}>{message}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: Spacing.four },
  title: { fontSize: 24, fontWeight: 'bold', marginBottom: Spacing.four },
  input: {
    borderRadius: Spacing.two,
    padding: Spacing.three,
    marginBottom: Spacing.three,
  },
  button: {
    borderRadius: Spacing.two,
    padding: Spacing.three,
    alignItems: 'center',
  },
  buttonText: { fontWeight: '600' },
  message: { marginTop: Spacing.three, textAlign: 'center' },
});