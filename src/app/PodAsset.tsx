import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { createPodAssetSignedUrl } from '@/data/repositories/pickSync';

function useSignedPodUrl(path?: string | null) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let active = true;
    setUrl('');
    if (!path) return () => { active = false; };
    if (path.startsWith('data:')) { setUrl(path); return () => { active = false; }; }
    void createPodAssetSignedUrl(path).then((next) => { if (active) setUrl(next || ''); });
    return () => { active = false; };
  }, [path]);
  return url;
}

export function PodAssetImage({ path, alt, className }: { path?: string | null; alt: string; className?: string }) {
  const url = useSignedPodUrl(path);
  if (!path) return null;
  if (!url) return <span className="pod-asset-loading">Loading proof…</span>;
  return <img src={url} alt={alt} className={className} loading="lazy" />;
}

export function PodAssetLink({ path, children }: { path?: string | null; children: ReactNode }) {
  const url = useSignedPodUrl(path);
  if (!path) return null;
  if (!url) return <span className="pod-asset-loading">Proof loading…</span>;
  return <a href={url} target="_blank" rel="noreferrer">{children}</a>;
}
