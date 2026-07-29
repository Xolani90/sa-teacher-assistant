/** @type {import('tailwindcss').Config} */
export default {
  // Matches the existing ThemeContext approach, which toggles
  // data-theme="dark" on a root element rather than relying on
  // prefers-color-scheme. See src/theme/ThemeContext.jsx.
  darkMode: ['selector', '[data-theme="dark"]'],
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      // Every value here reads from the CSS custom properties in
      // src/styles/tokens.css — that file stays the single source of
      // truth for the palette/spacing/type scale. Tailwind classes are
      // just a shorthand for the same tokens, not a second system.
      colors: {
        bg: 'var(--color-bg)',
        surface: 'var(--color-surface)',
        'surface-raised': 'var(--color-surface-raised)',
        border: 'var(--color-border)',
        'border-strong': 'var(--color-border-strong)',
        'text-primary': 'var(--color-text-primary)',
        'text-secondary': 'var(--color-text-secondary)',
        'text-tertiary': 'var(--color-text-tertiary)',
        accent: 'var(--color-accent)',
        'accent-strong': 'var(--color-accent-strong)',
        'accent-soft': 'var(--color-accent-soft)',
        success: 'var(--color-success)',
        'success-soft': 'var(--color-success-soft)',
        warning: 'var(--color-warning)',
        'warning-soft': 'var(--color-warning-soft)',
        danger: 'var(--color-danger)',
        'danger-soft': 'var(--color-danger-soft)',
      },
      backgroundImage: {
        'grad-indigo': 'var(--grad-indigo-soft)',
        'grad-lavender': 'var(--grad-lavender-soft)',
        'grad-mint': 'var(--grad-mint-soft)',
        'grad-amber': 'var(--grad-amber-soft)',
      },
      spacing: {
        1: 'var(--space-1)',
        2: 'var(--space-2)',
        3: 'var(--space-3)',
        4: 'var(--space-4)',
        5: 'var(--space-5)',
        6: 'var(--space-6)',
        7: 'var(--space-7)',
        8: 'var(--space-8)',
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        full: 'var(--radius-full)',
      },
      boxShadow: {
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
      },
      fontFamily: {
        sans: 'var(--font-family)',
      },
      fontSize: {
        xs: 'var(--text-xs)',
        sm: 'var(--text-sm)',
        base: 'var(--text-base)',
        md: 'var(--text-md)',
        lg: 'var(--text-lg)',
        xl: 'var(--text-xl)',
        '2xl': 'var(--text-2xl)',
      },
      transitionDuration: {
        fast: 'var(--duration-fast)',
        base: 'var(--duration-base)',
      },
      transitionTimingFunction: {
        standard: 'var(--ease-standard)',
      },
      animation: {
        'fade-slide-up': 'fadeSlideUp var(--duration-base) var(--ease-standard)',
      },
    },
  },
  plugins: [],
};
