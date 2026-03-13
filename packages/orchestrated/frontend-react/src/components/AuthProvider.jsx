import React, { useState, useEffect, useContext, createContext } from 'react';
import { initAuth, logout as doLogout } from '../auth';

const AuthContext = createContext(null);

const AuthProvider = ({ children }) => {
  const [authState, setAuthState] = useState(null);

  useEffect(() => {
    initAuth(setAuthState).then(setAuthState);
  }, []);

  if (!authState || !authState.authenticated) {
    return <div style={{ padding: '2rem', textAlign: 'center' }}>Authenticating...</div>;
  }

  return (
    <AuthContext.Provider value={authState}>
      {children}
    </AuthContext.Provider>
  );
};

const useAuth = () => useContext(AuthContext);

const AuthStatus = () => {
  const auth = useAuth();
  if (!auth) return null;

  const displayRoles = (auth.roles || []).filter(
    (r) => !r.startsWith('default-roles'),
  );

  return (
    <span style={{ fontSize: '0.85rem', color: '#666' }}>
      {auth.username}
      {displayRoles.length > 0 && (
        <span style={{ fontSize: '0.75rem', color: '#999', marginLeft: '4px' }}>
          ({displayRoles.join(', ')})
        </span>
      )}
      <button
        onClick={doLogout}
        style={{
          marginLeft: '8px',
          fontSize: '0.85rem',
          color: '#2563eb',
          background: 'none',
          border: 'none',
          textDecoration: 'underline',
          cursor: 'pointer',
        }}
      >
        Logout
      </button>
    </span>
  );
};

export { AuthProvider, AuthContext, useAuth, AuthStatus };
