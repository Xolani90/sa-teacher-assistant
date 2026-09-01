import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { TeacherProvider } from './auth/TeacherContext';
import { ThemeProvider } from './theme/ThemeContext';
import ProtectedRoute from './components/ProtectedRoute';
import Login from './pages/Login';
import Home from './pages/Home';
import Classes from './pages/Classes';
import ClassDetail from './pages/ClassDetail';
import LearnerDetail from './pages/LearnerDetail';
import ObservationWorkspace from './pages/ObservationWorkspace';
import ObservationDetail from './pages/ObservationDetail';
import ResourcesWorkspace from './pages/ResourcesWorkspace';
import ResourceDetail from './pages/ResourceDetail';
import AssessmentDetail from './pages/AssessmentDetail';
import QMS from './pages/QMS';

export default function App() {
  return (
    <ThemeProvider>
      <TeacherProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route
              path="/app"
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
              path="/observations"
              element={
                <ProtectedRoute>
                  <ObservationWorkspace />
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
              path="/resources"
              element={
                <ProtectedRoute>
                  <ResourcesWorkspace />
                </ProtectedRoute>
              }
            />
            <Route
              path="/resources/:resourceId"
              element={
                <ProtectedRoute>
                  <ResourceDetail />
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
            <Route
              path="/qms"
              element={
                <ProtectedRoute>
                  <QMS />
                </ProtectedRoute>
              }
            />
          </Routes>
        </BrowserRouter>
      </TeacherProvider>
    </ThemeProvider>
  );
}
