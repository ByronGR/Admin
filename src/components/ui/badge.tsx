'use client';

import { STATUS_COLORS, STAGE_COLORS, snakeToTitle } from '@/lib/utils';

interface BadgeProps {
  label: string;
  variant?: 'status' | 'stage' | 'neutral' | 'green' | 'amber' | 'red' | 'blue' | 'violet';
  className?: string;
}

export function Badge({ label, variant = 'neutral', className = '' }: BadgeProps) {
  let colorClass = 'bg-gray-100 text-gray-600';

  if (variant === 'status') {
    colorClass = STATUS_COLORS[label.toLowerCase()] ?? colorClass;
  } else if (variant === 'stage') {
    colorClass = STAGE_COLORS[label.toLowerCase()] ?? colorClass;
  } else if (variant === 'green') {
    colorClass = 'bg-green-100 text-green-700';
  } else if (variant === 'amber') {
    colorClass = 'bg-amber-100 text-amber-700';
  } else if (variant === 'red') {
    colorClass = 'bg-red-100 text-red-600';
  } else if (variant === 'blue') {
    colorClass = 'bg-blue-100 text-blue-700';
  } else if (variant === 'violet') {
    colorClass = 'bg-violet-100 text-violet-700';
  }

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${colorClass} ${className}`}
    >
      {snakeToTitle(label)}
    </span>
  );
}
