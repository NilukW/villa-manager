import { createContext, useState } from 'react';

export const AuthContext = createContext();

export function AuthProvider({ children }) {
    const [token, setToken] = useState(localStorage.getItem('token'));
    const [username, setUsername] = useState(localStorage.getItem('username'));

    const login = (newToken, user) => {
        localStorage.setItem('token', newToken);
        localStorage.setItem('username', user);
        setToken(newToken);
        setUsername(user);
    };

    const logout = () => {
        localStorage.removeItem('token');
        localStorage.removeItem('username');
        setToken(null);
        setUsername(null);
    };

    return (
        <AuthContext.Provider value={{ token, username, login, logout, isAuthenticated: !!token }}>
            {children}
        </AuthContext.Provider>
    );
}
