import { useNavigate } from 'react-router-dom';
import { useTeacher } from '../auth/TeacherContext';

export default function Dashboard() {
  const { teacher, logout } = useTeacher();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate('/login', { replace: true });
  }

  return (
    <div style={styles.wrapper}>
      <header style={styles.header}>
        <span>Teacher Assistant</span>
        <button onClick={handleLogout} style={styles.logoutButton}>
          Logout
        </button>
      </header>
      <main style={styles.main}>
        <h1>Welcome, {teacher?.name || 'Teacher'}</h1>
        <p style={styles.placeholder}>
          Classes, learners, and reports arrive in later PRs.
        </p>
      </main>
    </div>
  );
}

const styles = {
  wrapper: { fontFamily: 'system-ui, sans-serif', minHeight: '100vh' },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '1rem 1.5rem',
    borderBottom: '1px solid #eee',
  },
  logoutButton: {
    padding: '0.4rem 0.8rem',
    background: '#f1f1f1',
    border: '1px solid #ccc',
    borderRadius: 4,
    cursor: 'pointer',
  },
  main: { padding: '2rem 1.5rem' },
  placeholder: { color: '#666' },
};
