import { cn } from '@/lib/utils';

interface InitialsAvatarProps {
  name?: string;
  email?: string;
  className?: string;
}

export function InitialsAvatar({ name, email, className }: InitialsAvatarProps) {
  let initials = '??';
  
  if (name) {
    const parts = name.trim().split(/\s+/);
    if (parts.length > 1) {
      initials = (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    } else if (parts.length === 1 && parts[0].length > 0) {
      initials = parts[0].substring(0, 2).toUpperCase();
    }
  } else if (email) {
    initials = email.substring(0, 2).toUpperCase();
  }

  // Generate a consistent background color based on the string
  const str = name || email || 'unknown';
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  
  const h = Math.abs(hash) % 360;
  const s = 60;
  const l = 40; // slightly dark for white text

  return (
    <div 
      className={cn("flex items-center justify-center rounded-full text-white font-medium shadow-sm shrink-0", className)}
      style={{ backgroundColor: `hsl(${h}, ${s}%, ${l}%)` }}
      title={name || email}
    >
      {initials}
    </div>
  );
}
