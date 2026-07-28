import { Navigate } from 'react-router-dom';
import { useTeacher } from '../auth/TeacherContext';

export default function ProtectedRoute({ children }) {
  const { isAuthenticated } = useTeacher();
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  return children;
}
