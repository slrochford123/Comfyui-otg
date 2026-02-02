'use client';

import Image from 'next/image';
import ThemeToggle from './ThemeToggle';
import ConnectionStatus from './ConnectionStatus';

type Props = {
  apiBase?: string;
  target?: string;
  error?: string;
  busy?: boolean;
};

export default function HeaderBar({ apiBase, target, error, busy }: Props) {
  return (
    <div className="otg-hero" style={{ position: 'relative' }}>
      <div style={{ position: 'absolute', right: 14, top: 14 }}>
        <ThemeToggle />
      </div>

      <div className="otg-logo" style={{ overflow: 'hidden' }}>
        <Image src="/icon-192-maskable.png" alt="ComfyUI OTG" width={192} height={192} priority />
      </div>

      <div className="otg-head">ComfyUI OTG</div>
      <div className="otg-tag">Creating New Worlds On The Go</div>

      <div style={{ marginTop: 10 }}>
        <ConnectionStatus apiBase={apiBase} target={target} error={error} isBusy={!!busy} />
      </div>
    </div>
  );
}
