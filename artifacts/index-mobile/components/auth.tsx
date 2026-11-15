import { useState } from 'react';
import { Text, View } from 'react-native';
import { useSignIn, useSignUp, useSSO } from '@clerk/expo';
import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';
import { Button, Field, Page, Copy, Chips, c, s, errorMessage } from './ui';

WebBrowser.maybeCompleteAuthSession();
type Mode = 'signin' | 'signup' | 'verify' | 'factor' | 'reset' | 'reset-code' | 'password';
type Factor = 'email_code' | 'totp' | 'backup_code';
function checked(result: { error: unknown }) { if (result.error) throw result.error; }

export function AuthScreen() {
  const { signIn } = useSignIn();
  const { signUp } = useSignUp();
  const { startSSOFlow } = useSSO();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [factor, setFactor] = useState<Factor>('email_code');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const factors = (signIn.supportedSecondFactors ?? []).map(f => f.strategy).filter((f): f is Factor => f === 'email_code' || f === 'totp' || f === 'backup_code');
  const run = async (action: () => Promise<void>) => { setErr(''); setNotice(''); setBusy(true); try { await action(); } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); } };
  async function finishSignIn() {
    if (signIn.status === 'complete') {
      checked(await signIn.finalize({ navigate: ({ session }) => { if (session?.currentTask) setErr(`Account action required: ${session.currentTask.key}. Complete it on the website before continuing.`); } }));
    } else if (signIn.status === 'needs_client_trust' || signIn.status === 'needs_second_factor') {
      const available = (signIn.supportedSecondFactors ?? []).map(f => f.strategy);
      const next = (['email_code', 'totp', 'backup_code'] as const).find(f => available.includes(f));
      if (!next) throw new Error(`This account requires an unsupported verification method (${available.join(', ') || signIn.status}).`);
      setFactor(next); setCode(''); setMode('factor');
      if (next === 'email_code') checked(await signIn.mfa.sendEmailCode());
    } else throw new Error(`Sign-in needs another step: ${signIn.status ?? 'not initialized'}. Please start again or use the website.`);
  }
  async function submit() {
    if (mode === 'signin') { checked(await signIn.password({ emailAddress: email.trim(), password })); await finishSignIn(); }
    if (mode === 'signup') {
      checked(await signUp.password({ emailAddress: email.trim(), password }));
      if (signUp.status === 'complete') checked(await signUp.finalize());
      else if (signUp.unverifiedFields.includes('email_address') && signUp.missingFields.length === 0) { checked(await signUp.verifications.sendEmailCode()); setCode(''); setMode('verify'); }
      else throw new Error(`Additional account requirements: ${signUp.missingFields.join(', ') || signUp.status}. Complete sign-up on the website.`);
    }
    if (mode === 'verify') {
      checked(await signUp.verifications.verifyEmailCode({ code }));
      if (signUp.status !== 'complete') throw new Error(`Verification needs another step: ${signUp.status}.`);
      checked(await signUp.finalize());
    }
    if (mode === 'factor') {
      checked(await (factor === 'email_code' ? signIn.mfa.verifyEmailCode({ code }) : factor === 'totp' ? signIn.mfa.verifyTOTP({ code }) : signIn.mfa.verifyBackupCode({ code })));
      await finishSignIn();
    }
    if (mode === 'reset') {
      checked(await signIn.create({ identifier: email.trim() }));
      checked(await signIn.resetPasswordEmailCode.sendCode()); setCode(''); setMode('reset-code');
    }
    if (mode === 'reset-code') {
      checked(await signIn.resetPasswordEmailCode.verifyCode({ code }));
      if (signIn.status !== 'needs_new_password') throw new Error(`Password reset needs another step: ${signIn.status}.`);
      setPassword(''); setMode('password');
    }
    if (mode === 'password') { checked(await signIn.resetPasswordEmailCode.submitPassword({ password, signOutOfOtherSessions: true })); await finishSignIn(); }
  }
  const simple = mode === 'signin' || mode === 'signup';
  const needsEmail = simple || mode === 'reset';
  const needsPassword = simple || mode === 'password';
  const needsCode = mode === 'factor' || mode === 'verify' || mode === 'reset-code';
  const titles: Record<Mode, string> = { signin: 'Your thoughts,\nwithin reach.', signup: 'Make room\nfor your thoughts.', verify: 'Check your email.', factor: 'Verify it’s you.', reset: 'Reset password.', 'reset-code': 'Check your email.', password: 'A new password.' };
  return <Page title="Index 0.1" eyebrow="Pebble Index companion">
    <View style={{ marginTop: 28, marginBottom: 16, gap: 14 }}><View style={{ width: 44, height: 44, borderWidth: 2, borderColor: c.foreground, borderRadius: 22 }}><View style={{ position: 'absolute', width: 11, height: 11, borderRadius: 6, right: -2, top: 0, backgroundColor: c.accent }} /></View><Text style={[s.heading, { fontSize: 43, lineHeight: 47 }]}>{titles[mode]}</Text><Copy style={{ color: c.mutedForeground }}>{simple ? 'Original voice notes. A clear view of what’s next.' : mode === 'factor' ? 'Use your account’s verification method.' : 'Continue securely with your Index account.'}</Copy></View>
    {simple && <Button label="Continue with Google" quiet disabled={busy} onPress={() => void run(async () => {
      const result = await startSSOFlow({ strategy: 'oauth_google', redirectUrl: AuthSession.makeRedirectUri({ scheme: 'index-mobile', path: 'oauth-callback' }) });
      if (result.createdSessionId && result.setActive) await result.setActive({ session: result.createdSessionId, navigate: ({ session }) => { if (session?.currentTask) setErr(`Account action required: ${session.currentTask.key}. Complete it on the website.`); } });
      else if (result.authSessionResult?.type === 'cancel' || result.authSessionResult?.type === 'dismiss') setNotice('Google sign-in cancelled.');
      // The canonical SSO helper reloads the same Clerk client resources exposed
      // by the future hooks. Continue their verification state instead of starting
      // a new password attempt and discarding the OAuth first factor.
      else if (result.signIn?.status === 'needs_second_factor' || result.signIn?.status === 'needs_client_trust') await finishSignIn();
      else if (signUp.status === 'missing_requirements' && signUp.unverifiedFields.includes('email_address') && signUp.missingFields.length === 0) { checked(await signUp.verifications.sendEmailCode()); setCode(''); setMode('verify'); }
      else throw new Error(`Google sign-in requires another step: ${result.signIn?.status ?? result.signUp?.status ?? 'no session returned'}. Continue with email or complete the account on the website.`);
    })} />}
    {simple && <View style={s.row}><View style={[s.divider, { flex: 1 }]} /><Text style={s.muted}>or with email</Text><View style={[s.divider, { flex: 1 }]} /></View>}
    <View style={{ gap: 12 }}>
      {needsEmail && <Field accessibilityLabel="Email address" placeholder="Email address" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />}
      {needsPassword && <Field accessibilityLabel={mode === 'password' ? 'New password' : 'Password'} placeholder={mode === 'password' ? 'New password' : 'Password'} value={password} onChangeText={setPassword} secureTextEntry autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} />}
      {mode === 'factor' && factors.length > 1 && <Chips values={factors} value={factor} onChange={f => { setFactor(f); setCode(''); if (f === 'email_code') void run(async () => { checked(await signIn.mfa.sendEmailCode()); setNotice('A new code was sent.'); }); }} />}
      {needsCode && <Field accessibilityLabel="Verification code" placeholder={factor === 'backup_code' && mode === 'factor' ? 'Backup code' : 'Verification code'} value={code} onChangeText={setCode} autoCapitalize="none" autoComplete="one-time-code" keyboardType={factor === 'backup_code' && mode === 'factor' ? 'default' : 'number-pad'} />}
      {!!err && <Text accessibilityRole="alert" style={s.error}>{err}</Text>}
      {!!notice && <Text style={s.muted}>{notice}</Text>}
      <Button label={busy ? 'Continuing…' : mode === 'signup' ? 'Create account' : mode === 'reset' ? 'Send reset code' : needsCode ? 'Verify' : mode === 'password' ? 'Save password' : 'Sign in'} disabled={busy || (needsEmail && !email.trim()) || (needsPassword && !password) || (needsCode && !code.trim())} onPress={() => void run(submit)} />
      {mode === 'signin' && <Button label="Forgot password" quiet disabled={busy} onPress={() => { setMode('reset'); setErr(''); }} />}
      {simple && <Button label={mode === 'signin' ? 'Create an account' : 'Already have an account? Sign in'} quiet disabled={busy} onPress={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setErr(''); setPassword(''); }} />}
      {needsCode && (mode !== 'factor' || factor === 'email_code') && <Button label="Send a new code" quiet disabled={busy} onPress={() => void run(async () => { checked(await (mode === 'verify' ? signUp.verifications.sendEmailCode() : mode === 'reset-code' ? signIn.resetPasswordEmailCode.sendCode() : signIn.mfa.sendEmailCode())); setNotice('A new code was sent.'); })} />}
      {!simple && <Button label="Start over" quiet disabled={busy} onPress={() => void run(async () => { await signIn.reset(); await signUp.reset(); setCode(''); setPassword(''); setMode('signin'); })} />}
    </View><View nativeID="clerk-captcha" />
  </Page>;
}
