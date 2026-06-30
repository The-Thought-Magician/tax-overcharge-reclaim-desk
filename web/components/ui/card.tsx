import type { HTMLAttributes } from 'react'

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  className?: string
}

export function Card({ className = '', children, ...props }: CardProps) {
  return (
    <div className={`rounded-xl border border-slate-800 bg-slate-900 ${className}`} {...props}>
      {children}
    </div>
  )
}

export default Card
