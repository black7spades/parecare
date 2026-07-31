import React, { useId } from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
}

export function Input({ label, error, hint, id, className = '', ...props }: InputProps) {
  // React makes this unique per instance. Deriving it from the label text
  // meant two "Name" fields on one screen shared an id, and a label points at
  // whichever came first, so a screen reader announced the wrong field and
  // clicking the second label put the cursor in the first.
  const generated = useId();
  const inputId = id ?? generated;
  return (
    <div>
      {label ? (
        <label htmlFor={inputId} className="block text-sm font-medium text-ink mb-1">
          {label}
        </label>
      ) : null}
      <input
        id={inputId}
        className={`block w-full rounded-md border ${error ? 'border-red-400' : 'border-border'} bg-card px-3 py-2 text-sm placeholder-muted shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary ${className}`}
        {...props}
      />
      {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
      {hint && !error ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  hint?: string;
}

export function Textarea({ label, error, hint, id, className = '', ...props }: TextareaProps) {
  // React makes this unique per instance. Deriving it from the label text
  // meant two "Name" fields on one screen shared an id, and a label points at
  // whichever came first, so a screen reader announced the wrong field and
  // clicking the second label put the cursor in the first.
  const generated = useId();
  const inputId = id ?? generated;
  return (
    <div>
      {label ? (
        <label htmlFor={inputId} className="block text-sm font-medium text-ink mb-1">
          {label}
        </label>
      ) : null}
      <textarea
        id={inputId}
        className={`block w-full rounded-md border ${error ? 'border-red-400' : 'border-border'} bg-card px-3 py-2 text-sm placeholder-muted shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary ${className}`}
        {...props}
      />
      {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
      {hint && !error ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}
