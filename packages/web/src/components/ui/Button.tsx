import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'ghost-danger' | 'danger';
  size?: 'xs' | 'sm' | 'md';
  loading?: boolean;
}

/**
 * The only way to render an action in this app. See STYLE_GUIDE.md for
 * which variant and size to use where. Never hand-roll a <button> with
 * link styling; links are for navigation only.
 */
export function Button({
  variant = 'primary',
  size = 'md',
  loading,
  children,
  className = '',
  disabled,
  ...props
}: ButtonProps) {
  const base = 'inline-flex items-center justify-center font-bold transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed rounded-sm';
  const sizes = { xs: 'px-2 py-1 text-xs', sm: 'px-3 py-1.5 text-xs', md: 'px-4 py-2 text-sm' };
  const variants = {
    primary: 'bg-btn-primary text-btn-primary-text hover:bg-btn-primary-hover',
    secondary: 'bg-btn-secondary text-btn-secondary-text hover:bg-btn-secondary-hover',
    ghost: 'text-muted hover:text-ink hover:bg-surface-2',
    'ghost-danger': 'text-muted hover:text-red-700 hover:bg-red-50 dark:hover:text-red-300 dark:hover:bg-red-900/20',
    danger: 'bg-btn-danger text-btn-danger-text hover:bg-btn-danger-hover',
  };

  return (
    <button
      className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <span className="mr-2 h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
      ) : null}
      {children}
    </button>
  );
}
