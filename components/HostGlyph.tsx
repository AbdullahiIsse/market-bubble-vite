import { useState } from 'react';
import type { Host, HostAvatars } from '@/shared/protocol';
import { HOST_META } from '@/shared/meta';

// Set once in src/main.tsx before the first app render (both the main window
// and the popout boot through main.tsx). Immutable afterwards, so reading it
// during render is safe and memo'd components never need it as a prop.
let avatars: HostAvatars = {};

export function setHostAvatars(next: HostAvatars | undefined): void {
  avatars = next ?? {};
}

// The content of a host circle: profile picture when known, letter fallback
// otherwise. The caller keeps the colored ring (.host-dot / .vt-host wrapper
// border) so host identity reads the same either way.
export function HostGlyph({ host }: { host: Host }) {
  const [broken, setBroken] = useState(false);
  const url = avatars[host];
  if (!url || broken) return <>{HOST_META[host].initial}</>;
  return (
    <img
      className="host-pic"
      src={url}
      alt=""
      decoding="async"
      onError={() => setBroken(true)}
    />
  );
}
