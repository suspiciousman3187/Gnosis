import type { ReactNode, ElementType } from 'react';

// Wraps PII (a character name, or text that embeds one) so the Anonymize Names
// toggle can blur it. Visual only. Where a name is already rendered inside an
// element, prefer adding the `gn-pii` class to that element instead of nesting.
export default function Private({
  children, as, className = '', title,
}: {
  children: ReactNode;
  as?: ElementType;
  className?: string;
  title?: string;
}) {
  const Tag = (as ?? 'span') as ElementType;
  return <Tag className={`gn-pii ${className}`.trim()} title={title}>{children}</Tag>;
}
