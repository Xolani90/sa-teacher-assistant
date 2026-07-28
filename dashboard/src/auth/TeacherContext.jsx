import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import {
  requestCode as apiRequestCode,
  verifyCode as apiVerifyCode,
  authenticatedFetch,
  getStoredToken,
  getStoredTeacher,
  setStoredToken,
  setStoredTeacher,
  logout as apiLogout,
  ApiError,
} from '../api/client';

const TeacherContext = createContext(null);

export function TeacherProvider({ children }) {
  const [token, setToken] = useState(() => getStoredToken());
  const [teacher, setTeacher] = useState(() => getStoredTeacher());

  const requestCode = useCallback((phone) => apiRequestCode(phone), []);

  const verifyCode = useCallback(async (phone, code) => {
    const result = await apiVerifyCode(phone, code);
    setStoredToken(result.accessToken);
    setStoredTeacher(result.teacher);
    setToken(result.accessToken);
    setTeacher(result.teacher);
    return result;
  }, []);

  const logout = useCallback(() => {
    apiLogout();
    setToken(null);
    setTeacher(null);
  }, []);

  // Wraps authenticatedFetch so a 401 (expired/invalid token) also clears
  // local React state, not just localStorage — otherwise ProtectedRoute
  // wouldn't notice until the next reload.
  const authedFetch = useCallback(
    async (path, options) => {
      try {
        return await authenticatedFetch(path, options);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          setToken(null);
          setTeacher(null);
        }
        throw err;
      }
    },
    []
  );

  const value = useMemo(
    () => ({
      token,
      teacher,
      isAuthenticated: Boolean(token),
      requestCode,
      verifyCode,
      logout,
      authedFetch,
    }),
    [token, teacher, requestCode, verifyCode, logout, authedFetch]
  );

  return <TeacherContext.Provider value={value}>{children}</TeacherContext.Provider>;
}

export function useTeacher() {
  const ctx = useContext(TeacherContext);
  if (!ctx) {
    throw new Error('useTeacher() must be used within a <TeacherProvider>');
  }
  return ctx;
}
