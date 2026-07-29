import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { TeacherProvider } from './auth/TeacherContext';
import ProtectedRoute from './components/ProtectedRoute';
import Login from './pages/Login';
import Home from './pages/Home';
import Classes from './pages/Classes';
import ClassDetail from './pages/ClassDetail';

export default function App() {
  return (
    <TeacherProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Home />
              </ProtectedRoute>
            }
          />
          <Route
            path="/classes"
            element={
              <ProtectedRoute>
                <Classes />
              </ProtectedRoute>
            }
          />
          <Route
            path="/classes/:classId"
            element={
              <ProtectedRoute>
                <ClassDetail />
              </ProtectedRoute>
            }
          />
        </Routes>
      </BrowserRouter>
    </TeacherProvider>
  );
}
