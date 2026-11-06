import { useEffect, useSyncExternalStore, type AnchorHTMLAttributes } from 'react';
const subscribe = (listener: () => void) => { window.addEventListener('popstate', listener); return () => window.removeEventListener('popstate', listener); };
export function usePath() { return useSyncExternalStore(subscribe, () => window.location.pathname); }
export function navigate(path: string) { window.history.pushState({}, '', path); window.dispatchEvent(new PopStateEvent('popstate')); window.scrollTo({ top: 0 }); }
export function Link({ href = '/', onClick, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a href={href} onClick={e => { onClick?.(e); if (!e.defaultPrevented && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && e.button === 0 && href.startsWith('/') && !props.target) { e.preventDefault(); navigate(href); } }} {...props} />;
}
export function PageTitle({ title }: { title: string }) { useEffect(() => { document.title = `${title} — UniJar`; }, [title]); return null; }
