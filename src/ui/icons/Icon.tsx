import type { SVGProps } from 'react';
import { ICONS, resolveIcon } from './paths';

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name' | 'children'> {
  /** An `IconName`; unknown names (e.g. a command's `icon` that has no glyph yet) render an empty placeholder. */
  name: string | undefined;
  size?: number;
  /** Provide a label to expose the icon to assistive tech; otherwise it is `aria-hidden`. */
  label?: string;
}

/** 16px-grid inline SVG icon; stroke = `currentColor`. */
export function Icon({ name, size = 16, label, className, ...rest }: IconProps) {
  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true as const, focusable: 'false' as const };
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ? `icon ${className}` : 'icon'}
      data-icon={name}
      {...a11y}
      {...rest}
      // Static, trusted markup from ./paths (never user input).
      dangerouslySetInnerHTML={{ __html: resolveIcon(name) ? ICONS[resolveIcon(name)!] : '' }}
    />
  );
}
