import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTeacher } from '../auth/TeacherContext';
import { ApiError } from '../api/client';

const STEP_PHONE = 'phone';
const STEP_CODE = 'code';

export default function Login() {
  const { requestCode, verifyCode } = useTeacher();
  const navigate = useNavigate();

  const [step, setStep] = useState(STEP_PHONE);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleRequestCode(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await requestCode(phone.trim());
      // Always advances, whether or not the phone is known — the backend
      // deliberately gives no signal either way (ADR-008: no enumeration).
      setStep(STEP_CODE);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVerifyCode(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await verifyCode(phone.trim(), code.trim());
      navigate('/app', { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError('Incorrect or expired code. Please try again.');
      } else {
        setError('Something went wrong. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={styles.wrapper}>
      <div style={styles.card}>
        <h1 style={styles.title}>Teacher Assistant</h1>

        {step === STEP_PHONE && (
          <form onSubmit={handleRequestCode} style={styles.form}>
            <label style={styles.label} htmlFor="phone">
              WhatsApp number
            </label>
            <input
              id="phone"
              type="tel"
              placeholder="e.g. 0821234567"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
              style={styles.input}
              autoFocus
            />
            {error && <p style={styles.error}>{error}</p>}
            <button type="submit" disabled={submitting} style={styles.button}>
              {submitting ? 'Sending…' : 'Send code'}
            </button>
          </form>
        )}

        {step === STEP_CODE && (
          <form onSubmit={handleVerifyCode} style={styles.form}>
            <p style={styles.hint}>
              We sent a 6-digit code to <strong>{phone}</strong> on WhatsApp.
            </p>
            <label style={styles.label} htmlFor="code">
              Verification code
            </label>
            <input
              id="code"
              type="text"
              inputMode="numeric"
              maxLength={6}
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
              style={styles.input}
              autoFocus
            />
            {error && <p style={styles.error}>{error}</p>}
            <button type="submit" disabled={submitting} style={styles.button}>
              {submitting ? 'Verifying…' : 'Verify & log in'}
            </button>
            <button
              type="button"
              onClick={() => {
                setStep(STEP_PHONE);
                setCode('');
                setError(null);
              }}
              style={styles.linkButton}
            >
              Use a different number
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

const styles = {
  wrapper: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#f5f5f5',
    fontFamily: 'system-ui, sans-serif',
  },
  card: {
    background: '#fff',
    padding: '2rem',
    borderRadius: 8,
    boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
    width: 320,
  },
  title: { margin: '0 0 1.5rem', fontSize: '1.25rem' },
  form: { display: 'flex', flexDirection: 'column', gap: '0.75rem' },
  label: { fontSize: '0.85rem', color: '#333' },
  input: {
    padding: '0.6rem',
    fontSize: '1rem',
    border: '1px solid #ccc',
    borderRadius: 4,
  },
  button: {
    padding: '0.6rem',
    fontSize: '1rem',
    background: '#1a73e8',
    color: '#fff',
    border: 'none',
    borderRadius: 4,
    cursor: 'pointer',
  },
  linkButton: {
    background: 'none',
    border: 'none',
    color: '#1a73e8',
    cursor: 'pointer',
    fontSize: '0.85rem',
    padding: 0,
  },
  hint: { fontSize: '0.85rem', color: '#555', margin: 0 },
  error: { color: '#c5221f', fontSize: '0.85rem', margin: 0 },
};
