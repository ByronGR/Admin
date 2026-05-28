'use client';

interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function Spinner({ size = 'md', className = '' }: SpinnerProps) {
  const sizeClass = {
    sm: 'w-4 h-4 border-2',
    md: 'w-6 h-6 border-2',
    lg: 'w-10 h-10 border-3',
  }[size];

  return (
    <div
      className={`${sizeClass} rounded-full border-[var(--border)] border-t-[var(--green)] animate-spin ${className}`}
    />
  );
}

export function FullPageSpinner() {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-[var(--bg)]">
      <Spinner size="lg" />
    </div>
  );
}
