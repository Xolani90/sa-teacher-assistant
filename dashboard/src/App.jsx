import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { TeacherProvider } from './auth/TeacherContext';
import { ThemeProvider } from './theme/ThemeContext';
import ProtectedRoute from './components/ProtectedRoute';
import Login from './pages/Login';
import Home from './pages/Home';
import Classes from './pages/Classes';
import ClassDetail from './pages/ClassDetail';
import LearnerDetail from './pages/LearnerDetail';
import ObservationDetail from './pages/ObservationDetail';
import AssessmentDetail from './pages/AssessmentDetail';

export default function App() {
  return (
    <ThemeProvider>
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
            <Route
              path="/learners/:learnerId"
              element={
                <ProtectedRoute>
                  <LearnerDetail />
                </ProtectedRoute>
              }
            />
            <Route
              path="/observations/:assessmentId"
              element={
                <ProtectedRoute>
                  <ObservationDetail />
                </ProtectedRoute>
              }
            />
            <Route
              path="/assessments/:assessmentId"
              element={
                <ProtectedRoute>
                  <AssessmentDetail />
                </ProtectedRoute>
              }
            />
          </Routes>
        </BrowserRouter>
      </TeacherProvider>
    </ThemeProvider>
  );
}
