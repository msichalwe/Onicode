import React, { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';

export type ThemeName = 'sand' | 'midnight' | 'obsidian' | 'ocean' | 'aurora' | 'monokai' | 'rosepine' | 'nord' | 'catppuccin' | 'default-dark' | 'default-light' | 'neutral';

interface ThemeContextType {
    theme: ThemeName;
    setTheme: (theme: ThemeName) => void;
}

const ThemeContext = createContext<ThemeContextType>({
    theme: 'sand',
    setTheme: () => { },
});

export function ThemeProvider({ children }: { children: ReactNode }) {
    const [theme, setThemeState] = useState<ThemeName>(() => {
        const saved = localStorage.getItem('onicode-theme');
        return (saved as ThemeName) || 'sand';
    });

    const setTheme = useCallback((newTheme: ThemeName) => {
        // Add transition class for smooth theme switch
        document.body.classList.add('theme-transitioning');

        setThemeState(newTheme);
        localStorage.setItem('onicode-theme', newTheme);

        // Remove transition class after animation completes
        setTimeout(() => {
            document.body.classList.remove('theme-transitioning');
        }, 550);
    }, []);

    // Apply theme to document root on mount
    useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme);
    }, [theme]);

    return (
        <ThemeContext.Provider value={{ theme, setTheme }}>
            {children}
        </ThemeContext.Provider>
    );
}

export function useTheme() {
    return useContext(ThemeContext);
}
